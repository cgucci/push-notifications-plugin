#!/usr/bin/python3
"""Root-owned pull agent. Only installs tested main releases from the fixed repo.

No GitHub runner, shell commands, deploy credentials, or arbitrary unit names are
accepted over the network. Configuration is root-owned and never changed by CI.
"""
import fcntl,hashlib,json,os,re,shutil,stat,subprocess,tarfile,tempfile,time,urllib.error,urllib.request,urllib.parse
from pathlib import Path,PurePosixPath
REPO='cgucci/push-notifications-plugin'
API='https://api.github.com/repos/'+REPO
CONFIG=Path('/etc/minecraft-admin/deploy.json')
STATE=Path('/var/lib/minecraft-deploy')
BASE=Path('/opt/minecraft-admin')
MAX_ARCHIVE=250*1024*1024

def root_config(path):
 info=path.stat()
 if info.st_uid!=0 or info.st_mode & 0o022:raise ValueError('Configuration must be root-owned and not writable by others')
 config=json.loads(path.read_text())
 if not re.fullmatch(r'[A-Za-z0-9_.@-]+\.service',config['minecraftUnit']):raise ValueError('Invalid Minecraft unit')
 directory=Path(config['minecraftDirectory'])
 if not directory.is_absolute() or not (directory/'server.jar').is_file():raise ValueError('Set the existing Minecraft directory')
 return config

def fetch(url,limit=2*1024*1024):
 allowed=urllib.parse.urlparse(url)
 if allowed.scheme!='https' or allowed.hostname not in ('api.github.com','github.com'):raise ValueError('Unexpected release origin')
 request=urllib.request.Request(url,headers={'User-Agent':'minecraft-admin-deploy','Accept':'application/vnd.github+json'})
 with urllib.request.urlopen(request,timeout=30) as response:
  data=response.read(limit+1)
 if len(data)>limit:raise ValueError('Download exceeds allowed size')
 return data

def release_identity(release,head):
 tag=release.get('tag_name','')
 if release.get('draft') or release.get('prerelease') or not re.fullmatch(r'deploy-[0-9a-f]{40}',tag):raise ValueError('Not a deployment release')
 commit=tag[7:]
 if commit!=head:raise ValueError('Release is not current main; waiting for CI')
 urls={asset['name']:asset['browser_download_url'] for asset in release.get('assets',[])}
 if set(urls)!= {'minecraft-admin.tar.gz','minecraft-admin.tar.gz.sha256'}:raise ValueError('Missing release assets')
 for name,url in urls.items():
  if url!=f'https://github.com/{REPO}/releases/download/{tag}/{name}':raise ValueError('Unexpected release URL')
 return commit,urls

def extract_release(archive,destination,commit):
 with tarfile.open(archive,'r:gz') as source:
  members=source.getmembers();total=0
  if len(members)>100000:raise ValueError('Too many archive entries')
  seen=set()
  for member in members:
   path=PurePosixPath(member.name)
   if path.is_absolute() or '..' in path.parts or member.name in seen:raise ValueError('Unsafe archive path')
   seen.add(member.name)
   if member.name not in ('release.json','ServerDashboard.jar','app') and not member.name.startswith('app/'):raise ValueError('Unexpected archive contents')
   if not (member.isfile() or member.isdir() or member.issym()):raise ValueError('Unsupported archive entry')
   if member.issym():
    target=PurePosixPath(member.linkname)
    if target.is_absolute():raise ValueError('Absolute symlink')
    resolved=(destination/member.name).parent.joinpath(member.linkname).resolve()
    if not resolved.is_relative_to(destination.resolve()):raise ValueError('Escaping symlink')
   if member.mode & 0o7000:raise ValueError('Privileged file mode')
   total+=member.size
   if total>750*1024*1024:raise ValueError('Expanded release is too large')
  source.extractall(destination,filter='data')
 metadata=json.loads((destination/'release.json').read_text())
 if metadata.get('schemaVersion')!=1 or metadata.get('commit')!=commit or metadata.get('platform')!='linux-x64':raise ValueError('Release metadata mismatch')
 if hashlib.sha256((destination/'ServerDashboard.jar').read_bytes()).hexdigest()!=metadata.get('pluginSha256'):raise ValueError('Plugin checksum mismatch')
 for required in ('app/src/server.js','app/package.json','app/node_modules/fastify/package.json','app/public/index.html'):
  if not (destination/required).is_file():raise ValueError('Incomplete application')
 # CI-built files are root-owned and immutable to the app/Minecraft users.
 for directory,dirs,files in os.walk(destination,followlinks=False):
  os.chmod(directory,0o755)
  for name in files:
   path=Path(directory)/name
   if not path.is_symlink():os.chmod(path,0o755 if path.stat().st_mode&0o111 else 0o644)
 return metadata

def systemctl(action,unit):
 subprocess.run(['/usr/bin/systemctl',action,unit],check=True,timeout=150)

def point_current(target):
 temp=BASE/'current.next'
 temp.unlink(missing_ok=True);temp.symlink_to(target,target_is_directory=True);temp.replace(BASE/'current')

def wait_telemetry(require_snapshot=True,after=0,timeout=90):
 # This helper reads secrets locally and never logs or transmits them externally.
 deadline=time.monotonic()+timeout
 probe="""const fs=require('fs');const{DatabaseSync}=require('node:sqlite');const c=JSON.parse(fs.readFileSync('/etc/minecraft-admin/config.json'));const d=new DatabaseSync(c.dataPath,{readOnly:true});const r=d.prepare('SELECT value FROM state WHERE key=?').get('snapshot');d.close();const s=r&&JSON.parse(r.value);process.exit(s&&Date.now()-Date.parse(s.capturedAt)<30000&&Date.parse(s.capturedAt)>=Number(process.argv[1])?0:1);"""
 while time.monotonic()<deadline:
  try:
   with urllib.request.urlopen('http://127.0.0.1:8787/',timeout=3) as response:ready=response.status==200
   if ready and (not require_snapshot or subprocess.run(['/usr/bin/node','-e',probe,str(after)],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,timeout=5).returncode==0):return
  except (urllib.error.URLError,TimeoutError,subprocess.TimeoutExpired):pass
  time.sleep(2)
 raise RuntimeError('Fresh plugin telemetry did not arrive after deployment')

def root_config_app(path):
 info=path.stat()
 if info.st_uid!=0 or info.st_mode & 0o022:raise ValueError('App config must be root-owned, group mcadmin, mode 0640')
 config=json.loads(path.read_text())
 if config.get('webPort',8787)!=8787 or config.get('ingestPort',8788)!=8788:raise ValueError('Deployment uses ports 8787/8788')
 if config['dataPath']!='/var/lib/minecraft-admin/admin.sqlite':raise ValueError('Deployment requires the fixed SQLite path')
 return config

def replace_plugin(directory,data):
 # The Minecraft user owns this directory. Use an opened directory and exclusive
 # temporary file so symlinks cannot redirect root's writes to another file.
 import secrets
 fd=os.open(directory,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW)
 name='.admin-'+secrets.token_hex(16)+'.jar'
 try:
  output=os.open(name,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o644,dir_fd=fd)
  with os.fdopen(output,'wb') as file:file.write(data)
  os.replace(name,'ServerDashboard.jar',src_dir_fd=fd,dst_dir_fd=fd)
 finally:
  try:os.unlink(name,dir_fd=fd)
  except FileNotFoundError:pass
  os.close(fd)

def read_plugin(directory):
 fd=os.open(directory,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW)
 try:
  try:source=os.open('ServerDashboard.jar',os.O_RDONLY|os.O_NOFOLLOW,dir_fd=fd)
  except FileNotFoundError:return None
  with os.fdopen(source,'rb') as file:return file.read(100*1024*1024)
 finally:os.close(fd)

def restore_database(backup,path):
 import pwd,grp
 fd,name=tempfile.mkstemp(prefix='.restore-',dir=Path(path).parent)
 try:
  with os.fdopen(fd,'wb') as file:
   file.write(backup.read_bytes());file.flush();os.fsync(file.fileno())
   os.fchown(file.fileno(),pwd.getpwnam('mcadmin').pw_uid,grp.getgrnam('mcadmin').gr_gid)
  os.replace(name,path)
 finally:Path(name).unlink(missing_ok=True)

def install_release(stage,commit,config):
 releases=BASE/'releases';releases.mkdir(parents=True,exist_ok=True)
 target=releases/commit
 if target.exists():shutil.rmtree(target)
 shutil.move(str(stage),target)
 current=BASE/'current';previous=current.resolve() if current.is_symlink() else None
 plugin_dir=Path(config['minecraftDirectory'])/'plugins';plugin_dir.mkdir(exist_ok=True)
 plugin=plugin_dir/'ServerDashboard.jar';backup=STATE/'previous-plugin.jar'
 old_plugin=read_plugin(plugin_dir)
 had_plugin=old_plugin is not None
 if had_plugin:backup.write_bytes(old_plugin)
 app_config=Path('/etc/minecraft-admin/config.json')
 if not app_config.is_file():raise ValueError('Provision the admin before enabling auto-deploy')
 if not (plugin_dir/'ServerDashboard/config.yml').is_file():raise ValueError('Create the plugin config before enabling auto-deploy')
 runtime=root_config_app(app_config)
 was_running=subprocess.run(['/usr/bin/systemctl','is-active','--quiet',config['minecraftUnit']],check=False).returncode==0
 plugin_changed=not had_plugin or hashlib.sha256(old_plugin).digest()!=hashlib.sha256((target/'ServerDashboard.jar').read_bytes()).digest()
 # SQLite backup is consistent while the dashboard is running; do this before downtime.
 db_backup=STATE/'previous.sqlite'
 backup_code="import sqlite3,sys; source=sqlite3.connect(sys.argv[1]); saved=sqlite3.connect(':memory:'); source.backup(saved); sys.stdout.buffer.write(saved.serialize())"
 with db_backup.open('wb') as saved:subprocess.run(['/usr/sbin/runuser','-u','mcadmin','--','/usr/bin/python3','-c',backup_code,runtime['dataPath']],stdout=saved,check=True,timeout=60)
 deployed_after=int(time.time()*1000)
 try:
  systemctl('stop','minecraft-admin.service')
  if plugin_changed and was_running:systemctl('stop',config['minecraftUnit'])
  if plugin_changed:
   replace_plugin(plugin_dir,(target/'ServerDashboard.jar').read_bytes())
  point_current(target)
  systemctl('start','minecraft-admin.service')
  if plugin_changed and was_running:systemctl('start',config['minecraftUnit'])
  wait_telemetry(require_snapshot=was_running,after=deployed_after)
 except Exception:
  (STATE/'failed-commit').write_text(commit+'\n')
  systemctl('stop','minecraft-admin.service')
  if plugin_changed and was_running:systemctl('stop',config['minecraftUnit'])
  if previous:point_current(previous)
  if plugin_changed:
   if had_plugin:replace_plugin(plugin_dir,backup.read_bytes())
   else:plugin.unlink(missing_ok=True)
  for suffix in ('-wal','-shm'):Path(runtime['dataPath']+suffix).unlink(missing_ok=True)
  restore_database(db_backup,runtime['dataPath'])
  if previous:systemctl('start','minecraft-admin.service')
  if plugin_changed and was_running:systemctl('start',config['minecraftUnit'])
  raise
 (STATE/'deployed-commit').write_text(commit+'\n')
 print('Deployed '+commit,flush=True)
 # Keep the active and previous versions for rollback, prune older runtime files.
 keep={target,previous}
 for old in releases.iterdir():
  if old.is_dir() and old not in keep:shutil.rmtree(old)

def main():
 if os.geteuid()!=0:raise SystemExit('Run as root via the fixed systemd service')
 STATE.mkdir(parents=True,exist_ok=True,mode=0o700)
 with (STATE/'deploy.lock').open('w') as lock:
  fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
  config=root_config(CONFIG)
  release=json.loads(fetch(API+'/releases/latest'))
  tag=release.get('tag_name','')
  if (STATE/'deployed-commit').exists() and tag=='deploy-'+(STATE/'deployed-commit').read_text().strip():return
  if (STATE/'failed-commit').exists() and tag=='deploy-'+(STATE/'failed-commit').read_text().strip():
   print('Failed release is blocked; deploy a new commit or remove failed-commit after investigation',flush=True);return
  head=json.loads(fetch(API+'/git/ref/heads/main'))['object']['sha']
  try:commit,urls=release_identity(release,head)
  except ValueError as error:print(str(error),flush=True);return
  if (STATE/'deployed-commit').exists() and (STATE/'deployed-commit').read_text().strip()==commit:return
  checksum=fetch(urls['minecraft-admin.tar.gz.sha256'],1000).decode().split()[0]
  if not re.fullmatch(r'[0-9a-f]{64}',checksum):raise ValueError('Invalid checksum')
  archive=fetch(urls['minecraft-admin.tar.gz'],MAX_ARCHIVE)
  if hashlib.sha256(archive).hexdigest()!=checksum:raise ValueError('Archive checksum mismatch')
  with tempfile.TemporaryDirectory(dir=STATE) as directory:
   root=Path(directory);blob=root/'release.tar.gz';blob.write_bytes(archive);stage=root/'runtime';stage.mkdir()
   extract_release(blob,stage,commit);install_release(stage,commit,config)
if __name__=='__main__':main()
