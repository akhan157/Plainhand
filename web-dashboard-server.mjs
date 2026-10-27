import 'dotenv/config';
import http from 'node:http';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDashboardPayload } from './dashboard-data.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const args = parseArgs(process.argv.slice(2));
const careerOpsPath = path.resolve(args.path || __dirname);
const host = args.host || '127.0.0.1';
const port = Number(args.port || 3760);

const staticRoot = path.join(careerOpsPath, 'dashboard-web');
const outputRoot = path.join(careerOpsPath, 'output');
const reportsRoot = path.join(careerOpsPath, 'reports');
const dataRoot = path.join(careerOpsPath, 'data');
const cvPath = path.join(careerOpsPath, 'cv.md');

const mimeTypes = new Map([
  ['.css', 'text/css; charset=utf-8'],
  ['.html', 'text/html; charset=utf-8'],
  ['.js', 'application/javascript; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.md', 'text/markdown; charset=utf-8'],
  ['.pdf', 'application/pdf'],
  ['.png', 'image/png'],
  ['.svg', 'image/svg+xml'],
  ['.txt', 'text/plain; charset=utf-8'],
  ['.woff2', 'font/woff2'],
]);

if (args.help) {
  printHelp();
  process.exit(0);
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);

    if (req.method !== 'GET') {
      return sendJson(res, 405, { error: 'Method not allowed' });
    }

    if (url.pathname === '/api/apps') {
      const payload = await buildDashboardPayload({
        rootPath: careerOpsPath,
        host,
        port,
        linkMode: 'local',
      });
      return sendJson(res, 200, payload);
    }

    if (url.pathname === '/favicon.ico') {
      return serveFile(res, path.join(staticRoot, 'favicon.svg'));
    }

    if (url.pathname.startsWith('/assets/')) {
      const assetPath = safeResolve(staticRoot, url.pathname.replace(/^\/assets\//, ''));
      return serveFile(res, assetPath);
    }

    if (url.pathname.startsWith('/file/')) {
      const requested = url.pathname.replace(/^\/file\//, '');
      const served = await resolveAllowedFile(requested);
      if (!served) {
        return sendJson(res, 404, { error: 'File not found' });
      }
      return serveFile(res, served);
    }

    if (url.pathname === '/terminal' || url.pathname === '/terminal/' || url.pathname === '/terminal.html') {
      return serveFile(res, path.join(staticRoot, 'terminal.html'));
    }

    if (url.pathname === '/' || url.pathname === '/index.html') {
      return serveFile(res, path.join(staticRoot, 'terminal.html'));
    }

    if (url.pathname === '/auth/logout') {
      res.writeHead(302, { Location: '/', 'Cache-Control': 'no-store' });
      res.end();
      return;
    }

    sendJson(res, 404, { error: 'Not found' });
  } catch (error) {
    sendJson(res, 500, {
      error: 'Server error',
      message: error instanceof Error ? error.message : String(error),
    });
  }
});

server.listen(port, host, () => {
  console.log(`Career dashboard web listening on http://${host}:${port}`);
  console.log(`Root: ${careerOpsPath}`);
});

function parseArgs(argv) {
  const result = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') {
      result.help = true;
      continue;
    }
    if (!arg.startsWith('--')) continue;
    const key = arg.slice(2);
    const value = argv[i + 1];
    if (!value || value.startsWith('--')) {
      result[key] = true;
      continue;
    }
    result[key] = value;
    i += 1;
  }
  return result;
}

function printHelp() {
  console.log('Usage: node web-dashboard-server.mjs [--path <career-ops-dir>] [--host <host>] [--port <port>]');
}

async function resolveAllowedFile(relativePath) {
  const normalized = relativePath.replace(/^[/\\]+/, '');
  // Never serve dotfiles (.env, .git, .claude, ...) from any root.
  if (normalized.split(/[/\\]/).some((part) => part.startsWith('.'))) {
    return null;
  }
  const allowedRoots = [careerOpsPath, outputRoot, reportsRoot, dataRoot];
  if (normalized === 'cv.md' && await pathExists(cvPath)) {
    return cvPath;
  }

  for (const root of allowedRoots) {
    const fullPath = safeResolve(root, normalized);
    if (await pathExists(fullPath)) {
      return fullPath;
    }
  }
  return null;
}

function safeResolve(root, requested) {
  const resolved = path.resolve(root, requested);
  const relative = path.relative(root, resolved);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`Path escapes root: ${requested}`);
  }
  return resolved;
}

async function serveFile(res, filePath) {
  try {
    const data = await fs.readFile(filePath);
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, {
      'Content-Type': mimeTypes.get(ext) || 'application/octet-stream',
      'Cache-Control': 'no-store',
    });
    res.end(data);
  } catch {
    sendJson(res, 404, { error: 'File not found' });
  }
}

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(JSON.stringify(payload));
}

async function pathExists(targetPath) {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}
