#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
python3 scripts/configure.py
docker compose up --build -d
printf 'Waiting for Keycloak and the application'
for attempt in $(seq 1 90); do
  if curl -fsS http://localhost:8180/realms/aegisgate/.well-known/openid-configuration >/dev/null && curl -fsS http://localhost:8080/auth/providers >/dev/null; then
    printf '\nAegisGate: http://localhost:8080\nKeycloak: http://localhost:8180\nDemo usernames: viewer, operator, admin. Passwords: .env (DEMO_*_PASSWORD).\n'
    exit 0
  fi
  printf '.'
  sleep 2
done
printf '\nServices did not become ready. Inspect docker compose logs.\n' >&2
exit 1
