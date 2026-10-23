"""Run privately on the deployment host, never print the generated credentials."""
import argparse, os, pathlib, secrets
from urllib.parse import urlsplit
p=argparse.ArgumentParser()
p.add_argument('--directory',required=True)
p.add_argument('--site-url',required=True)
a=p.parse_args()
u=urlsplit(a.site_url)
if u.scheme!='https' or not u.hostname or u.username or u.password or u.query or u.fragment:
    raise SystemExit('Use a public HTTPS origin without credentials')
root=pathlib.Path(a.directory)
root.mkdir(mode=0o750,parents=True,exist_ok=True)
def create(name,text,owner=None):
    f=root/name
    if f.exists(): return
    fd=os.open(f,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
    with os.fdopen(fd,'w') as out: out.write(text)
    if owner: os.chown(f,*owner)
values={k:secrets.token_hex(32) for k in ['POSTGRES_PASSWORD','ADMIN_PASSWORD','SESSION_SECRET','IMG_PROXY_SIGN_SECRET']}
values.update(COLLECT_ENABLED='false',MODEL_CALLS_ENABLED='false',SITE_URL=a.site_url.rstrip('/'),AIHOT_RELEASE='b3998dc6-workbench-free-rss',LOG_LEVEL='warn',DATABASE_POOL_MAX='5')
create('.env',''.join(k+'='+v+'\n' for k,v in values.items()))
# The upstream image runs as node (uid 1000); only this service and the host API need the token.
create('workspace-token',secrets.token_hex(32)+'\n',(1000,1000) if os.geteuid()==0 else None)
print('Private configuration ready; collection remains disabled until checks pass.')
