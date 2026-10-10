#!/usr/bin/env python3
"""Package only runtime files; secrets, data, source Git metadata stay out."""
import hashlib,json,os,platform,re,tarfile
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
commit=os.environ.get('GITHUB_SHA','')
if not re.fullmatch(r'[0-9a-f]{40}',commit):raise SystemExit('GITHUB_SHA required')
if platform.system()!='Linux' or platform.machine() not in ('x86_64','AMD64'):raise SystemExit('Release must be built on Linux x64')
out=ROOT/'release';out.mkdir(exist_ok=True)
plugin=ROOT/'plugins/server-dashboard/build/libs/Server Dashboard-1.0-SNAPSHOT.jar'
metadata={'schemaVersion':1,'commit':commit,'platform':'linux-x64','pluginSha256':hashlib.sha256(plugin.read_bytes()).hexdigest()}
(out/'release.json').write_text(json.dumps(metadata))
with tarfile.open(out/'minecraft-admin.tar.gz','w:gz') as archive:
 for name in ('src','public','node_modules','package.json','package-lock.json'):
  archive.add(ROOT/'apps/dashboard'/name,arcname='app/'+name)
 archive.add(plugin,arcname='ServerDashboard.jar')
 archive.add(out/'release.json',arcname='release.json')
blob=out/'minecraft-admin.tar.gz'
(out/'minecraft-admin.tar.gz.sha256').write_text(hashlib.sha256(blob.read_bytes()).hexdigest()+'  minecraft-admin.tar.gz\n')
print('Packaged '+commit)
