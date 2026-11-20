# Security and public repository boundaries

This repository contains application source, illustrative media, and example
deployment configuration. It does not contain a ready-to-use cluster connection
or a set of shared demo credentials. Generate your own local passwords with the
installer; provide cluster secrets through ESO and your own Vault store.

## Before publishing a change

Stage only intended files, review the diff, and run:

```sh
python3 scripts/check-public.py
gitleaks dir --redact --no-banner .
gitleaks git --log-opts=--all --redact --no-banner .
```

The boundary check reads the Git index. It rejects generated output, local
credential files, private infrastructure hostnames, literal Kubernetes Secrets,
private keys, and credential-bearing URLs. Gitleaks adds credential-pattern
scanning. The GitHub workflow runs both checks on pushes and pull requests.
Checks after a public push cannot undo exposure; run them locally first.

Review images and every animation frame separately. Automated text scans do not
inspect pixels. The documentation showcases are illustrative captures of the
signed-out walkthrough, not screenshots of Vault, real accounts, or cluster
administration. Review binary metadata as well as visible content when replacing
these assets.

Keep `.env`, generated realm files, kubeconfigs, registry authentication, private
keys, database dumps, browser HAR files, raw logs, and audit reports out of Git.
Ignore rules do not protect files already tracked. Public Quay image names and
image digests identify artifacts; they are not registry credentials. Review
container contents independently when publishing a new image.

## Example infrastructure

All `example.com` hosts are placeholders. Change the API destination, Gateway
hosts, OIDC issuer/origin/callback, mesh trust domain and discovery labels,
certificate issuer, ESO store, and Authorino service-account identity together.
Follow the [deployment guide](deploy/gitops/DEPLOYMENT.md) before syncing.

Keep private operational overlays in a separate repository. Do not merge private
repository history into this public project merely to transfer a code change;
review a source patch or a clean export instead. Run both scans again after each
transfer. A clean scan reduces risk but cannot prove that no sensitive information
exists or establish application security.

## Reporting a security issue

Do not attach credentials, cookies, personal data, or unredacted environment dumps
to a public issue. Use GitHub's private vulnerability reporting option if enabled.
Otherwise, ask the maintainers for a private reporting channel without posting
the sensitive details. Supply a minimal reproduction with synthetic values.

If a credential is exposed, revoke or rotate it at its issuer. Removing the file
or rewriting Git history does not make an exposed credential safe to reuse.
