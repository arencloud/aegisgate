#!/usr/bin/env python3
"""Exercise IPv6, isolated session checks, RBAC, and private-CA OIDC discovery.

Requires Docker, openssl and a built session-manager/target/debug binary.
Uses only disposable fixture credentials and cleans up its Redis container.
"""
import hashlib
import http.client
import http.server
import json
import os
from pathlib import Path
import secrets
import socket
import ssl
import subprocess
import tempfile
import threading
import time

ROOT = Path(__file__).resolve().parents[1]


def run(*args, **kwargs):
    return subprocess.check_output(args, text=True, stderr=subprocess.DEVNULL, **kwargs).strip()


def port():
    with socket.socket(socket.AF_INET6) as s:
        s.bind(("::1", 0))
        return s.getsockname()[1]


def request(p, path, method="GET", headers=None):
    c = http.client.HTTPConnection("::1", p, timeout=3)
    try:
        c.request(method, path, headers=headers or {})
        r = c.getresponse()
        return r.status, r.read(), dict(r.getheaders())
    finally:
        c.close()


container = "aegisgate-listener-test-" + secrets.token_hex(4)
process = None
server = None
try:
    run("docker", "run", "-d", "--name", container, "-p", "127.0.0.1::6379",
        "redis:8.10", "redis-server", "--save", "", "--appendonly", "no")
    redis_port = run("docker", "port", container, "6379/tcp").rsplit(":", 1)[1]
    with tempfile.TemporaryDirectory(prefix="aegisgate-listeners-") as tmp:
        tmp = Path(tmp)
        run("openssl", "req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "1",
            "-subj", "/CN=AegisGate test root", "-keyout", str(tmp / "root.key"),
            "-out", str(tmp / "root.pem"), "-addext", "basicConstraints=critical,CA:TRUE")
        run("openssl", "req", "-newkey", "rsa:2048", "-nodes", "-subj", "/CN=localhost",
            "-keyout", str(tmp / "server.key"), "-out", str(tmp / "server.csr"))
        (tmp / "extensions").write_text("basicConstraints=critical,CA:FALSE\nsubjectAltName=DNS:localhost\nextendedKeyUsage=serverAuth\n")
        run("openssl", "x509", "-req", "-days", "1", "-in", str(tmp / "server.csr"),
            "-CA", str(tmp / "root.pem"), "-CAkey", str(tmp / "root.key"), "-CAcreateserial",
            "-extfile", str(tmp / "extensions"), "-out", str(tmp / "server.pem"))

        class Identity(http.server.BaseHTTPRequestHandler):
            def do_GET(self):
                data = {"keys": []} if self.path == "/jwks" else {
                    "issuer": issuer, "authorization_endpoint": issuer + "/authorize",
                    "token_endpoint": issuer + "/token", "jwks_uri": issuer + "/jwks",
                    "response_types_supported": ["code"], "subject_types_supported": ["public"],
                    "id_token_signing_alg_values_supported": ["RS256"],
                }
                body = json.dumps(data).encode()
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)

            def log_message(self, *_):
                pass

        server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Identity)
        issuer = f"https://localhost:{server.server_port}"
        tls = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
        tls.load_cert_chain(tmp / "server.pem", tmp / "server.key")
        server.socket = tls.wrap_socket(server.socket, server_side=True)
        threading.Thread(target=server.serve_forever, daemon=True).start()
        cfg = json.loads((ROOT / "session-manager/config.json").read_text())
        cfg["providers"] = [cfg["providers"][0]]
        cfg["providers"][0]["issuer"] = issuer
        (tmp / "config.json").write_text(json.dumps(cfg))
        main_port, check_port = port(), port()
        env = os.environ.copy()
        env.pop("ALLOW_INSECURE_LOCALHOST", None)
        env.pop("OIDC_LOCAL_ADDRESS", None)
        env.update(REDIS_URL=f"redis://127.0.0.1:{redis_port}/0",
                   PUBLIC_ORIGIN="https://demo.aegisgate.example.com",
                   BACKEND_URL="http://localhost:9", BACKEND_TOKEN="fixture-only-" + "x" * 32,
                   CONFIG_PATH=str(tmp / "config.json"), LISTEN_ADDRESS=f"[::1]:{main_port}",
                   SESSION_CHECK_ADDRESS=f"[::1]:{check_port}")
        env[cfg["providers"][0]["client_secret_env"]] = "fixture-only-client-secret"
        binary = ROOT / "session-manager/target/debug/aegisgate-session-manager"
        for trust in (False, True):
            env.pop("OIDC_CA_BUNDLE", None)
            if trust:
                env["OIDC_CA_BUNDLE"] = str(tmp / "root.pem")
            process = subprocess.Popen([binary], env=env, stdout=subprocess.DEVNULL,
                                       stderr=subprocess.DEVNULL)
            for _ in range(100):
                try:
                    if request(main_port, "/healthz")[0] == 200:
                        break
                except OSError:
                    pass
                assert process.poll() is None, "session manager failed to start"
                time.sleep(0.1)
            else:
                raise AssertionError("listener did not become ready")
            status = request(main_port, "/auth/login/" + cfg["providers"][0]["id"])[0]
            assert status == (303 if trust else 503), (trust, status)
            assert request(main_port, "/internal/check")[0] == 404
            for path in ("/auth/providers", "/api/projects", "/healthz"):
                assert request(check_port, path)[0] == 404, path
            for method in ("POST", "PUT", "DELETE", "HEAD"):
                assert request(check_port, "/internal/check", method)[0] == 405, method
            status, body, headers = request(check_port, "/internal/check")
            assert status == 200 and json.loads(body) == {"allowed": False}
            assert headers["cache-control"] == "no-store"
            token = secrets.token_hex(32)
            session = {"subject": "fixture", "name": "Fixture", "provider": "keycloak",
                       "roles": ["viewer"], "created_at": int(time.time()),
                       "expires_at": int(time.time()) + 300, "csrf": "fixture"}
            run("docker", "exec", container, "redis-cli", "SET",
                "session:" + hashlib.sha256(token.encode()).hexdigest(), json.dumps(session), "EX", "300")
            for path, allowed in (("/api/projects", True), ("/api/admin", False)):
                _, body, _ = request(check_port, "/internal/check", headers={
                    "Cookie": "__Host-ag_session=" + token,
                    "X-Original-Method": "GET", "X-Original-Path": path})
                assert json.loads(body) == {"allowed": allowed}, path
            process.terminate()
            process.wait(timeout=10)
            assert process.returncode == 0, "SIGTERM did not shut down cleanly"
            process = None
        print("PASS: IPv6 listeners, check-only isolation, RBAC, CA verification, SIGTERM")
finally:
    if process and process.poll() is None:
        process.kill()
        process.wait()
    if server:
        server.shutdown()
    subprocess.run(["docker", "rm", "-f", container], stdout=subprocess.DEVNULL,
                   stderr=subprocess.DEVNULL)
