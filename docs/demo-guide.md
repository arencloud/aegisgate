[Documentation home](README.md) / Browser demo guide

# Show the protection. Then show the evidence.

**A guided presentation for your deployed demo.**

All `example.com` links below are placeholders. Substitute your own hosts after
following the [deployment guide](../deploy/gitops/DEPLOYMENT.md).

Use the animated walkthrough to explain the design, then use real requests to
verify specific behaviors. Keep those two parts distinct: an animation explains
a policy; an observed response and matching telemetry demonstrate its enforcement.

[Application](https://demo.aegisgate.example.com/) · [Interactive walkthrough](https://demo.aegisgate.example.com/#journey) · [Identity provider](https://auth.aegisgate.example.com/)

## Before the demo

Open the application in a browser that trusts the Gateway certificate and can
resolve both public hostnames. Have the demo credentials available from your
approved Vault access. Credentials are intentionally absent from these guides.
Use separate browser profiles for viewer and operator/admin demonstrations so
Keycloak's SSO session does not unexpectedly reuse another identity.

Open **Developer Tools → Network** to inspect response status codes. In another
tab, open the OpenShift console at **Workloads → Pods → namespace `aegisgate` →
Gateway pod → Logs → container `istio-proxy`**.

## 1. Show a healthy public entrance

Open [application readiness](https://demo.aegisgate.example.com/health/ready)
and [identity-host readiness](https://auth.aegisgate.example.com/health/ready).

**Expected:** HTTP **200** without logging in. A blank body is normal.

**Explain:** the same Gateway has two HTTPS listeners. Readiness is deliberately
public and measures the Gateway itself. It does not prove that a user can sign
in or that PostgreSQL, Redis, and every application dependency are healthy.

## 2. Watch Coraza stop a test request

Open the [normal homepage](https://demo.aegisgate.example.com/), then open this
[harmless XSS-shaped query](https://demo.aegisgate.example.com/?waf_test=%3Cscript%3Ealert%281%29%3C%2Fscript%3E).

**Expected:** the normal homepage returns **200**; the test query returns **403**
in the supplied blocking configuration. The example is query data for inspection,
not an instruction to execute code.

**Evidence:** in the Gateway logs, find the `waf_test` parameter together with
`Coraza`, `XSS Attack Detected`, and `Access denied`. Look for CRS attack rules such as
`941100` and the anomaly-blocking rule `949111`; exact matches depend on the
artifact and rule configuration.

**Explain:** this route is public, so the test isolates WAF inspection from the
API session check. A 403 response alone does not tell you which control denied it.

Return to a clean homepage URL after the test. A browser may otherwise carry the
test URL in its `Referer` header for a favicon or other resource, causing another
legitimate WAF match in the logs.

<details>
<summary>Equivalent command-line checks</summary>

```sh
curl -i 'https://demo.aegisgate.example.com/health/ready'
curl -i --get \
  --data-urlencode 'waf_test=<script>alert(1)</script>' \
  'https://demo.aegisgate.example.com/'

oc -n aegisgate logs \
  -l gateway.networking.k8s.io/gateway-name=aegisgate-gateway \
  -c istio-proxy --since=2m --prefix=true |
  grep -E 'Coraza:|941100|949111'
```

Use an `oc` context targeting your workload cluster. Do not disable TLS certificate validation
as a workaround for DNS or trust configuration.

</details>

## 3. Follow a real sign-in

Choose **Start a secure session → Keycloak** and sign in as the demo viewer.
Then open the application catalog.

**Expected:** the browser visits the identity hostname, returns through
`/auth/callback`, and displays the viewer's permitted data. The corresponding
`GET /api/projects` request should succeed.

**Explain:** Keycloak establishes identity. Rust validates that result and creates
a Redis session. The browser receives an opaque HttpOnly cookie; React does not
hold the provider's tokens.

Use the [first-sign-in animation](how-it-works.md#02-first-sign-in) to explain the
parts of that exchange which are not visible on the page.

## 4. Separate authentication from permission

While signed in as a viewer, attempt the demo operator action. Then try the same
action with the operator identity in a separate browser profile.

**Expected:** the viewer's write is denied; the operator's write is allowed when
the session, origin, and CSRF checks pass. The action returns a sample deployment
result and does not create a Kubernetes workload.

**Evidence:** inspect the action's request in the Network panel and the
application decision log where available. For Gateway denials, inspect Authorino
and Gateway telemetry; not every edge denial becomes a Rust audit event.

## 5. Show session revocation without waiting

Keep a viewer session open in one browser profile. In a separate administrator
profile, open the sessions view and revoke that viewer session. Refresh the
viewer session's data or attempt another protected action.

**Expected:** the next session check fails. The stale browser cookie does not
restore the deleted Redis record. A request already authorized before revocation
may still finish.

To demonstrate idle expiry instead, leave the session without session-checking
requests for 15 minutes. Remember that background authenticated requests count
as activity. The [session guide](identity-and-sessions.md) explains both clocks.

## 6. Read Kiali without confusing denials with outages

| What appears | What to inspect |
| --- | --- |
| Orange API edge | Its response-code breakdown. Expected 401/403 security denials can color the graph. |
| Service triangle and application square with similar names | They represent distinct graph objects, not necessarily duplicate deployments. |
| A terminal Service node for rejected traffic | A Gateway denial can have a known target Service but no destination workload because it was never forwarded. |
| Unknown destination | Look at the underlying metric labels. External PostgreSQL traffic and direct pod-address traffic may lack a registered Service name. |
| `latest` under a versioned app | This is a telemetry revision label; inspect image references to determine the actual deployed digest. |
| No recent application edge | The graph shows traffic within the selected time window; generate the relevant request or increase the window. |

Use **Workload graph** and HTTP traffic for an application-focused view. Include
TCP/ztunnel traffic when exploring Redis and database connections. The
[Kiali graph FAQ](https://kiali.io/docs/faq/graph/) explains terminal Service nodes,
unknown destinations, and traffic-window behavior.

An mTLS label on Robin → Redis does not mean Robin uses the Redis waypoint:
Robin has an explicit direct management exception. Check the actual source and
destination identities rather than inferring the route from encryption alone.

## 7. Recognize the separate RHCL tracing message

If the Gateway emits:

```text
kuadrant_wasm_shim ... proxy_on_grpc_receive invalid context_id, no match found
```

Distinguish the Kuadrant shim from the Coraza plugin. Correlate the request's
status, authorization calls, trace-export activity, and timestamps. A late
callback can outlive its request context; this message alone does not establish
that authorization or WAF inspection failed. Preserve redacted evidence when
reporting the behavior upstream.

## Deployment verification

Record results from your own deployment. The public repository contains no live
cluster status report, credentials, or private infrastructure inventory.

| Check | Evidence to collect |
| --- | --- |
| Keycloak startup | Ready condition and stable restart count |
| Realm import | `Done=True`, `HasErrors=False` |
| Gateway readiness on both hosts | HTTP 200 with TLS verification |
| Normal homepage | HTTP 200 |
| XSS-shaped homepage query | HTTP 403 and matching Coraza rule events |
| API request without a session | Denied at the Gateway |
| Sign-in, role checks and revocation | Expected responses for each demo identity |
| Direct backend access | Unauthorized in-cluster caller denied |
| Authorization dependency unavailable | Protected API fails closed |

Keep cookies, tokens, passwords, and personal data out of saved evidence. Browser
exercises do not replace controlled in-cluster tests of service boundaries.

---

[← Identity and sessions](identity-and-sessions.md) · [Documentation home](README.md) · [Deploy on OpenShift →](../deploy/gitops/DEPLOYMENT.md)
