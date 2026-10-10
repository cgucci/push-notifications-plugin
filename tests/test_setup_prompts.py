import os,pty,select,subprocess,time,unittest
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
class SetupPromptTests(unittest.TestCase):
 def test_visible_prompts_hidden_password_and_clean_cancel(self):
  master,slave=pty.openpty()
  child=subprocess.Popen(['node','scripts/setup.js','--interactive'],cwd=ROOT/'apps/dashboard',stdin=slave,stdout=slave,stderr=slave)
  os.close(slave)
  def wait_for(needle):
   data=b'';deadline=time.monotonic()+15
   while time.monotonic()<deadline:
    ready,_,_=select.select([master],[],[],.25)
    if ready:
     data+=os.read(master,8192)
     if needle in data:return data
   self.fail('Setup prompt did not appear: '+needle.decode())
  try:
   wait_for(b'Admin username [connor]: ');os.write(master,b'test-admin\n')
   wait_for(b'Password (at least 12 characters): ');os.write(master,b'private-test-password\n')
   data=wait_for(b'Plugin shared-secret (blank to generate): ');self.assertNotIn(b'private-test-password',data);os.write(master,b'\n')
   wait_for(b'Public origin [https://mc.cgooch.org]: ');os.write(master,b'https://mc.cgooch.org\n')
   wait_for(b'Verify authenticator code: ');os.write(master,b'\x03');child.wait(timeout=5);self.assertEqual(child.returncode,130)
  finally:
   if child.poll() is None:child.kill();child.wait()
   os.close(master)
if __name__=='__main__':unittest.main()
