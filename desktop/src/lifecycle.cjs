const { spawn } = require('node:child_process');
function startServer({ executable, entry, cwd, env, spawnImpl = spawn, timeout = 60000, onExit = () => {} }) {
  const child = spawnImpl(executable, [entry], { cwd, env, windowsHide: true, detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
  // Consume output, but never forward tokens or personal content into renderer/logs.
  child.stdout?.resume(); child.stderr?.resume();
  const ready = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Plainhand took too long to start. Close and reopen the app.')), timeout);
    child.once('error', error => { clearTimeout(timer); reject(error); });
    child.once('exit', (code, signal) => { clearTimeout(timer); reject(new Error(`Local service stopped (${code ?? signal}).`)); onExit(code, signal); });
    child.on('message', message => {
      if (message?.type === 'ready' && /^http:\/\/127\.0\.0\.1:\d+$/.test(message.origin) && /^[a-f0-9]{64}$/.test(message.token)) { clearTimeout(timer); resolve(message); }
      if (message?.type === 'failure') { clearTimeout(timer); reject(new Error('The local service could not start. Close and reopen Plainhand.')); }
    });
  });
  let stopPromise;
  function stop(grace = 8000) {
    return stopPromise ||= new Promise(resolve => {
      if (child.exitCode !== null || child.signalCode) return resolve();
      let timer;
      child.once('exit', () => { clearTimeout(timer); resolve(); });
      timer = setTimeout(() => {
        if (process.platform === 'win32' && child.pid) spawn('taskkill', ['/pid', String(child.pid), '/t', '/f'], { windowsHide: true, stdio: 'ignore' });
        else if (child.pid) { try { process.kill(-child.pid, 'SIGKILL'); } catch { child.kill('SIGKILL'); } }
        else child.kill('SIGKILL');
      }, grace);
      try { if (child.connected) child.send({ type: 'stop' }); else child.kill('SIGTERM'); } catch { child.kill('SIGTERM'); }
    });
  }
  return { child, ready, stop };
}
module.exports = { startServer };
