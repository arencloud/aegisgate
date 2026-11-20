# Robin 0.2.0 standalone IPv6 compatibility

Example is IPv6-only. Upstream Robin 0.2.0 concatenates Redis pod IPs and ports
without brackets in Kubernetes discovery and metrics collection. Go TCP dialing
rejects these addresses, preventing standalone readiness and metrics.

The patch uses `net.JoinHostPort` in those two paths and `net.SplitHostPort` when
recording standalone node status. IPv6 discovery and status regression tests
cover both address forms. It retains Redkey Operator 0.2.0 and the upstream Robin 0.2.0
runtime. Source checkouts are pinned to their 0.2.0 commits; the final base image
is digest-pinned. The build runs the Kubernetes, metrics, and standalone tests.

This patch supports AegisGate's **standalone** mode. It is not a claim of general
IPv6 support for Robin's Redis Cluster scaling/upgrade paths, which contain
additional address parsing. Do not switch this deployment to Redis Cluster mode
without extending and validating IPv6 support upstream.

```sh
docker buildx build --platform linux/amd64,linux/arm64 \
  --tag quay.io/arencloud/aegisgate-redkey-robin:0.2.0-ipv6.1 \
  --push deploy/images/redkey-robin
```

The public image contains `linux/amd64` and `linux/arm64` variants. The Example
Redis overlay pins the published index:

`sha256:34170aebc2e38e6dfa40ae815c933dfa7ce67f861a1ce1c9e93d47b6619261da`

Other overlays keep the upstream image. The patch and upstream source retain
their Apache-2.0 licensing; the inherited image retains its existing runtime licenses.

Sources: [pod address construction](https://github.com/InditexTech/redkey-robin/blob/0.2.0/internal/kubernetes/objects.go),
[metrics collection](https://github.com/InditexTech/redkey-robin/blob/0.2.0/internal/metrics/collector.go).
