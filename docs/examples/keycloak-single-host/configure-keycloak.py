#!/usr/bin/env python3
"""Optional repeatable equivalent of the documented Keycloak UI steps; lab only."""
import json, os, secrets, urllib.parse, urllib.request, urllib.error
from pathlib import Path
os.chdir(Path(__file__).resolve().parent)
env = dict(line.split('=', 1) for line in Path('.env').read_text().splitlines() if line and not line.startswith('#') and '=' in line)
base = 'http://127.0.0.1:' + env.get('KEYCLOAK_PORT', '31880')
data = urllib.parse.urlencode({'grant_type':'password','client_id':'admin-cli','username':'admin','password':env['KEYCLOAK_ADMIN_PASSWORD']}).encode()
token = json.load(urllib.request.urlopen(urllib.request.Request(base+'/realms/master/protocol/openid-connect/token',data=data)))['access_token']
def api(method, path, body=None):
    req = urllib.request.Request(base+'/admin/realms'+path, method=method, data=None if body is None else json.dumps(body).encode(), headers={'Authorization':'Bearer '+token,'Content-Type':'application/json'})
    with urllib.request.urlopen(req) as r:
        b=r.read()
        return json.loads(b) if b else None
if not any(r['realm']=='company' for r in api('GET','')):
    api('POST','',{'realm':'company','enabled':True,'sslRequired':'none','registrationAllowed':False})
root=f"http://{env.get('PUBLIC_HOST','localhost')}:{env.get('GRAFANA_PORT','31830')}"
clients=api('GET','/company/clients?clientId=grafana')
if not clients:
    api('POST','/company/clients',{'clientId':'grafana','protocol':'openid-connect','publicClient':True,'standardFlowEnabled':True,'directAccessGrantsEnabled':False,'implicitFlowEnabled':False,'serviceAccountsEnabled':False,'rootUrl':root,'baseUrl':root,'redirectUris':[root+'/login/generic_oauth'],'webOrigins':[root],'attributes':{'pkce.code.challenge.method':'S256'}})
    clients=api('GET','/company/clients?clientId=grafana')
cid=clients[0]['id']
client=clients[0]; client.update(rootUrl=root,baseUrl=root,redirectUris=[root+'/login/generic_oauth'],webOrigins=[root]); api('PUT',f'/company/clients/{cid}',client)
if not any(m['name']=='grafana-groups' for m in api('GET',f'/company/clients/{cid}/protocol-mappers/models')):
    api('POST',f'/company/clients/{cid}/protocol-mappers/models',{'name':'grafana-groups','protocol':'openid-connect','protocolMapper':'oidc-group-membership-mapper','consentRequired':False,'config':{'claim.name':'groups','full.path':'true','id.token.claim':'true','access.token.claim':'false','userinfo.token.claim':'false'}})
groups={g['name']:g['id'] for g in api('GET','/company/groups')}
for name in ['reader','grafana-admins']:
    if name not in groups:
        api('POST','/company/groups',{'name':name})
groups={g['name']:g['id'] for g in api('GET','/company/groups')}
if 'LAB_USER_PASSWORD' not in env:
    env['LAB_USER_PASSWORD']=secrets.token_hex(16)
    with Path('.env').open('a') as f: f.write('LAB_USER_PASSWORD='+env['LAB_USER_PASSWORD']+'\n')
for username, memberships in [('reader',['reader']),('deploy-admin',['reader','grafana-admins']),('outsider',[])]:
    users=api('GET','/company/users?username='+username+'&exact=true')
    if not users:
        api('POST','/company/users',{'username':username,'enabled':True,'firstName':username,'lastName':'Lab','email':username+'@example.com','emailVerified':True,'credentials':[{'type':'password','value':env['LAB_USER_PASSWORD'],'temporary':False}]})
        users=api('GET','/company/users?username='+username+'&exact=true')
    uid=users[0]['id']
    for group in memberships: api('PUT',f'/company/users/{uid}/groups/{groups[group]}')
print('company realm, Public Client + S256 PKCE, groups mapper and 3 lab users configured. Password is stored in .env (not printed).')
