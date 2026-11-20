For the cluster, use the [operator-based GitOps deployment](../gitops/README.md)
with ESO `ClusterSecretStore/example-vault`, external PostgreSQL, RHCL, ambient mode,
and the Keycloak waypoint.

For the local Compose demo, `scripts/configure.py` generates the realm import during installation. It contains
three realm roles (`aegis-viewer`, `aegis-operator`, `aegis-admin`), matching demo
users, and a confidential OIDC client with PKCE required. Roles are included in the
signed ID token. Random passwords and the client secret are stored in `.env`.

Generated imports contain credentials and must not be committed. Keycloak imports
only a realm that does not already exist; reinstalling does not overwrite existing
users or client configuration. Use the Keycloak console to change an existing realm.
