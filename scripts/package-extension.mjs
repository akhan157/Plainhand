#!/usr/bin/env node
// Builds the store upload: dist/plainhand-extension-<version>.zip, the extension/
// folder with manifest.json at the root (what Chrome Web Store, Edge Add-ons and
// Firefox expect). Refuses to package a stale vendor copy. Node only, no zip tool.
import { readFile, readdir, mkdir, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { deflateRawSync, crc32 } from 'node:zlib';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE = path.join(ROOT, 'extension');
const SKIP = new Set(['README.md', 'icon.svg']); // docs and the icon source stay out of the package

execFileSync(process.execPath, [path.join(ROOT, 'scripts/build-extension.mjs'), '--check'], { stdio: 'inherit' });
const manifest = JSON.parse(await readFile(path.join(SOURCE, 'manifest.json'), 'utf8'));

async function list(dir) {
  const out = [];
  for (const entry of (await readdir(dir, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
    if (entry.name.startsWith('.') || SKIP.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...await list(full)); else out.push(full);
  }
  return out;
}

// Minimal ZIP writer (deflate, fixed 1980-01-01 timestamps so builds are reproducible).
const locals = [], centrals = [];
let offset = 0;
for (const file of await list(SOURCE)) {
  const name = Buffer.from(path.relative(SOURCE, file).split(path.sep).join('/'));
  const data = await readFile(file), packed = deflateRawSync(data, { level: 9 }), crc = crc32(data);
  const local = Buffer.alloc(30); local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x0800, 6); local.writeUInt16LE(8, 8);
  local.writeUInt16LE(0, 10); local.writeUInt16LE(0x21, 12); local.writeUInt32LE(crc, 14); local.writeUInt32LE(packed.length, 18); local.writeUInt32LE(data.length, 22); local.writeUInt16LE(name.length, 26);
  const central = Buffer.alloc(46); central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6); central.writeUInt16LE(0x0800, 8); central.writeUInt16LE(8, 10);
  central.writeUInt16LE(0, 12); central.writeUInt16LE(0x21, 14); central.writeUInt32LE(crc, 16); central.writeUInt32LE(packed.length, 20); central.writeUInt32LE(data.length, 24); central.writeUInt16LE(name.length, 28); central.writeUInt32LE(offset, 42);
  locals.push(local, name, packed); centrals.push(central, name);
  offset += local.length + name.length + packed.length;
}
const centralSize = centrals.reduce((n, b) => n + b.length, 0), count = centrals.length / 2;
const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(count, 8); end.writeUInt16LE(count, 10); end.writeUInt32LE(centralSize, 12); end.writeUInt32LE(offset, 16);
await mkdir(path.join(ROOT, 'dist'), { recursive: true });
const out = path.join(ROOT, 'dist', `plainhand-extension-${manifest.version}.zip`);
await writeFile(out, Buffer.concat([...locals, ...centrals, end]));
console.log(`${path.relative(ROOT, out)} (${count} files)`);
