import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

// No production activation API in phases 0-2: paths are created here, not supplied.
export function createActivationSandbox() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'avc-activation-'));
  const target = path.join(root, 'active'), candidate = path.join(root, 'candidate'), backup = path.join(root, 'previous');
  fs.mkdirSync(target); fs.mkdirSync(candidate);
  fs.writeFileSync(path.join(target, 'version.txt'), 'original');
  fs.writeFileSync(path.join(candidate, 'version.txt'), 'candidate');
  return {
    root, target, candidate, backup,
    activate(rename = fs.renameSync) {
      if (fs.existsSync(backup)) throw new Error('BACKUP_ALREADY_EXISTS');
      rename(target, backup);
      try { rename(candidate, target); }
      catch (activationError) {
        try { rename(backup, target); }
        catch (restoreError) { throw new AggregateError([activationError, restoreError], 'RESTORATION_FAILED:BACKUP_RETAINED'); }
        throw new Error('ACTIVATION_FAILED:RESTORED', { cause: activationError });
      }
      return { status: 'activated', backupRetained: true, indivisible: false };
    },
    dispose() {
      const resolved = fs.realpathSync(root);
      if (path.dirname(resolved).toLowerCase() !== fs.realpathSync(os.tmpdir()).toLowerCase() || !path.basename(resolved).startsWith('avc-activation-')) throw new Error('UNSAFE_SANDBOX_CLEANUP');
      fs.rmSync(resolved, { recursive: true });
    },
  };
}
