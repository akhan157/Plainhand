import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { access, mkdtemp, rm, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { runProcess } from '../agents.mjs';

const codeRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
export function recaptchaFrame(value, kind) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.port && !url.username && !url.password && ['www.google.com', 'www.recaptcha.net'].includes(url.hostname) && new RegExp(`^/recaptcha/(api2|enterprise)/${kind}$`).test(url.pathname);
  } catch { return false; }
}
export function recaptchaAudioUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.port && !url.username && !url.password && ['www.google.com', 'www.recaptcha.net'].includes(url.hostname) && /^\/recaptcha\/(?:api2|enterprise)\/payload$/.test(url.pathname);
  } catch { return false; }
}

// A narrow, same-page adapter. It never submits an employer form or copies tokens
// between sessions. No paid API fallback, profile access, screenshot upload or
// default-browser cookie import. The actual provider UI must confirm success.
export class LocalAudioSolver {
  constructor({ root, runner = runProcess, transcribe } = {}) {
    this.directory = path.join(root, 'data/plainhand/solver');
    this.python = path.join(this.directory, 'venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
    this.runner = runner;
    this.transcriber = transcribe;
  }
  async ready() {
    if (this.transcriber) return true;
    try {
      const state = JSON.parse(await readFile(path.join(this.directory, 'ready.json'), 'utf8'));
      await access(this.python); await access(path.join(this.directory, 'model/model.bin'));
      return state.ready === true;
    } catch { return false; }
  }
  async transcribe(audio) {
    if (this.transcriber) return this.transcriber(audio);
    const directory = await mkdtemp(path.join(tmpdir(), 'plainhand-audio-'));
    try {
      const file = path.join(directory, 'challenge.mp3');
      await writeFile(file, audio, { mode: 0o600 });
      const result = await this.runner(this.python, [path.join(codeRoot, 'solvers/transcribe.py'), '--model-dir', path.join(this.directory, 'model'), '--audio', file], {
        timeout: 60000, env: { ...process.env, HF_HUB_OFFLINE: '1', HF_HUB_DISABLE_TELEMETRY: '1', HF_HUB_DISABLE_XET: '1' },
      });
      const value = JSON.parse(result.stdout.trim());
      return typeof value.text === 'string' ? value.text.slice(0, 500) : '';
    } finally { await rm(directory, { recursive: true, force: true }); }
  }
  async classifyGrid(imageBuffer, targetText) {
    const modelPath = path.join(this.directory, 'model/recaptcha_classifier.onnx');
    try { await access(modelPath); } catch { return null; }
    const directory = await mkdtemp(path.join(tmpdir(), 'plainhand-visual-'));
    const imgPath = path.join(directory, 'grid.png');
    try {
      await writeFile(imgPath, imageBuffer);
      const result = await this.runner(this.python, [
        path.join(codeRoot, 'solvers/classify_grid.py'),
        '--model', modelPath,
        '--image', imgPath,
        '--target', targetText,
      ], { timeout: 30000 });
      return JSON.parse(result.stdout.trim());
    } catch { return null; }
    finally { await rm(directory, { recursive: true, force: true }); }
  }
  async solve(page) {
    if (!await this.ready()) return { state: 'unavailable', message: 'Install the free local audio solver with npm run setup:captcha.' };
    const anchor = page.frames().find(frame => recaptchaFrame(frame.url(), 'anchor'));
    if (!anchor) return { state: 'unsupported', message: 'The local audio solver supports reCAPTCHA v2 only.' };
    const checkbox = anchor.locator('#recaptcha-anchor');
    const verified = async () => await checkbox.getAttribute('aria-checked', { timeout: 1000 }).catch(() => '') === 'true';
    if (await verified()) return { state: 'solved', message: 'reCAPTCHA verification is already complete.' };
    try {
      await checkbox.click({ timeout: 5000 });
      let challenge;
      for (let attempt = 0; attempt < 20; attempt++) {
        if (await verified()) return { state: 'solved', message: 'reCAPTCHA accepted the checkbox without an audio challenge.' };
        challenge = page.frames().find(frame => recaptchaFrame(frame.url(), 'bframe'));
        if (challenge && await challenge.locator('#recaptcha-audio-button').isVisible()) break;
        await new Promise(resolve => setTimeout(resolve, 250));
      }
      if (!challenge) return { state: 'blocked', message: 'No supported audio challenge was offered.' };
      const tryVisual = async () => {
        try {
          const imageTarget = challenge.locator('#rc-imageselect-target');
          if (!await imageTarget.isVisible().catch(() => false)) return null;
          const targetText = await challenge.locator('.rc-imageselect-desc-no-canonical, .rc-imageselect-desc, .rc-imageselect-instructions').innerText().catch(() => '');
          if (!targetText) return null;
          const buffer = await imageTarget.screenshot().catch(() => null);
          if (!buffer) return null;
          const visual = await this.classifyGrid(buffer, targetText);
          if (visual?.matchingTiles?.length) {
            const tiles = challenge.locator('.rc-imageselect-tile, .rc-imageselect-table-33 td, .rc-imageselect-table-44 td');
            for (const idx of visual.matchingTiles) {
              await tiles.nth(idx).click().catch(() => {});
              await new Promise(r => setTimeout(r, 80));
            }
            await challenge.locator('#recaptcha-verify-button').click({ timeout: 5000 }).catch(() => {});
            for (let attempt = 0; attempt < 20; attempt++) {
              if (await verified()) return { state: 'solved', message: 'reCAPTCHA accepted the locally classified image challenge.' };
              await new Promise(r => setTimeout(r, 250));
            }
          }
        } catch {}
        return null;
      };
      if (/try again later|automated queries/i.test(await challenge.locator('body').innerText())) {
        const visualResult = await tryVisual();
        if (visualResult) return visualResult;
        return { state: 'blocked', message: 'The verification provider is blocking automated traffic and did not offer a usable challenge. Your form is preserved.' };
      }
      await challenge.locator('#recaptcha-audio-button').click({ timeout: 5000 });
      if (/try again later|automated queries/i.test(await challenge.locator('body').innerText())) {
        const visualResult = await tryVisual();
        if (visualResult) return visualResult;
        return { state: 'blocked', message: 'The audio challenge is unavailable or blocked. Your form is preserved for manual verification.' };
      }
      const download = challenge.locator('.rc-audiochallenge-tdownload-link');
      await download.waitFor({ state: 'visible', timeout: 5000 });
      const audioUrl = await download.getAttribute('href');
      if (!recaptchaAudioUrl(audioUrl)) return { state: 'blocked', message: 'The audio source is outside the supported verification endpoint.' };
      // Fetch inside the same verification frame: preserves the browser session,
      // obeys its network guard, and does not create a separate HTTP/token session.
      const bytes = await challenge.evaluate(async url => {
        const response = await fetch(url, { redirect: 'error', credentials: 'include', signal: AbortSignal.timeout(15000) });
        if (!response.ok || !/^(audio\/|application\/octet-stream)/i.test(response.headers.get('content-type') || '')) return null;
        if (Number(response.headers.get('content-length')) > 10 * 1024 * 1024) return null;
        const reader = response.body.getReader(), chunks = [];
        let length = 0;
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          length += value.length;
          if (length > 10 * 1024 * 1024) { await reader.cancel(); return null; }
          chunks.push(value);
        }
        const data = new Uint8Array(length);
        let offset = 0;
        for (const chunk of chunks) { data.set(chunk, offset); offset += chunk.length; }
        return Array.from(data);
      }, audioUrl);
      if (!bytes?.length) return { state: 'blocked', message: 'Verification audio could not be read within its browser session.' };
      const audio = Buffer.from(bytes);
      const raw = await this.transcribe(audio);
      const answer = String(raw || '').toLowerCase().replace(/[^a-z0-9\s]/g, '').replace(/\s+/g, ' ').trim().slice(0, 500);
      if (!answer) return { state: 'failed', message: 'Local speech recognition could not read this challenge.' };
      await challenge.locator('#audio-response').fill(answer, { timeout: 5000 });
      // This selector is addressed only inside a verified Google reCAPTCHA frame.
      await challenge.locator('#recaptcha-verify-button').click({ timeout: 5000 });
      for (let attempt = 0; attempt < 20; attempt++) {
        if (await verified()) return { state: 'solved', message: 'reCAPTCHA accepted the locally transcribed audio answer.' };
        await new Promise(resolve => setTimeout(resolve, 250));
      }
      return { state: 'failed', message: 'The verification service did not accept this local attempt. Your form is preserved.' };
    } catch {
      return { state: 'blocked', message: 'The audio challenge is unavailable or blocked. Your form is preserved for another solver or manual verification.' };
    }
  }
}
