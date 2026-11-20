[Documentation home](README.md) / Development reference

# Build, extend, and test AegisGate

Build both supported architectures, connect another identity provider, and run
the checks that verify sessions and permissions.
Run the commands below from the repository root unless stated otherwise.

## Versions

Versions verified on **20 November 2026**; dependency versions are recorded in the included lockfiles.

| Component | Version / target |
| --- | --- |
| Rust | 1.100.0, pinned in `rust-toolchain.toml` and Dockerfile |
| Quarkus | 3.40.1.2; Java 21 |
| React | 19.3.1 |
| Keycloak | Local demo image: 26.4.7; Example operator: 26.8.2 |
| RHCL | Example deployment: 1.5 |
| OpenShift Service Mesh | Example deployment: 3.5, ambient enabled |
| Coraza proxy-WASM | Pinned child manifest from `quay.io/arencloud/coraza`; identical WASM layer in the supplied AMD64 and ARM64 entries |

Rust and Quarkus versions are pinned in the project build files and lockfiles.
Use the [deployment verification guide](demo-guide.md#deployment-verification)
to validate your environment. [OpenShift GitOps](../deploy/gitops/DEPLOYMENT.md)
is the reference deployment; the separate [renderer guide](openshift.md) describes
the older all-in-one path.

## Publish AMD64 and ARM64 images

```sh
docker login quay.io
./scripts/build-images.sh
```

This publishes `quay.io/arencloud/aegisgate-webui:demo`, `quay.io/arencloud/aegisgate-backend:demo`, and `quay.io/arencloud/aegisgate-session-manager:demo`. Each tag contains both `linux/amd64` and `linux/arm64`; the script verifies the published platforms. Set `IMAGE_TAG` for a release tag or `IMAGE_PREFIX` for another registry namespace. Use the same overrides when running the OpenShift installer.

Coraza reuses your existing `quay.io/arencloud/coraza` artifact, pinned directly to
child manifest `sha256:40e483c634d8714a94c15c21c0979564215120ce9d307587031a8c70adf17d36`.
The parent multi-architecture index causes an Istio checksum mismatch; both
architecture entries contain the same portable WASM layer. Override the renderer
default with `CORAZA_WASM_URL`. Its WAF defaults to blocking (`WAF_MODE=On`);
`WAF_MODE=DetectionOnly` observes matches without blocking. For GitOps, edit the
[WasmPlugin](../deploy/gitops/application/base/coraza-waf.yaml) through Git instead.

## Provider extensions

Add another object to `providers` in `session-manager/config.json`. For Entra ID, start with [provider-entra.example.json](../session-manager/provider-entra.example.json), use your tenant-specific issuer, configure app roles, set `ENTRA_CLIENT_SECRET`, and register `https://YOUR_APP_HOST/auth/callback` as a **Web** redirect URI. Do not use the `common` issuer for this tenant-bound adapter.

`roles_pointer` is a JSON Pointer into the **verified ID token**. `role_mapping` explicitly translates external role names to `viewer`, `operator`, or `admin`. Missing/unmapped roles grant no application access. Keycloak uses `/realm_access/roles`; Entra uses `/roles`. Configure both providers in the same list to offer both at sign-in. A new provider requires no changes to the session store or business application.

Local Compose copies the provider configuration into the Rust image. Rebuild/restart
after changing it. OpenShift GitOps generates configuration through the
[ESO template](../deploy/gitops/application/base/external-secrets.yaml); update it in
Git, sync, and roll out the session manager. The older OpenShift renderer uses a
`session-config` ConfigMap. Expose additional provider secrets through the
deployment's environment. Secrets are referenced by environment-variable name,
never embedded in the provider JSON.

## Development and tests

```sh
cargo test --manifest-path session-manager/Cargo.toml
npm ci --prefix webui
npm run build --prefix webui
# Builds Quarkus and runs its four security tests inside Java 21 / Maven.
docker build -t aegisgate-backend:dev backend
# With the local installation running:
cd webui
npx playwright install chromium
npm run test:e2e
```

The browser suite logs in through real Keycloak forms and checks anonymous denial, viewer/operator/admin permissions, forged-header denial, CSRF rejection, logout, revocation, invalid login state, and mobile overflow. Screenshots are written to the ignored `artifacts/` directory.

The Redis expiry/concurrency test is opt-in and requires an isolated test Redis:

```sh
docker run --rm -d --name aegisgate-test-redis -p 127.0.0.1:16379:6379 redis:8-alpine
REDIS_TEST_URL=redis://127.0.0.1:16379 cargo test --manifest-path session-manager/Cargo.toml -- --ignored
docker stop aegisgate-test-redis
```

Frontend development can use `npm run dev --prefix webui`; configure a native session manager at port 8081, set `PUBLIC_ORIGIN` to the Vite origin, and update the Keycloak client redirect URI to match. The simplest integrated development loop is rebuilding the changed Compose service.

## Demo boundaries

The three applications are sample business records. The operator action returns an authorization result and never deploys a real workload. The activity log keeps the last 200 Rust events in Redis; the UI reads up to 100. It is not a durable compliance log, and gateway-level denials must be inspected in gateway/Authorino logs.

Redis is intentionally ephemeral: restarting it invalidates sessions and clears
the event log. Local Keycloak uses a persistent development database; the example
operator-managed Keycloak uses external PostgreSQL. Both demo paths use a single
Keycloak instance. Production use would require supported database/HA arrangements,
credential rotation, durable audit storage, operational monitoring, and tuned WAF rules.

Sessions do not silently refresh provider tokens. Their maximum lifetime is the smaller of the configured limit and the ID-token lifetime. IdP role changes or disabled users do not retroactively change an existing application session: revoke it or wait for expiry. Signing out removes the application session; the provider's SSO session may still allow a subsequent sign-in without another password prompt.

---

[← Book cover](../README.md) · [Documentation authoring →](authoring.md) · [Apache 2.0 license](../LICENSE)
