# Deploy with central Argo CD

This is an **editable example**, not a connection to a running cluster. All
`example.com` hostnames, mesh identities, issuer names, and secret-store names
must be replaced with values from your own platform before syncing.

The reference overlay targets an IPv6 OpenShift cluster with RHCL 1.5, Service
Mesh 3.5 ambient mode, Keycloak Operator 26.8.2, Redkey Operator 0.2.0, and ESO.
Install and configure these operators first. Central Argo CD manages the remote
cluster; it does not need to run alongside the application workloads.

## Configure your deployment

**Start with [Before you deploy](PREREQUISITES.md).** It lists required platform
services, operator watch scopes, all eight Vault records, mesh/network settings,
and read-only checks to complete before creating the Argo applications.

| Setting | Example value | Where to change it |
| --- | --- | --- |
| Git source | `https://github.com/arencloud/aegisgate.git` | AppProject and four Application manifests |
| Argo namespace | `argocd` | Bootstrap manifests |
| Workload API | `https://api.cluster.example.com:6443` | AppProject destinations and all Applications |
| Application host | `demo.aegisgate.example.com` | Gateway, routes, readiness, Rust origin, realm redirect/origin |
| Identity host | `auth.aegisgate.example.com` | Gateway, routes, readiness, Keycloak hostname, ESO issuer template |
| Mesh trust domain | `mesh.example.com` | Principal patches in `*/overlays/example` |
| Discovery label | `ambient-single-mesh: example-mesh` | Namespace patches in Gateway, identity, and cache overlays |
| Secret store | `ClusterSecretStore/example-vault` | ExternalSecret resources, including Redis client |
| Certificate issuer | `ClusterIssuer/example-issuer` | Gateway overlay TLSPolicy |
| Authorino identity | `kuadrant-system/authorino-authorino` | Session-manager transport policy |

Search the repository for `example.com`, `example-vault`, `example-issuer`, and
`example-mesh` to locate configuration points. Keep paired hosts consistent: the
browser origin, issuer, certificate names, and OIDC redirect must agree.
`example.com` is documentation-only; the reference URLs are not a hosted demo.

The [identity guide](README.md#existing-vault-records) lists the Vault record
schema. Create your own values and grant ESO access through a least-privilege
store. No Vault credentials or cluster credentials are supplied. The external
PostgreSQL database must already exist, with its CA and connection settings in
Vault. The database user needs privileges to create Keycloak's tables.

Register the workload cluster with Argo CD using your platform's established
process. Review destination permissions in the supplied AppProject. Configure
repository authentication separately if using a private fork. Choose your own
registry prefix when publishing images; the supplied public Quay references are
pinned example artifacts, not registry credentials.

## Resources and sync order

| Application | Purpose | Namespace |
| --- | --- | --- |
| `aegisgate-gateway` | Gateway, TLS, readiness and shared namespace | `aegisgate` |
| `aegisgate-keycloak` | Identity, realm import, ESO and waypoint | `aegisgate-identity` |
| `aegisgate-redis` | Redkey, ESO and TCP waypoint | `aegisgate-cache` |
| `aegisgate-application` | React, Rust, Quarkus, Coraza and authorization | `aegisgate` |

Render and review before applying:

```sh
kubectl kustomize deploy/gitops
kubectl kustomize deploy/gitops/gateway/overlays/example
kubectl kustomize deploy/gitops/keycloak/overlays/example
kubectl kustomize deploy/gitops/redis/overlays/example
kubectl kustomize deploy/gitops/application/overlays/example
(cd tests/gitops && go test ./...)
```

After publishing your customized revision, use your central Argo CLI context:

```sh
argocd proj create -f deploy/gitops/project-aegisgate.yaml --grpc-web
argocd app create -f deploy/gitops/application-gateway.yaml --grpc-web
argocd app create -f deploy/gitops/application-keycloak.yaml --grpc-web
argocd app create -f deploy/gitops/application-redis.yaml --grpc-web
argocd app create -f deploy/gitops/application-aegisgate.yaml --grpc-web
argocd app sync aegisgate-gateway --grpc-web
argocd app sync aegisgate-keycloak --grpc-web
argocd app sync aegisgate-redis --grpc-web
argocd app sync aegisgate-application --grpc-web
```

Wait for each dependency to become Ready before syncing its consumers. Inspect
ExternalSecret, Keycloak, realm-import, Gateway and Redkey conditions as well as
Argo status. The bootstrap belongs on the **management cluster**; workloads
belong on the destination cluster. Pin `targetRevision` to a reviewed commit for
a reproducible release. Applications use manual sync by default.

## TLS, DNS, and readiness

TLSPolicy requests separate certificates for the `https` and `keycloak-https`
listeners. Configure an issuer that permits your two real hostnames and returns
a chain trusted by browsers and application clients. The example policy uses
24-hour certificates, renewal 8 hours before expiry, and rotating RSA 2048 keys;
adapt these values to your issuer.

Both hosts expose **GET `/health/ready`**, without requiring a session. An exact
HTTPRoute rewrites it to Envoy's native `/healthz/ready` through an internal
Service on port 15021. That port is removed from the public LoadBalancer. This
checks the Gateway, not Keycloak, Redis, or the application's dependencies.
Coraza still inspects these requests.

Publish DNS records for your real hosts after inspecting the Gateway's assigned
address. The example LoadBalancer is IPv6-only; adapt `gateway-options.yaml`
for your network. No organization-specific DNS publisher is included.

OpenShift injects a trusted CA bundle into `aegisgate-trusted-ca`. Argo ignores
that ConfigMap's controller-owned `/data`; Rust loads it alongside public roots
at startup. Provide your required CA through the platform trust configuration
and restart the session manager when it changes. Do not disable verification.

## Ambient mesh and authorization

Enable `ENABLE_INGRESS_WAYPOINT_ROUTING=true` in the mesh control plane. Mesh
discovery must include application, identity, cache, and authorization workloads.
Set trust-domain principals to actual service-account identities in your mesh.
The supplied policies retain STRICT mTLS and waypoint enforcement.

The example accommodates Authorino running with a native sidecar: sidecar calls
bypass destination waypoints, so Rust exposes a separate check-only listener.

| Port | Permitted caller | Routes |
| --- | --- | --- |
| 8081 | Session-manager waypoint | Public auth/API routes and pod health |
| 8082 | Configured Authorino service account | Only GET `/internal/check` |

Port 8082 has no public HTTPRoute. Keep the Authorino principal narrow. Verify
the Gateway-to-Authorino connection and fail-closed authorization in your RHCL
installation. Rust checks session/RBAC again on API requests; Quarkus enforces
its internal caller token and roles. See the [architecture guide](../../docs/architecture.md).

## IPv6 and identity lifecycle

The example Keycloak JVM uses `-Djava.net.preferIPv4Stack=false` and
`-Djava.net.preferIPv6Addresses=true`, with HTTP and management binding to `::`.
Adjust these settings for your network. The single-instance PodDisruptionBudget
uses `minAvailable: 1`; it protects against voluntary eviction but also blocks
voluntary drains until you plan maintenance or change availability.

Realm import creates a missing realm once; it does not reconcile existing users
or rotate their passwords when Vault changes. Redis is intentionally ephemeral:
a restart clears sessions and the bounded demo activity log. See the
[Redis guide](redis/README.md) and [session guide](../../docs/identity-and-sessions.md).

## Validate your own environment

No cluster inspection report or private infrastructure inventory is distributed
with this public template. Local rendering and tests do not establish live
admission, TLS trust, authentication, or mesh enforcement.

Use the [browser verification guide](../../docs/demo-guide.md) for readiness,
login/logout, role denial, session revocation, and Coraza checks. In a disposable
test environment also verify unauthorized direct backend access is denied and
authorization dependency failures fail closed. Keep credentials and raw logs out
of public issues; follow [SECURITY.md](../../SECURITY.md).
