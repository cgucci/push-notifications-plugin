import hashlib,importlib.util,io,json,tarfile,tempfile,unittest
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('agent',ROOT/'deploy/minecraft-deploy.py');agent=importlib.util.module_from_spec(spec);spec.loader.exec_module(agent)
SHA='a'*40
class DeploymentTests(unittest.TestCase):
 def release(self,tag=None):
  tag=tag or 'deploy-'+SHA
  return {'tag_name':tag,'assets':[{'name':name,'browser_download_url':f'https://github.com/{agent.REPO}/releases/download/{tag}/{name}'} for name in ('minecraft-admin.tar.gz','minecraft-admin.tar.gz.sha256')]}
 def test_only_current_main_release(self):
  self.assertEqual(agent.release_identity(self.release(),SHA)[0],SHA)
  for release,head in [(self.release(),'b'*40),(self.release('v1.0'),SHA),({**self.release(),'draft':True},SHA),({**self.release(),'assets':[]},SHA)]:
   with self.assertRaises(ValueError):agent.release_identity(release,head)
 def archive(self,folder,extra=None):
  jar=b'fake jar';metadata={'schemaVersion':1,'commit':SHA,'platform':'linux-x64','pluginSha256':hashlib.sha256(jar).hexdigest()}
  path=folder/'release.tar.gz'
  with tarfile.open(path,'w:gz') as output:
   for name,data in {'release.json':json.dumps(metadata).encode(),'ServerDashboard.jar':jar,'app/src/server.js':b'','app/package.json':b'{}','app/node_modules/fastify/package.json':b'{}','app/public/index.html':b'<!doctype html>'}.items():
    entry=tarfile.TarInfo(name);entry.size=len(data);output.addfile(entry,io.BytesIO(data))
   if extra:output.addfile(extra,io.BytesIO(b'x') if extra.isfile() else None)
  return path
 def test_good_runtime(self):
  with tempfile.TemporaryDirectory() as directory:
   folder=Path(directory);stage=folder/'stage';stage.mkdir();result=agent.extract_release(self.archive(folder),stage,SHA);self.assertEqual(result['commit'],SHA)
 def test_traversal_and_privileged_paths_rejected(self):
  for name in ('../escape','/etc/passwd','app/../../escape','config.json'):
   with tempfile.TemporaryDirectory() as directory:
    folder=Path(directory);stage=folder/'stage';stage.mkdir();entry=tarfile.TarInfo(name);entry.size=1
    with self.assertRaises(ValueError):agent.extract_release(self.archive(folder,entry),stage,SHA)
 def test_escaping_symlink_rejected(self):
  with tempfile.TemporaryDirectory() as directory:
   folder=Path(directory);stage=folder/'stage';stage.mkdir();entry=tarfile.TarInfo('app/escape');entry.type=tarfile.SYMTYPE;entry.linkname='../../outside'
   with self.assertRaises(ValueError):agent.extract_release(self.archive(folder,entry),stage,SHA)
 def test_network_only_github(self):
  for url in ('http://github.com/file','https://127.0.0.1/file','https://attacker.example/file'):
   with self.assertRaises(ValueError):agent.fetch(url)
if __name__=='__main__':unittest.main()

class AtomicPluginTests(unittest.TestCase):
 def test_plugin_symlink_does_not_redirect_writes(self):
  with tempfile.TemporaryDirectory() as directory:
   root=Path(directory);plugins=root/'plugins';plugins.mkdir();outside=root/'outside';outside.write_bytes(b'protected');(plugins/'ServerDashboard.jar').symlink_to(outside)
   agent.replace_plugin(plugins,b'new jar');self.assertEqual(outside.read_bytes(),b'protected');self.assertEqual((plugins/'ServerDashboard.jar').read_bytes(),b'new jar')
 def test_read_rejects_symlink(self):
  with tempfile.TemporaryDirectory() as directory:
   root=Path(directory);outside=root/'outside';outside.write_bytes(b'secret');plugins=root/'plugins';plugins.mkdir();(plugins/'ServerDashboard.jar').symlink_to(outside)
   with self.assertRaises(OSError):agent.read_plugin(plugins)

class RollbackTests(unittest.TestCase):
 def run_deploy(self,changed,fail=False):
  from unittest.mock import patch
  from types import SimpleNamespace
  with tempfile.TemporaryDirectory() as directory:
   root=Path(directory);base=root/'base';state=root/'state';state.mkdir();previous=base/'releases'/'previous';previous.mkdir(parents=True);(base/'current').symlink_to(previous);mc=root/'minecraft';(mc/'plugins/ServerDashboard').mkdir(parents=True);(mc/'plugins/ServerDashboard/config.yml').write_text('configured');(mc/'plugins/ServerDashboard.jar').write_bytes(b'old');stage=root/'stage';stage.mkdir();(stage/'ServerDashboard.jar').write_bytes(b'new' if changed else b'old');calls=[]
   configfile=Path('/etc/minecraft-admin/config.json')
   original=Path.is_file
   def is_file(path):return True if path==configfile else original(path)
   def service(action,unit):calls.append((action,unit))
   with patch.object(agent,'BASE',base),patch.object(agent,'STATE',state),patch.object(agent,'root_config_app',return_value={'dataPath':'/var/lib/minecraft-admin/admin.sqlite'}),patch.object(agent.subprocess,'run',return_value=SimpleNamespace(returncode=0)),patch.object(agent,'systemctl',side_effect=service),patch.object(agent,'wait_telemetry',side_effect=RuntimeError('failed health') if fail else None),patch.object(agent,'restore_database') as restore,patch.object(Path,'is_file',is_file):
    if fail:
     with self.assertRaises(RuntimeError):agent.install_release(stage,SHA,{'minecraftDirectory':str(mc),'minecraftUnit':'minecraft.service'})
     self.assertEqual((base/'current').resolve(),previous.resolve());self.assertEqual((mc/'plugins/ServerDashboard.jar').read_bytes(),b'old');restore.assert_called_once();self.assertFalse((state/'deployed-commit').exists())
    else:
     agent.install_release(stage,SHA,{'minecraftDirectory':str(mc),'minecraftUnit':'minecraft.service'});self.assertEqual((state/'deployed-commit').read_text().strip(),SHA)
   return calls
 def test_app_only_update_keeps_minecraft_running(self):
  self.assertEqual(self.run_deploy(False),[('stop','minecraft-admin.service'),('start','minecraft-admin.service')])
 def test_failed_plugin_release_restores_previous_runtime(self):
  calls=self.run_deploy(True,True);self.assertEqual(calls[-2:],[('start','minecraft-admin.service'),('start','minecraft.service')])
