#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
IMAGE_PREFIX="${IMAGE_PREFIX:-quay.io/arencloud}"
IMAGE_PREFIX="${IMAGE_PREFIX%/}"
IMAGE_TAG="${IMAGE_TAG:-demo}"
PLATFORMS="${PLATFORMS:-${PLATFORM:-linux/amd64,linux/arm64}}"
export IMAGE_PREFIX IMAGE_TAG PLATFORMS
python3 - <<'PY'
import os, re
assert re.fullmatch(r'[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}', os.environ['IMAGE_TAG']), 'Invalid IMAGE_TAG'
assert set(os.environ['PLATFORMS'].split(',')) <= {'linux/amd64', 'linux/arm64'}, 'Supported PLATFORMS: linux/amd64,linux/arm64'
PY
mkdir -p artifacts/images
for component in backend session-manager webui; do
  image="${IMAGE_PREFIX}/aegisgate-${component}:${IMAGE_TAG}"
  printf '\nBuilding and publishing %s for %s\n' "$image" "$PLATFORMS"
  docker buildx build --platform "$PLATFORMS" --tag "$image" \
    --metadata-file "artifacts/images/${component}.json" --push "$component"
  python3 scripts/verify-images.py "$image" "$PLATFORMS"
done
