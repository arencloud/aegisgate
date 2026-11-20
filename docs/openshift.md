# OpenShift deployment

For the current cluster deployment, start with [Keycloak through GitOps](../deploy/gitops/README.md).
It uses the installed Red Hat Keycloak Operator 26.8.2, ESO `example-vault`, external
PostgreSQL, the RHCL Gateway, and an ambient waypoint. The all-in-one installer
below is a separate legacy demo path and must not manage that same installation.

The installer deploys **Keycloak during installation**, imports the AegisGate realm, and deploys Redis, the Rust session manager, React UI, and Quarkus backend. It also installs Gateway API routing, RHCL AuthPolicy, the Coraza WasmPlugin, and ambient waypoint policies.

This is a deployment template for the requested **RHCL 1.5 / Service Mesh 3.5** stack. No cluster was available during implementation. Confirm the Red Hat support matrix and the Coraza module's compatibility with the installed Envoy runtime before presenting this as a validated combination.

## Prerequisites

- An OpenShift cluster with RHCL 1.5 installed and its Kuadrant/Authorino components ready.
- Service Mesh 3.5 already configured in ambient mode, including istiod, CNI, ztunnel, and the `istio` / `istio-waypoint` GatewayClasses. This repository deliberately does not modify a cluster-wide mesh installation.
- Gateway API, `AuthPolicy`, `WasmPlugin`, `AuthorizationPolicy`, and `PeerAuthentication` CRDs.
- A dedicated `aegisgate` namespace, a default storage class for Keycloak's 1 GiB PVC, and permission to create namespaced resources.
- App and Keycloak DNS names resolving to the OpenShift router. Keycloak uses the router's trusted edge certificate. The app uses a passthrough Route to the TLS Gateway; provide its certificate as `aegisgate-tls` in the demo namespace.
- Three images built for the cluster CPU architecture and pushed to a registry accessible to the namespace. Configure an image pull secret if needed.
- The pinned Coraza OCI image supplied for this demo. Its index was verified to contain AMD64 and ARM64 variants; module loading and behavior still need validation against the cluster’s Envoy runtime.

## Prepare and install

```sh
export NAMESPACE=aegisgate
export APP_HOST=aegisgate.apps.YOUR_CLUSTER
export KEYCLOAK_HOST=keycloak-aegisgate.apps.YOUR_CLUSTER
export IMAGE_PREFIX=quay.io/arencloud
export PLATFORMS=linux/amd64,linux/arm64
export IMAGE_TAG=demo
export CORAZA_WASM_URL=oci://quay.io/arencloud/coraza@sha256:40e483c634d8714a94c15c21c0979564215120ce9d307587031a8c70adf17d36

oc create namespace "$NAMESPACE"
oc -n "$NAMESPACE" create secret tls aegisgate-tls --cert=app.crt --key=app.key
./scripts/build-images.sh
./scripts/install-openshift.sh
```

`build-images.sh` publishes an OCI image index containing **both `linux/amd64` and `linux/arm64`** by default. Each node selects the variant matching its architecture. All three application images use the same tag:

- `quay.io/arencloud/aegisgate-backend:demo`
- `quay.io/arencloud/aegisgate-session-manager:demo`
- `quay.io/arencloud/aegisgate-webui:demo`

Authenticate with `docker login quay.io` before publishing. The existing builder must support both platforms (Docker Desktop does); inspect it with `docker buildx inspect --bootstrap`. Java and React assets build on the builder's native architecture; the Rust binary builds separately for each target. Native runtimes are selected for both architectures. The script verifies each published index and saves build metadata under `artifacts/images/`.

`IMAGE_PREFIX` defaults to `quay.io/arencloud`, `IMAGE_TAG` to `demo`, and `PLATFORMS` to `linux/amd64,linux/arm64`. Override these for another registry, release tag, or a single-architecture build. The installer and manifest renderer use the same registry and tag defaults. The older single `PLATFORM` variable remains a fallback. Private repositories need an OpenShift image pull secret.

The Coraza module is reused from `quay.io/arencloud/coraza` at the pinned digest above. Its published OCI index includes `linux/amd64` and `linux/arm64` variants. The app build script does not rebuild or republish this existing image.

The generated WasmPlugin defaults to **`WAF_MODE=On`** for blocking. To use the supplied example's observe-only behavior, set **`WAF_MODE=DetectionOnly`** before rendering/installing. DetectionOnly records rule matches without enforcing attack-blocking decisions; it must not be presented as a successful WAF block. `FAIL_CLOSE` controls fatal plugin errors independently of the rule-engine mode.

Both modes set debug level 1, enable request-body inspection with 64 KiB body and in-memory limits, set the body-limit action to Reject, and disable response-body inspection. The WAF limits match the existing 64 KiB limits in nginx, Rust, and Quarkus. Inspect actual body-limit behavior in the selected mode during cluster validation.

For a private Coraza repository, create the registry credential Secret in the AegisGate namespace and export `CORAZA_IMAGE_PULL_SECRET=YOUR_SECRET_NAME`. The renderer adds `spec.imagePullSecret`, and the installer checks that the Secret exists. This plugin pull secret is separate from workload image pull secrets.

The prepared application configuration is [coraza-waf.yaml](../deploy/openshift/coraza-waf.yaml). It enables blocking, targets `aegisgate-gateway` in `aegisgate`, and uses the same digest and body limits as the renderer. It has not been applied to a cluster. Use the renderer when overriding the namespace, WAF mode, image digest, or pull secret.

The installer generates random secrets once in `.env` and renders a manifest into `deploy/generated/openshift.json`. Both are ignored by Git. Avoid distributing the rendered manifest because it includes the Keycloak import and credentials.

The installer checks prerequisites, performs `oc apply --dry-run=server`, labels the namespace for ambient enrollment, applies the resources, and waits for workload and Gateway readiness. It does **not** prove WAF execution or waypoint traversal. If a policy is rejected, inspect its condition and the CRD schema provided by your exact operator version; do not remove enforcement to make the readiness check pass.

To render without applying:

```sh
export PUBLIC_ORIGIN="https://${APP_HOST}"
python3 scripts/configure.py
python3 scripts/render-openshift.py
```

Keycloak is single-replica development mode with a persistent data volume. Existing realms are not overwritten by import. Use a separate checkout/credentials file when maintaining independent local and cluster demo identities.

## Enforcement layout

| Layer | Resource / behavior |
| --- | --- |
| TLS ingress | OpenShift passthrough Route → `aegisgate-gateway` HTTPS listener |
| Coraza | Gateway-targeted `WasmPlugin`, AUTHN phase, CRS enabled, FAIL_CLOSE |
| RHCL | AuthPolicy on `application-api` HTTPRoute; external metadata calls Rust `/internal/check` with the actual request cookie/method/path |
| Session/RBAC | Rust validates the Redis session, exact route permissions, and CSRF before proxying |
| Ambient L7 | Backend Service selects `backend-waypoint`; Service-targeted policy accepts the session manager's SPIFFE principal |
| Ambient L4 | Backend workload policy accepts only the waypoint identity; strict mTLS prevents direct plaintext bypass |
| Quarkus | Internal caller credential plus role checks; no browser-facing backend route |
| Redis | Strict mTLS and a workload authorization policy accept only the session manager identity |

The frontend and login routes remain accessible before authentication. The internal decision endpoint is not publicly routed and returns only an allow/deny boolean. Metadata caching is left disabled so revocation takes effect on the next authorization check. Rust repeats authorization even if the gateway policy is absent or misconfigured.

## Verify on your cluster

1. Inspect operator versions and workload readiness. Confirm every application pod is enrolled in ambient mode and the backend Service has `istio.io/use-waypoint=backend-waypoint`.
2. Inspect Gateway `Programmed`, HTTPRoute `Accepted`/`ResolvedRefs`, and AuthPolicy `Accepted`/`Enforced` conditions. Check current `observedGeneration`; stale conditions do not validate a new configuration.
3. Sign in as `viewer`, open Applications, and test an operator/admin action. It must be denied. Repeat as `operator` for an allowed operator action and as `admin` for session revocation. Verify denial after revocation.
4. Use `istioctl ztunnel-config workloads` and waypoint proxy configuration/access telemetry to confirm a successful application request traverses the waypoint. Check service account names against the principals in the policies; the manifests default to the `cluster.local` trust domain; set `TRUST_DOMAIN` before rendering if your mesh differs.
5. From a separately authorized test workload, attempt direct backend Service and pod-IP calls with no session-manager identity. Both must fail. Do not use application credentials for this bypass test.
6. With **`WAF_MODE=On`**, verify Coraza loads successfully in the ingress proxy, then make the following benign control request and intentionally malicious test request **only against your demo hostname**:

   ```sh
   curl -i "https://${APP_HOST}/"
   curl -i --get --data-urlencode 'q=<script>alert(1)</script>' "https://${APP_HOST}/"
   ```

   The control request should return 200. The attack should be rejected with the configured WAF response, normally 403. Use `/` so that a missing API session cannot masquerade as a successful WAF block. Confirm the matching Coraza rule/event in the proxy logs or metrics.
7. In a disposable test deployment, verify that an unavailable session service denies API access and a failed WASM module fails closed. Record actual results before claiming enforcement.

The exact custom WASM/Red Hat combination may require adaptation. Review [Coraza proxy-WASM](https://github.com/corazawaf/coraza-proxy-wasm), [Istio WasmPlugin](https://istio.io/latest/docs/reference/config/proxy_extensions/wasm-plugin/), [waypoint configuration](https://istio.io/latest/docs/ambient/usage/waypoint/), and [Kuadrant AuthPolicy](https://docs.kuadrant.io/latest/kuadrant-operator/doc/reference/authpolicy/). Upstream API support is not a Red Hat support guarantee.
