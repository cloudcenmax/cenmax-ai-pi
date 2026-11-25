import {constants} from 'node:fs';
import * as fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {CenmaxError, secret} from './oauth.mjs';

export const DEFAULT_ROOT = path.join(os.homedir(), '.config', 'cenmax-ai', 'pi');
export class RefreshFence {
  constructor(root = DEFAULT_ROOT) { this.root = path.resolve(root); }
  async prepare() {
    await fs.mkdir(this.root, {recursive: true, mode: 0o700});
    for (let current = this.root; current !== path.dirname(current); current = path.dirname(current)) {
      const stat = await fs.lstat(current);
      if (!stat.isDirectory() || stat.isSymbolicLink()) throw new CenmaxError();
    }
    const stat = await fs.lstat(this.root);
    if ((stat.mode & 0o077) !== 0 || (process.getuid && stat.uid !== process.getuid())) throw new CenmaxError();
  }
  async claim(value) {
    await this.prepare();
    const name = createHash('sha256').update(secret(value)).digest('hex');
    let file;
    try {
      file = await fs.open(path.join(this.root, `${name}.spent`), constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600);
      await file.writeFile('Cenmax AI rotating grant dispatched.\n'); await file.sync(); await this.syncDirectory();
    } catch { throw new CenmaxError('Cenmax AI sign-in must be renewed. Sign in again.'); }
    finally { await file?.close(); }
  }
  async syncDirectory() {
    const directory = await fs.open(this.root, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
    try { await directory.sync(); } finally { await directory.close(); }
  }
}

