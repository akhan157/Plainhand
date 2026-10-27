#!/usr/bin/env node
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdir, writeFile } from 'node:fs/promises';
import { runProcess } from './plainhand/agents.mjs';

const codeRoot = path.dirname(fileURLToPath(import.meta.url));
const index = process.argv.indexOf('--data-root');
const root = index < 0 ? codeRoot : path.resolve(process.argv[index + 1]);
const directory = path.join(root, 'data/plainhand/solver');
const python = path.join(directory, 'venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
await mkdir(directory, { recursive: true, mode: 0o700 });
console.log('Installing an isolated local audio solver. No paid API or account is used.');
await runProcess(process.env.PLAINHAND_SETUP_PYTHON || (process.platform === 'win32' ? 'python' : 'python3'), ['-m', 'venv', path.join(directory, 'venv')], { timeout: 60000 });
console.log('Installing faster-whisper and CPU inference dependencies…');
await runProcess(python, ['-m', 'pip', 'install', '--disable-pip-version-check', '--no-cache-dir', 'faster-whisper==1.2.1', 'av==16.0.1'], { timeout: 300000 });
console.log('Downloading the small English Whisper model and checking CPU inference…');
const result = await runProcess(python, [path.join(codeRoot, 'plainhand/solvers/transcribe.py'), '--download', '--model-dir', path.join(directory, 'model')], {
  timeout: 300000, env: { ...process.env, HF_HUB_DISABLE_TELEMETRY: '1', HF_HUB_DISABLE_XET: '1' },
});
const receipt = JSON.parse(result.stdout.trim().split('\n').at(-1));
await writeFile(path.join(directory, 'ready.json'), JSON.stringify({ ...receipt, installedAt: new Date().toISOString(), package: 'faster-whisper==1.2.1', audioDecoder: 'av==16.0.1' }, null, 2), { mode: 0o600 });
console.log('Local audio solver installed. Plainhand will use it automatically in this workspace.');
console.log('Supports reCAPTCHA v2 English audio challenges; other challenge types remain separate.');
