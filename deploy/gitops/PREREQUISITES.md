# Before you deploy

**Prepare the platform first. Then let Argo CD create AegisGate.**

The GitOps bootstrap creates an AppProject and four Applications. It does not
install platform operators, configure their cluster-wide instances, provision
PostgreSQL or Vault, or register a cluster with Argo CD. An installed operator
alone is not enough: its controllers and required platform configuration must
also be ready.

## 1. What must already exist?

| Dependency | Required preparation | Where it runs |
| --- | --- | --- |
| OpenShift | Healthy workload cluster; capacity for the app, identity, cache, ingress and waypoint pods; network access to required registries | Workload cluster |
| Central Argo CD | Running instance, authenticated CLI, Git access, and registered workload cluster with permission to manage the namespaces and allowed resource kinds | Management cluster, or an existing instance on the workload cluster |
| Service Mesh 3.5 | Running Istio control plane, ambient CNI and ztunnel components; discovery configured for the relevant namespaces | Workload cluster |
| Gateway API and controllers | Required CRDs plus accepted `istio` and `istio-waypoint` GatewayClasses | Workload cluster |
| RHCL 1.5 | Installed operator **and configured Kuadrant instance**; working authorization/Authorino and TLS policy reconciliation | Workload cluster |
| cert-manager | Running controllers and a Ready `ClusterIssuer` permitted to issue certificates for both real application/identity hosts | Workload cluster |
| Keycloak Operator 26.8.2 | Running operator that watches `aegisgate-identity`; verify its install mode, OperatorGroup and watch scope | Workload cluster |
| Redkey Operator 0.2.0 | Running operator that watches `aegisgate-cache` | Workload cluster |
| External Secrets Operator | Running controller serving `external-secrets.io/v1`; Ready `ClusterSecretStore` backed by your Vault | Workload cluster |
| Vault | Reachable service, authenticated ESO access, KV-v2 records listed below and permissions for all three consuming namespaces | Your secret-management platform |
| PostgreSQL | Existing dedicated Keycloak database/schema and user with DDL privileges; TLS certificate, matching DNS hostname and CA | Reachable from Keycloak pods |
| External ingress and DNS | Working LoadBalancer implementation, routable addresses, and authority to publish the two real DNS names | Your network/DNS platform |

These versions describe the repository's reference configuration. Choose an
OpenShift/product combination supported by your vendors and validate the served
APIs on that installation; this guide does not establish a new support matrix.

The example store and issuer names are `example-vault` and `example-issuer`.
Replace them consistently with your own resource names. Vault as a **secret
store** does not require Vault as a **certificate issuer**: choose a cert-manager
issuer appropriate to your environment and provide its separate credentials.
The supplied TLSPolicy references that issuer; it does not create it.

## 2. Make the network and mesh ready

- Configure mesh discovery to match the namespace label applied by your
  overlays. The example uses `ambient-single-mesh: example-mesh`. This is
  separate from the `istio.io/dataplane-mode: ambient` enrollment label.
- Ensure `ENABLE_INGRESS_WAYPOINT_ROUTING=true` is effective in the control
  plane. The manifests opt the relevant Services into ingress waypoint routing.
  See [Istio's ingress-to-waypoint requirements](https://istio.io/latest/docs/ambient/usage/waypoint/#ingress-gateways-and-waypoints).
- Replace `mesh.example.com` principals with your mesh's actual trust domain.
  Verify the Gateway, waypoint, session-manager and Authorino service accounts;
  keep the authorization policies restricted to those identities.
- The reference Authorino uses a native sidecar and calls Rust's private
  `session-check` listener on port 8082. Verify that this connection uses the
  expected mTLS identity. The Gateway-to-Authorino authorization connection must
  also work and fail closed when authorization is unavailable.
- Provide pod access to Vault, PostgreSQL, image registries and the public OIDC
  issuer hostname. The browser and session manager must both resolve and trust
  the identity endpoint through the Gateway.
- The `example` overlay is **IPv6-oriented**: it requests an IPv6 LoadBalancer
  and sets Java/listener preferences accordingly. Adapt the network-related
  overlays for an IPv4 or dual-stack environment before syncing.
- Plan TLS trust before login. For a private CA, configure browser trust and
  OpenShift's injected trusted bundle used by Rust. The PostgreSQL CA is supplied
  separately through its Vault record. Do not turn off certificate validation.

DNS records can be published once the Gateway receives its address, but they
must resolve correctly before testing login. No private DNS-publisher controller
or configuration is included.

## 3. Create your own Vault records

The example store uses KV v2 with mount `secret`. The paths below are relative
to that mount; ESO handles the KV-v2 `/data/` API segment. Configure store access
for `aegisgate`, `aegisgate-identity`, and `aegisgate-cache`.

| Record | Required fields | Constraints |
| --- | --- | --- |
| `aegisgate/postgresql` | `host`, `port`, `database`, `username`, `password`, `sslmode`, `sslrootcert_pem` | Existing database; DNS host matching its certificate; `sslmode=verify-full`; PEM CA |
| `aegisgate/keycloak/bootstrap` | `username`, `password`, `realm` | Bootstrap realm is `master`; separate from the application admin |
| `aegisgate/keycloak` | `client_id`, `client_secret`, `realm` | Nonempty client values; realm is `aegisgate` |
| `aegisgate/keycloak/users/admin` | `username`, `password`, `realm`, `role`, `temporary` | Realm `aegisgate`, role `aegis-admin`, JSON boolean `temporary=false` |
| `aegisgate/keycloak/users/operator` | Same user fields | Realm `aegisgate`, role `aegis-operator`, JSON boolean `temporary=false` |
| `aegisgate/keycloak/users/viewer` | Same user fields | Realm `aegisgate`, role `aegis-viewer`, JSON boolean `temporary=false` |
| `aegisgate/redis` | `username`, `password`, `database`, `port` | User `default`, database `0`, port `6379`; nonempty password using letters, digits, `_` and `-` |
| `aegisgate/backend` | `token` | Random value of at least 32 characters |

Generate distinct strong credentials in your own secret-management workflow.
Do not commit their values or put passwords directly in shell commands that
will be saved to history. Record structure and validation are implemented in the
[Keycloak](keycloak/base/external-secrets.yaml),
[Redis](redis/base/external-secret.yaml), and
[application](application/base/external-secrets.yaml) ExternalSecrets.

You do **not** need to create the Keycloak realm, OIDC client, demo users,
Kubernetes application Secrets or Redis server manually. The operators and ESO
create them from GitOps resources and your Vault values. Realm import is
create-once; later Vault changes do not update existing realm credentials.

## 4. Check the platform before creating the Argo applications

Run these read-only commands against the **workload cluster**. Substitute your
real store and issuer names. They inspect resource metadata and readiness,
without reading secret values.

```sh
oc whoami --show-server
oc get clusteroperators
oc get csv -A
oc get gatewayclass istio istio-waypoint

oc api-resources --api-group=gateway.networking.k8s.io
oc api-resources --api-group=security.istio.io
oc api-resources --api-group=extensions.istio.io
oc api-resources --api-group=kuadrant.io
oc api-resources --api-group=cert-manager.io
oc api-resources --api-group=external-secrets.io
oc api-resources --api-group=k8s.keycloak.org
oc api-resources --api-group=redkey.inditex.dev

oc wait --for=condition=Ready clustersecretstore/example-vault --timeout=120s
oc wait --for=condition=Ready clusterissuer/example-issuer --timeout=120s
```

Check that the served APIs include the versions used by these manifests:

| Resources | API version |
| --- | --- |
| Gateway, HTTPRoute | `gateway.networking.k8s.io/v1` |
| AuthorizationPolicy, PeerAuthentication | `security.istio.io/v1` |
| WasmPlugin | `extensions.istio.io/v1alpha1` |
| AuthPolicy, TLSPolicy | `kuadrant.io/v1` |
| ClusterIssuer, Certificate | `cert-manager.io/v1` |
| ExternalSecret, ClusterSecretStore | `external-secrets.io/v1` |
| Keycloak, KeycloakRealmImport | `k8s.keycloak.org/v2beta1` |
| Redkey | `redkey.inditex.dev/v1beta1` |

Also inspect the actual mesh, RHCL, ESO and operator pods and their instance
conditions in your installation namespaces. An API listing only proves that the
API exists; it does not prove controller readiness or correct operator watches.
A Ready store does not prove every record exists, and a Ready issuer does not
prove it permits the chosen hostnames. Verify both with your platform owners.

In the **central Argo CLI context**, verify access:

```sh
argocd cluster list
argocd repo list
```

The registered destination must match the API server configured in all four
Applications and the AppProject. Ensure Argo can fetch the chosen revision;
register credentials separately if your fork is private. Keep registration
credentials and raw environment inspection output outside this repository.

## 5. What GitOps creates next

| Stage | Created by the supplied applications |
| --- | --- |
| Gateway | Shared namespace, ingress Gateway, TLS policy, readiness route and internal readiness Service |
| Identity | Identity namespace, ExternalSecrets, Keycloak CR, realm import, identity waypoint and mesh policies |
| Cache | Cache namespace, ExternalSecret, Redkey CR, Redis Service, TCP waypoint and mesh policies |
| Application | React/Rust/Quarkus workloads and Services, ExternalSecrets, app waypoints, routes, Coraza WasmPlugin and AuthPolicy |

The Redis configuration is ephemeral and requests **no PVC**, so a default
StorageClass is not required for this cache. PostgreSQL persistence belongs to
your database platform. If you change the persistence design, add the storage
and backup prerequisites for that design.

Kiali, Prometheus and tracing backends are useful optional observability tools;
these manifests do not install them. Coraza uses the pinned OCI WASM artifact;
there is no separate Coraza Operator to install. Verify registry access from the
cluster, and provide pull credentials separately if you use private images.

When these prerequisites are satisfied, continue to
**[configure the deployment and sync in dependency order →](DEPLOYMENT.md)**.
