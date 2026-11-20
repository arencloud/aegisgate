[Documentation home](README.md) / Run locally

# Your first AegisGate session

**Start the demo, choose an identity, and explore what it may do.**

Requirements: Docker with Compose, Python 3, curl, and available ports 8080/8180. The container builds include Rust and Java; host Java/Maven are not needed.

Run this command from the repository root:

```sh
./scripts/install-local.sh
```

Open **http://localhost:8080**. Choose **Start a secure session → Keycloak**.

| Username | Password in `.env` | Permissions |
| --- | --- | --- |
| `viewer` | `DEMO_VIEWER_PASSWORD` | Read applications; privileged actions return 403 |
| `operator` | `DEMO_OPERATOR_PASSWORD` | Read applications and run the demo operator action |
| `admin` | `DEMO_ADMIN_PASSWORD` | All application actions, session revocation, activity log |

Passwords are random and generated once. The Keycloak administration console is at **http://localhost:8180**, with username `bootstrap-admin` and `KEYCLOAK_ADMIN_PASSWORD` from `.env`. Do not commit `.env` or `deploy/generated/`: they contain credentials.

```sh
# Stop without removing the Keycloak realm or users.
docker compose down
# Restart the installed demo.
docker compose up -d
```

Keycloak imports a realm only when it does not already exist. Rerendering the import does not change an existing realm's passwords, client secret, or redirect URI. Use the admin console for changes.

**Local scope:** authentication, sessions, RBAC, CSRF, the UI, and Quarkus work locally. RHCL, Coraza, ambient mTLS, and waypoint enforcement require the OpenShift installation. The UI distinguishes configured architecture from observed application behavior; it does not invent traffic metrics or claim cluster health.

## Explore the walkthrough

Open **[How it works](http://localhost:8080/#journey)** in the running demo. The interactive guide follows a request from the browser through HTTPS, Coraza inspection, RHCL authorization, Rust session/RBAC checks, the ambient waypoint, and Quarkus.

Choose normal access, first sign-in, a malicious request, insufficient permissions, an expired session, or a direct backend attempt. Use **Follow request**, **Next step**, or the progress markers to explore the sequence. Select any layer for a plain-language explanation and optional technical details. The guide also explains Keycloak/Entra integration and Redis session creation, expiry, and revocation. **Print guide** produces a printable version of the selected scenario.

These are illustrative scenarios; the walkthrough sends no test traffic and does not report live WAF or mesh enforcement.

The same six showcases are available in the **[Markdown walkthrough](how-it-works.md)**,
with optional animations, still images, and complete written explanations.

---

[← Book cover](../README.md) · [Try the browser demonstrations →](demo-guide.md) · [Deploy on OpenShift](../deploy/gitops/DEPLOYMENT.md)
