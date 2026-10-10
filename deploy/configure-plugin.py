#!/usr/bin/python3
"""One-time local configuration; never prints the ingestion secret."""
import json,os,pwd,re,subprocess
from pathlib import Path
if os.geteuid()!=0:raise SystemExit('Run with sudo')
settings=json.loads(Path('/etc/minecraft-admin/deploy.json').read_text())
app_path=Path('/etc/minecraft-admin/config.json')
app=json.loads(app_path.read_text())
app['unit']=settings['minecraftUnit']
app_path.write_text(json.dumps(app,indent=2)+'\n')
if not re.fullmatch(r'[A-Za-z0-9_-]{32,}',app['ingestSecret']):raise SystemExit('Invalid ingestion secret')
username=subprocess.check_output(['/usr/bin/systemctl','show',settings['minecraftUnit'],'--property=User','--value'],text=True).strip() or 'root'
user=pwd.getpwnam(username)
plugins=Path(settings['minecraftDirectory'])/'plugins';plugins.mkdir(exist_ok=True)
legacy=plugins/'Server Dashboard-1.0-SNAPSHOT.jar'
if legacy.exists() and not (plugins/'ServerDashboard.jar').exists():legacy.rename(plugins/'ServerDashboard.jar')
folder=plugins/'ServerDashboard';folder.mkdir(exist_ok=True);os.chown(folder,user.pw_uid,user.pw_gid)
path=folder/'config.yml';lines=path.read_text().splitlines() if path.exists() else []
values={'endpoint':"'http://127.0.0.1:8788/ingest'",'shared-secret':repr(app['ingestSecret'])}
for key,value in values.items():
 pattern=re.compile('^'+re.escape(key)+r'\s*:')
 lines=[line for line in lines if not pattern.match(line)];lines.append(key+': '+value)
if not any(re.match(r'^server-id\s*:',line) for line in lines):lines.append("server-id: 'minecraft'")
if not any(re.match(r'^disk-path\s*:',line) for line in lines):lines.append("disk-path: '.'")
path.write_text('\n'.join(lines)+'\n');os.chown(path,user.pw_uid,user.pw_gid);os.chmod(path,0o600)
print('Plugin and dashboard share the same secret. No secret was printed.')
