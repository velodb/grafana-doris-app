#!/usr/bin/env python3
"""Complete the saved datasource's CA + HTTP lab flags through Grafana Admin API."""
import base64, json, os, re, sys, urllib.request
from pathlib import Path
os.chdir(Path(__file__).resolve().parent)
if len(sys.argv)!=2 or not re.fullmatch(r'[A-Za-z0-9_-]+',sys.argv[1]):
    raise SystemExit('Usage: python3 configure-datasource.py DATASOURCE_UID (from the saved datasource URL)')
env=dict(line.split('=',1) for line in Path('.env').read_text().splitlines() if line and not line.startswith('#') and '=' in line)
uid=sys.argv[1]
url='http://127.0.0.1:'+env.get('GRAFANA_PORT','31830')+'/api/datasources/uid/'+uid
auth=base64.b64encode(('admin:'+env['GRAFANA_ADMIN_PASSWORD']).encode()).decode()
def request(method,body=None):
    req=urllib.request.Request(url,method=method,data=None if body is None else json.dumps(body).encode(),headers={'Authorization':'Basic '+auth,'Content-Type':'application/json'})
    with urllib.request.urlopen(req) as r: return json.load(r)
ds=request('GET')
assert ds['type']=='velodb-doris-datasource', 'Wrong datasource type'
Path('datasource-before.json').write_text(json.dumps(ds,indent=2)); Path('datasource-before.json').chmod(0o600)
ds['jsonData']['allowInsecureIdp']=True
ds['jsonData']['oidcBackchannelUrl']='http://keycloak:8080'
ds['secureJsonData']={'tlsCACert':Path('tls/ca.crt').read_text()}
result=request('PUT',ds)
assert result['datasource']['secureJsonFields']['tlsCACert'], 'CA not saved'
Path('datasource.uid').write_text(uid+'\n')
print('CA saved; lab HTTP IDP and container backchannel set. Refresh datasource page. UID:',uid)
