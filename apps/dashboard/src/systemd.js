import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const exec = promisify(execFile);
export function systemdAdapter(config) {
  return {
    async status() {
      try {
        const { stdout } = await exec('/usr/bin/systemctl', ['show', config.unit, '--property=ActiveState,SubState,LoadState', '--no-pager'], { timeout: 5000, maxBuffer: 8192 });
        const fields = Object.fromEntries(stdout.trim().split('\n').map(line => line.split('=')));
        return fields.LoadState !== 'loaded' ? { state: 'unknown', detail: 'Minecraft unit is not loaded' } : { state: fields.ActiveState, detail: fields.SubState };
      } catch { return { state: 'unknown', detail: 'Service status unavailable on this host' }; }
    },
    async control(action) {
      if (!['start','stop','restart'].includes(action)) throw new Error('Invalid action');
      await exec('/usr/bin/sudo', ['-n', config.helper, action], { timeout: 150000, maxBuffer: 8192 });
    }
  };
}
