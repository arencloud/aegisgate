#!/usr/bin/env python3
"""Generate local secrets once, then render a Keycloak realm for installation."""
import json
import os
from pathlib import Path
import secrets

ROOT = Path(__file__).resolve().parent.parent
os.umask(0o077)
env_path = ROOT / '.env'
if not env_path.exists():
    keys = ['KEYCLOAK_ADMIN_PASSWORD', 'KEYCLOAK_CLIENT_SECRET', 'BACKEND_TOKEN', 'DEMO_ADMIN_PASSWORD', 'DEMO_OPERATOR_PASSWORD', 'DEMO_VIEWER_PASSWORD']
    env_path.write_text(''.join(f'{key}={secrets.token_hex(24)}\n' for key in keys))
env = dict(line.split('=', 1) for line in env_path.read_text().splitlines() if '=' in line and not line.startswith('#'))
origin = os.environ.get('PUBLIC_ORIGIN', 'http://localhost:8080').rstrip('/')
realm = {
    'realm': 'aegisgate', 'enabled': True, 'displayName': 'AegisGate',
    'registrationAllowed': False, 'resetPasswordAllowed': False,
    'sslRequired': 'external' if origin.startswith('https://') else 'none',
    'accessTokenLifespan': 3600, 'ssoSessionIdleTimeout': 1800, 'ssoSessionMaxLifespan': 3600,
    'roles': {'realm': [{'name': f'aegis-{role}'} for role in ['viewer', 'operator', 'admin']]},
    'clients': [{
        'clientId': 'aegisgate', 'name': 'AegisGate session manager', 'enabled': True,
        'protocol': 'openid-connect', 'publicClient': False, 'secret': env['KEYCLOAK_CLIENT_SECRET'],
        'standardFlowEnabled': True, 'directAccessGrantsEnabled': False,
        'redirectUris': [f'{origin}/auth/callback'], 'webOrigins': [origin],
        'attributes': {'pkce.code.challenge.method': 'S256'},
        'defaultClientScopes': ['profile', 'email'],
        'protocolMappers': [{
            'name': 'realm-roles-in-id-token', 'protocol': 'openid-connect',
            'protocolMapper': 'oidc-usermodel-realm-role-mapper',
            'config': {'claim.name': 'realm_access.roles', 'jsonType.label': 'String', 'multivalued': 'true',
                       'id.token.claim': 'true', 'access.token.claim': 'true', 'userinfo.token.claim': 'true'}
        }]
    }],
    'users': [{
        'username': role, 'enabled': True, 'emailVerified': True,
        'email': f'{role}@aegisgate.example', 'firstName': 'Demo', 'lastName': role.title(),
        'realmRoles': [f'aegis-{role}'],
        'credentials': [{'type': 'password', 'value': env[f'DEMO_{role.upper()}_PASSWORD'], 'temporary': False}]
    } for role in ['viewer', 'operator', 'admin']]
}
output = ROOT / 'deploy/generated'
output.mkdir(parents=True, exist_ok=True)
(output / 'realm.json').write_text(json.dumps(realm, indent=2))
# Containers must be able to read the bind-mounted import. The parent remains owner-only.
(output / 'realm.json').chmod(0o644)
print('Prepared Keycloak realm. Credentials are in the git-ignored .env file.')
