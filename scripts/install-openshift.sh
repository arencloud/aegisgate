#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
: "${APP_HOST:?Set the application DNS hostname}"
: "${KEYCLOAK_HOST:?Set the Keycloak DNS hostname}"
export IMAGE_PREFIX="${IMAGE_PREFIX:-quay.io/arencloud}"
export IMAGE_TAG="${IMAGE_TAG:-demo}"
export CORAZA_WASM_URL="${CORAZA_WASM_URL:-oci://quay.io/arencloud/coraza@sha256:40e483c634d8714a94c15c21c0979564215120ce9d307587031a8c70adf17d36}"
export WAF_MODE="${WAF_MODE:-On}"
export NAMESPACE="${NAMESPACE:-aegisgate}"
export PUBLIC_ORIGIN="https://${APP_HOST}"
# Prerequisite checks are read-only. The operator versions and ambient installation are cluster-admin responsibilities.
oc whoami >/dev/null
for crd in gateways.gateway.networking.k8s.io httproutes.gateway.networking.k8s.io authpolicies.kuadrant.io wasmplugins.extensions.istio.io authorizationpolicies.security.istio.io peerauthentications.security.istio.io; do
  oc get crd "$crd" >/dev/null
done
oc get gatewayclass istio istio-waypoint >/dev/null
oc get namespace "$NAMESPACE" >/dev/null
oc -n "$NAMESPACE" get secret aegisgate-tls >/dev/null
if [ -n "${CORAZA_IMAGE_PULL_SECRET:-}" ]; then
  export CORAZA_IMAGE_PULL_SECRET
  oc -n "$NAMESPACE" get secret "$CORAZA_IMAGE_PULL_SECRET" >/dev/null
fi
python3 scripts/configure.py
python3 scripts/render-openshift.py
oc apply --dry-run=server -f deploy/generated/openshift.json >/dev/null
oc label namespace "$NAMESPACE" istio.io/dataplane-mode=ambient --overwrite
oc apply -f deploy/generated/openshift.json
for deployment in keycloak redis backend session-manager webui; do
  oc -n "$NAMESPACE" rollout status "deployment/$deployment" --timeout=300s
done
oc -n "$NAMESPACE" wait gateway/backend-waypoint gateway/aegisgate-gateway --for=condition=Programmed --timeout=180s
oc -n "$NAMESPACE" wait authpolicy/application-sessions --for=condition=Accepted --timeout=120s
printf '\nApplication: https://%s\nKeycloak: https://%s\nRun the cluster verification steps in docs/openshift.md before claiming mesh/WAF enforcement.\n' "$APP_HOST" "$KEYCLOAK_HOST"
