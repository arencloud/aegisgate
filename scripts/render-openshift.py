#!/usr/bin/env python3
"""Render reviewable Kubernetes JSON (also valid YAML); never applies resources."""
import json
import os
from pathlib import Path
import re

ROOT = Path(__file__).resolve().parent.parent
os.umask(0o077)
namespace = os.environ.get('NAMESPACE', 'aegisgate')
app_host = os.environ['APP_HOST']
idp_host = os.environ['KEYCLOAK_HOST']
registry = os.environ.get('IMAGE_PREFIX', 'quay.io/arencloud').rstrip('/')
image_tag = os.environ.get('IMAGE_TAG', 'demo')
assert re.fullmatch(r'[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}', image_tag), 'Invalid IMAGE_TAG'
trust_domain = os.environ.get('TRUST_DOMAIN', 'cluster.local')
wasm = os.environ.get('CORAZA_WASM_URL', 'oci://quay.io/arencloud/coraza@sha256:40e483c634d8714a94c15c21c0979564215120ce9d307587031a8c70adf17d36')
waf_mode = os.environ.get('WAF_MODE', 'On')
assert waf_mode in ('On', 'DetectionOnly'), 'WAF_MODE must be On or DetectionOnly'
wasm_pull_secret = os.environ.get('CORAZA_IMAGE_PULL_SECRET', '')
if wasm_pull_secret:
    assert re.fullmatch(r'[a-z0-9]([-a-z0-9.]*[a-z0-9])?', wasm_pull_secret), 'Invalid CORAZA_IMAGE_PULL_SECRET'
assert re.fullmatch(r'[a-z0-9]([-a-z0-9]*[a-z0-9])?', namespace), 'Invalid namespace'
for host in (app_host, idp_host):
    assert re.fullmatch(r'[a-z0-9][a-z0-9.-]*[a-z0-9]', host), 'Use bare DNS hostnames'
assert re.fullmatch(r'oci://[^\s]+@sha256:[a-f0-9]{64}', wasm), 'Pin CORAZA_WASM_URL to a valid OCI SHA-256 digest'
env = dict(line.split('=', 1) for line in (ROOT / '.env').read_text().splitlines() if '=' in line and not line.startswith('#'))
items = []
def resource(api, kind, name, spec=None, **kwargs):
    obj = {'apiVersion': api, 'kind': kind, 'metadata': {'name': name, 'namespace': namespace}, **kwargs}
    if spec is not None:
        obj['spec'] = spec
    items.append(obj)
    return obj

def secret_env(key):
    return {'name': key, 'valueFrom': {'secretKeyRef': {'name': 'aegisgate-secrets', 'key': key}}}

def deploy(name, image, port, envs=None, volumes=None, mounts=None, command=None, ready='/healthz', memory='256Mi'):
    resource('v1', 'ServiceAccount', name, automountServiceAccountToken=False)
    container = {'name': name, 'image': image, 'ports': [{'containerPort': port, 'name': 'tcp-redis' if port == 6379 else 'http'}],
        'env': envs or [], 'volumeMounts': mounts or [],
        'resources': {'requests': {'cpu': '100m', 'memory': memory}, 'limits': {'memory': '1Gi'}},
        'securityContext': {'allowPrivilegeEscalation': False, 'capabilities': {'drop': ['ALL']}, 'runAsNonRoot': True},
        'readinessProbe': {'httpGet': {'path': ready, 'port': port}, 'initialDelaySeconds': 10, 'periodSeconds': 5}}
    if ready is None:
        container['readinessProbe'] = {'tcpSocket': {'port': port}, 'initialDelaySeconds': 10}
    if command:
        container['args'] = command
    resource('apps/v1', 'Deployment', name, {
        'replicas': 1, 'strategy': {'type': 'Recreate'}, 'selector': {'matchLabels': {'app': name}},
        'template': {'metadata': {'labels': {'app': name}}, 'spec': {
            'serviceAccountName': name, 'automountServiceAccountToken': False,
            'securityContext': {'seccompProfile': {'type': 'RuntimeDefault'}},
            'containers': [container], 'volumes': volumes or []}}})
    return resource('v1', 'Service', name, {'selector': {'app': name}, 'ports': [{'name': 'tcp-redis' if port == 6379 else 'http', 'port': port, 'targetPort': port}]})

resource('v1', 'Secret', 'aegisgate-secrets', type='Opaque', stringData={k: env[k] for k in ['BACKEND_TOKEN', 'KEYCLOAK_CLIENT_SECRET', 'KEYCLOAK_ADMIN_PASSWORD']})
resource('v1', 'Secret', 'keycloak-realm', type='Opaque', stringData={'realm.json': (ROOT/'deploy/generated/realm.json').read_text()})
config = json.loads((ROOT/'session-manager/config.json').read_text())
config['providers'][0]['issuer'] = f'https://{idp_host}/realms/aegisgate'
resource('v1', 'ConfigMap', 'session-config', data={'config.json': json.dumps(config)})
resource('v1', 'PersistentVolumeClaim', 'keycloak-data', {'accessModes': ['ReadWriteOnce'], 'resources': {'requests': {'storage': '1Gi'}}})
deploy('keycloak', 'quay.io/keycloak/keycloak:26.4.7', 8080,
    envs=[{'name': 'KC_HOSTNAME', 'value': f'https://{idp_host}'}, {'name': 'KC_PROXY_HEADERS', 'value': 'xforwarded'},
        {'name': 'KC_BOOTSTRAP_ADMIN_USERNAME', 'value': 'bootstrap-admin'},
        {'name': 'KC_BOOTSTRAP_ADMIN_PASSWORD', 'valueFrom': {'secretKeyRef': {'name':'aegisgate-secrets','key':'KEYCLOAK_ADMIN_PASSWORD'}}}],
    volumes=[{'name': 'realm', 'secret': {'secretName': 'keycloak-realm'}}, {'name': 'data', 'persistentVolumeClaim': {'claimName': 'keycloak-data'}}],
    mounts=[{'name':'realm','mountPath':'/opt/keycloak/data/import','readOnly':True}, {'name':'data','mountPath':'/opt/keycloak/data'}],
    command=['start-dev','--import-realm'], ready='/realms/aegisgate', memory='512Mi')
resource('route.openshift.io/v1', 'Route', 'keycloak', {'host': idp_host, 'to': {'kind': 'Service','name':'keycloak'},
    'port': {'targetPort':'http'}, 'tls': {'termination':'edge','insecureEdgeTerminationPolicy':'Redirect'}})
deploy('redis', 'redis:8-alpine', 6379, command=['redis-server','--save','','--appendonly','no'], ready=None,
       volumes=[{'name':'data','emptyDir':{}}], mounts=[{'name':'data','mountPath':'/data'}])
backend = deploy('backend', f'{registry}/aegisgate-backend:{image_tag}', 8080,
    envs=[secret_env('BACKEND_TOKEN'), {'name':'DEPLOYMENT_MODE','value':'cluster'}], ready='/q/health/ready')
backend['metadata']['labels'] = {'istio.io/use-waypoint':'backend-waypoint'}
deploy('session-manager', f'{registry}/aegisgate-session-manager:{image_tag}', 8081,
    envs=[secret_env('BACKEND_TOKEN'),secret_env('KEYCLOAK_CLIENT_SECRET'),
        {'name':'PUBLIC_ORIGIN','value':f'https://{app_host}'}, {'name':'REDIS_URL','value':'redis://redis:6379'},
        {'name':'BACKEND_URL','value':'http://backend:8080'}, {'name':'CONFIG_PATH','value':'/config/config.json'}],
    volumes=[{'name':'config','configMap':{'name':'session-config'}}], mounts=[{'name':'config','mountPath':'/config','readOnly':True}])
deploy('webui', f'{registry}/aegisgate-webui:{image_tag}', 8080)
# Gateway controller and waypoint controller must already be provided by Service Mesh.
waypoint = resource('gateway.networking.k8s.io/v1', 'Gateway', 'backend-waypoint', {
    'gatewayClassName':'istio-waypoint', 'listeners':[{'name':'mesh','port':15008,'protocol':'HBONE'}]})
waypoint['metadata']['labels'] = {'istio.io/waypoint-for':'service'}
resource('gateway.networking.k8s.io/v1', 'Gateway', 'aegisgate-gateway', {
    'gatewayClassName':'istio', 'listeners':[{'name':'https','port':443,'protocol':'HTTPS','hostname':app_host,
        'tls': {'mode':'Terminate','certificateRefs':[{'kind':'Secret','name':'aegisgate-tls'}]},
        'allowedRoutes':{'namespaces':{'from':'Same'}}}]})
resource('route.openshift.io/v1', 'Route', 'aegisgate', {'host':app_host,
    'to':{'kind':'Service','name':'aegisgate-gateway-istio'}, 'port':{'targetPort':'https'},
    'tls':{'termination':'passthrough','insecureEdgeTerminationPolicy':'Redirect'}})
for name, prefix, backend_name, port in [('application-api','/api','session-manager',8081), ('authentication','/auth','session-manager',8081), ('webui','/','webui',8080)]:
    resource('gateway.networking.k8s.io/v1', 'HTTPRoute', name, {
        'parentRefs':[{'name':'aegisgate-gateway','sectionName':'https'}], 'hostnames':[app_host],
        'rules':[{'matches':[{'path':{'type':'PathPrefix','value':prefix}}],
                  'backendRefs':[{'name':backend_name,'port':port}]}]})
# RHCL delegates the decision to the same Rust engine used by the BFF.
resource('kuadrant.io/v1', 'AuthPolicy', 'application-sessions', {
    'targetRef':{'group':'gateway.networking.k8s.io','kind':'HTTPRoute','name':'application-api'},
    'rules':{
        'metadata':{'session':{'http':{'url':f'http://session-manager.{namespace}.svc.cluster.local:8081/internal/check',
            'headers':{'Cookie':{'selector':'context.request.http.headers.cookie'},
                       'X-Original-Method':{'selector':'context.request.http.method'},
                       'X-Original-Path':{'selector':'context.request.http.path'}}}}},
        'authorization':{'session-rbac':{'patternMatching':{'patterns':[{'selector':'auth.metadata.session.allowed','operator':'eq','value':'true'}]}}}
    }})
waf = resource('extensions.istio.io/v1alpha1', 'WasmPlugin', 'coraza-waf', {
    'targetRefs':[{'group':'gateway.networking.k8s.io','kind':'Gateway','name':'aegisgate-gateway'}],
    'url':wasm, 'imagePullPolicy':'IfNotPresent', 'phase':'AUTHN', 'priority':100, 'failStrategy':'FAIL_CLOSE',
    'pluginConfig':{'directives_map':{'default':['Include @recommended-conf',f'SecRuleEngine {waf_mode}',
        'SecDebugLogLevel 1','SecRequestBodyAccess On','SecRequestBodyLimit 65536',
        'SecRequestBodyInMemoryLimit 65536','SecRequestBodyLimitAction Reject','SecResponseBodyAccess Off',
        'Include @crs-setup-conf','Include @owasp_crs/*.conf']},'default_directives':'default'}})
if wasm_pull_secret:
    waf['spec']['imagePullSecret'] = wasm_pull_secret
resource('security.istio.io/v1', 'PeerAuthentication', 'backend-strict', {'selector':{'matchLabels':{'app':'backend'}},'mtls':{'mode':'STRICT'}})
resource('security.istio.io/v1', 'AuthorizationPolicy', 'backend-via-waypoint', {
    'selector':{'matchLabels':{'app':'backend'}}, 'action':'ALLOW',
    'rules':[{'from':[{'source':{'principals':[f'{trust_domain}/ns/{namespace}/sa/backend-waypoint']}}]}]})
resource('security.istio.io/v1', 'AuthorizationPolicy', 'backend-from-session-manager', {
    'targetRefs':[{'group':'','kind':'Service','name':'backend'}], 'action':'ALLOW',
    'rules':[{'from':[{'source':{'principals':[f'{trust_domain}/ns/{namespace}/sa/session-manager']}}],
              'to':[{'operation':{'methods':['GET','POST'],'paths':['/api/overview','/api/projects','/api/admin','/api/deployments']}}]}]})
# Identity-based TCP authorization works with ambient HBONE; avoid pod-IP network rules.
resource('security.istio.io/v1', 'PeerAuthentication', 'redis-strict', {'selector':{'matchLabels':{'app':'redis'}},'mtls':{'mode':'STRICT'}})
resource('security.istio.io/v1', 'AuthorizationPolicy', 'redis-only-session-manager', {
    'selector':{'matchLabels':{'app':'redis'}}, 'action':'ALLOW',
    'rules':[{'from':[{'source':{'principals':[f'{trust_domain}/ns/{namespace}/sa/session-manager']}}]}]})
output = ROOT/'deploy/generated/openshift.json'
output.write_text(json.dumps({'apiVersion':'v1','kind':'List','items':items},indent=2))
print(f'Rendered {len(items)} resources to deploy/generated/openshift.json (contains secrets; git-ignored).')
