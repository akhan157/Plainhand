// Byte stores behind Workspace. Paths are always workspace-relative and use "/".
// FileStorage is the local app (a folder on the candidate's computer); MemoryStorage is
// for tests; PostgresStorage (plainhand/cloud/postgres-storage.mjs) is the hosted version,
// one row per file per user. Every store gets the same normalized, traversal-free path.
import { mkdir, readFile, writeFile, rename, lstat, readdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

export class StorageError extends Error {}

// "data/plainhand/workspace.json" → same; rejects absolute paths, "..", empty segments,
// backslashes and control characters so a store never sees a path that escapes the workspace.
export function normalizePath(relative) {
  if (typeof relative !== 'string' || !relative || relative.length > 512) throw new StorageError('Invalid workspace path.');
  if (/[\\\0-\x1f]/.test(relative) || relative.startsWith('/') || /^[A-Za-z]:/.test(relative)) throw new StorageError('Path outside workspace.');
  const parts = relative.split('/');
  if (parts.some(part => !part || part === '.' || part === '..')) throw new StorageError('Path outside workspace.');
  return parts.join('/');
}

export class FileStorage {
  constructor(root) { this.root = path.resolve(root); this.local = true; }
  // Absolute path for local-only code (browser uploads, lib/ modules that take a root).
  async resolve(relative) {
    const full = path.resolve(this.root, ...normalizePath(relative).split('/'));
    if (!full.startsWith(this.root + path.sep)) throw new StorageError('Path outside workspace.');
    let current = this.root;
    for (const part of path.relative(this.root, full).split(path.sep)) {
      current = path.join(current, part);
      try { if ((await lstat(current)).isSymbolicLink()) throw new StorageError('Workspace files cannot be symbolic links.'); }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
    return full;
  }
  async read(relative) {
    try { return await readFile(await this.resolve(relative)); } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
  }
  async write(relative, data) {
    const file = await this.resolve(relative);
    await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
    const temp = file + '.' + randomUUID() + '.tmp';
    await writeFile(temp, data, { mode: 0o600 });
    await rename(temp, file);
  }
  // File names directly inside a directory; [] when it does not exist.
  async list(directory) {
    try { return (await readdir(await this.resolve(directory), { withFileTypes: true })).filter(e => e.isFile()).map(e => e.name).sort(); }
    catch (error) { if (error.code === 'ENOENT') return []; throw error; }
  }
  async remove(relative) { await rm(await this.resolve(relative), { force: true }); }
}

export class MemoryStorage {
  constructor(files = {}) { this.files = new Map(); this.local = false; for (const [key, value] of Object.entries(files)) this.files.set(normalizePath(key), Buffer.from(value)); }
  async resolve() { throw new StorageError('This workspace has no local folder.'); }
  async read(relative) { const data = this.files.get(normalizePath(relative)); return data ? Buffer.from(data) : null; }
  async write(relative, data) { this.files.set(normalizePath(relative), Buffer.from(data)); }
  async list(directory) {
    const prefix = normalizePath(directory) + '/';
    return [...this.files.keys()].filter(key => key.startsWith(prefix) && !key.slice(prefix.length).includes('/')).map(key => key.slice(prefix.length)).sort();
  }
  async remove(relative) { this.files.delete(normalizePath(relative)); }
}
