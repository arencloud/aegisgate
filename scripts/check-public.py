#!/usr/bin/env python3
"""Check the Git index for files and infrastructure details unsuitable for release.

Run after staging. This complements Gitleaks; it is not a secret scanner.
Only file paths and finding categories are printed, never matching values.
"""
from pathlib import PurePosixPath
import re
import subprocess
import sys

root = subprocess.check_output(['git', 'rev-parse', '--show-toplevel'], text=True).strip()
entries = subprocess.check_output(['git', '-C', root, 'ls-files', '--stage', '-z']).decode().split('\0')
excluded_dirs = {'.idea', '.kube', '.docker', 'node_modules', 'target', 'dist',
                 'artifacts', 'audit-results', 'test-results', 'playwright-report', '__pycache__'}
excluded_suffixes = {'.pem', '.key', '.p12', '.pfx', '.jks', '.keystore', '.har', '.log', '.dump', '.sql'}
patterns = {
    'private infrastructure hostname': re.compile(r'(?i)\b(?:[a-z0-9-]+\.)+arencloud\.com\b'),
    'personal filesystem path': re.compile(r'/(?:Users|home)/[A-Za-z0-9_.-]+/'),
    'private key material': re.compile(r'-----BEGIN (?:RSA |EC |OPENSSH |DSA |ENCRYPTED )?PRIVATE KEY-----'),
    'embedded certificate': re.compile(r'-----BEGIN CERTIFICATE-----\s+[A-Za-z0-9+/=\r\n]{40,}'),
    'credential-bearing URL': re.compile(r'\b[a-z]+://[^\s/"\']+:[^\s/"\']+@'),
}
findings = []
count = 0
for entry in entries:
    if not entry:
        continue
    metadata, name = entry.split('\t', 1)
    mode, _, stage = metadata.split()
    path = PurePosixPath(name)
    count += 1
    if mode not in {'100644', '100755'} or stage != '0':
        findings.append((name, 'non-regular file or unresolved merge'))
        continue
    forbidden = (set(path.parts) & excluded_dirs or path.suffix in excluded_suffixes
                 or 'kubeconfig' in path.name.lower()
                 or name.startswith('deploy/generated/')
                 or (path.name.startswith('.env') and path.name != '.env.example')
                 or path.name in {'.npmrc', '.netrc', '.DS_Store'}
                 or path.name.startswith('gitleaks-report'))
    if forbidden:
        findings.append((name, 'local/generated/sensitive file'))
    data = subprocess.check_output(['git', '-C', root, 'show', ':' + name])
    try:
        content = data.decode('utf-8')
    except UnicodeError:
        continue  # Review binary assets separately; never claim text scans inspect pixels.
    for label, pattern in patterns.items():
        if pattern.search(content):
            findings.append((name, label))
    if path.suffix in {'.yaml', '.yml'}:
        if re.search(r'^kind:\s*Secret\s*$', content, re.M):
            findings.append((name, 'literal Kubernetes Secret; use ExternalSecret'))
        if re.search(r'^kind:\s*Config\s*$', content, re.M) and re.search(r'^clusters:', content, re.M):
            findings.append((name, 'kubeconfig document'))

for name, label in findings:
    print(f'{name}: {label}')
print(f'Checked {count} indexed files; {len(findings)} publication-boundary findings.')
sys.exit(bool(findings))
