#!/usr/bin/env python3
"""Verify the requested Linux variants exist in a published image index."""
import json
import subprocess
import sys

image = sys.argv[1]
expected = set((sys.argv[2] if len(sys.argv) > 2 else 'linux/amd64,linux/arm64').split(','))
result = subprocess.run(['docker', 'buildx', 'imagetools', 'inspect', '--raw', image], check=True, capture_output=True, text=True)
index = json.loads(result.stdout)
platforms = {
    f"{entry['platform']['os']}/{entry['platform']['architecture']}"
    for entry in index.get('manifests', []) if 'platform' in entry
}
missing = expected - platforms
if missing:
    raise SystemExit(f"Missing platforms in {image}: {', '.join(sorted(missing))}")
print(f"Verified {image}: {', '.join(sorted(expected))}")
