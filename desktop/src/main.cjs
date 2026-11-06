const { app, BrowserWindow, Menu, dialog, shell, session } = require('electron');
const path = require('node:path');
const fs = require('node:fs/promises');
const { spawn } = require('node:child_process');
const { ONLINE, HELP, externalAllowed, localAllowed, runtimePath, nodeEnvironment } = require('./policy.cjs');
const { startServer } = require('./lifecycle.cjs');
const { exportFile, importFile, request } = require('./transfer.cjs');
const { configureUpdates } = require('./updates.cjs');
if (process.env.PLAINHAND_DESKTOP_TEST_DATA && !app.isPackaged) app.setPath('userData', path.resolve(process.env.PLAINHAND_DESKTOP_TEST_DATA));
const smoke = process.argv.includes('--desktop-smoke');
let main, status, service, installer, connection, allowQuit = false, quitting = false, checkUpdates, shutdownPromise;
const projectRoot = path.resolve(__dirname, '../..');
const runtime = runtimePath({ packaged: app.isPackaged, resourcesPath: process.resourcesPath, projectRoot: path.join(projectRoot, 'desktop/build/runtime') });
const childEntry = app.isPackaged ? path.join(runtime, 'desktop/server-child.mjs') : path.join(__dirname, 'server-child.mjs');
const preferences = { contextIsolation: true, sandbox: true, nodeIntegration: false, webSecurity: true, webviewTag: false, allowRunningInsecureContent: false };
async function external(url) { if (externalAllowed(url)) await shell.openExternal(url); }
function restrict(win, origin) {
  const contents = win.webContents;
  contents.setWindowOpenHandler(({ url }) => { external(url).catch(() => {}); return { action: 'deny' }; });
  contents.on('will-navigate', event => { if (!origin || !localAllowed(event.url, origin)) { event.preventDefault(); external(event.url).catch(() => {}); } });
  contents.on('will-redirect', event => { if (!origin || !localAllowed(event.url, origin)) event.preventDefault(); });
  contents.on('will-frame-navigate', event => { if (!origin || !localAllowed(event.url, origin)) event.preventDefault(); });
  contents.on('will-attach-webview', event => event.preventDefault());
}
async function showStatus(text) {
  if (!status || status.isDestroyed()) {
    status = new BrowserWindow({ width: 760, height: 500, title: 'Plainhand', webPreferences: { ...preferences, preload: path.join(__dirname, 'status-preload.cjs') } });
    restrict(status);
    await status.loadFile(path.join(__dirname, 'status.html'));
  }
  status.webContents.send('desktop-status', text);
  status.show();
}
async function failure(message) {
  if (quitting) return;
  main?.setProgressBar(-1);
  await showStatus(`${message}\n\nClose and reopen Plainhand to retry. For browser setup failures, check your internet connection, free disk space, and write access to your user folder. Linux may also need Chromium system libraries installed by your system administrator. Your workspace has been kept.`);
}
function runNode(args, { onOutput, timeout = 10 * 60 * 1000 } = {}) {
  return new Promise((resolve, reject) => {
    installer = spawn(process.execPath, args, { cwd: runtime, env: { ...nodeEnvironment(process.env, path.join(app.getPath('userData'), 'browsers')), PLAINHAND_RUNTIME: runtime }, windowsHide: true, detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe'] });
    const child = installer;
    const timer = setTimeout(() => { child.kill(); reject(new Error('Browser setup timed out. Check your connection and reopen Plainhand to retry.')); }, timeout);
    for (const stream of [child.stdout, child.stderr]) stream.on('data', chunk => onOutput?.(String(chunk)));
    child.once('error', error => { clearTimeout(timer); if (installer === child) installer = null; reject(error); });
    child.once('exit', code => { clearTimeout(timer); if (installer === child) installer = null; resolve(code); });
  });
}
async function chromiumSetup() {
  if (await runNode([childEntry, 'chromium-check']) === 0) return;
  await showStatus('Setting up Chromium for PDFs and form assistance. This first download may take a few minutes…');
  const result = await runNode([path.join(runtime, 'node_modules/playwright/cli.js'), 'install', 'chromium'], {
    onOutput: text => {
      // Show progress only, never raw subprocess output (which may contain local paths).
      const percent = text.match(/(\d{1,3})%/);
      if (percent && status && !status.isDestroyed()) status.webContents.send('desktop-status', `Setting up Chromium for PDFs and form assistance… ${percent[1]}% of this download.\nThe setup may download several components. Keep Plainhand open.`);
    },
  });
  if (result !== 0 || await runNode([childEntry, 'chromium-check']) !== 0) throw new Error('Chromium could not be installed.');
}
async function saveExport() {
  if (!connection) return;
  const result = await dialog.showSaveDialog(main, { title: 'Export Plainhand workspace', defaultPath: 'plainhand-workspace.json', filters: [{ name: 'Plainhand workspace', extensions: ['json'] }] });
  if (!result.canceled && result.filePath) { await exportFile(connection, result.filePath); return result.filePath; }
}
function menuAction(fn) { return () => Promise.resolve().then(fn).catch(error => dialog.showMessageBox(main || status, { type: 'error', message: 'Plainhand could not complete that action.', detail: error.message, buttons: ['OK'] })); }
function setMenu() {
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { label: 'Workspace', submenu: [
      { label: 'Export workspace…', click: menuAction(saveExport) },
      { label: 'Import workspace…', click: menuAction(async () => {
        if (!connection) return;
        const selection = await dialog.showOpenDialog(main, { title: 'Import Plainhand workspace', properties: ['openFile'], filters: [{ name: 'Plainhand workspace', extensions: ['json'] }] });
        if (selection.canceled) return;
        const imported = await importFile(connection, selection.filePaths[0], async summary => {
          const answer = await dialog.showMessageBox(main, { type: 'warning', message: 'Replace this workspace with the selected export?', detail: `${summary.jobs} jobs and ${summary.sources} sources. Existing workspace files are backed up. Packet approvals will reset. Sign in to AI providers separately on this computer.`, buttons: ['Cancel', 'Import and replace'], defaultId: 0, cancelId: 0 });
          return answer.response === 1;
        });
        if (imported) { main.reload(); await dialog.showMessageBox(main, { message: 'Workspace imported. Review packets again before using them.', detail: `Backup: ${imported.backup}` }); }
      }) },
      { type: 'separator' },
      { label: 'Open Plainhand online', click: menuAction(() => ONLINE ? external(ONLINE) : dialog.showMessageBox(main || status, { message: 'Plainhand online is not configured in this build yet.', detail: 'Use Workspace → Export workspace to save a file for a future manual upload.' })) },
      { label: 'Move to Plainhand online…', click: menuAction(async () => {
        const answer = await dialog.showMessageBox(main, { message: 'Export a file for Plainhand online?', detail: 'The online upload route is not available yet. You can save a workspace export for a future manual upload. It contains personal information; keep it private. Provider credentials and browser sessions do not travel.', buttons: ['Cancel', 'Export file'], cancelId: 0, defaultId: 0 });
        if (answer.response === 1) await saveExport();
      }) },
      { type: 'separator' }, { role: 'quit' },
    ] },
    { role: 'editMenu' }, { role: 'viewMenu', submenu: [{ role: 'reload' }, { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }, { role: 'togglefullscreen' }] },
    { label: 'Help', submenu: [
      { label: 'Get help', click: menuAction(() => external(HELP)) },
      { label: 'Check for updates', click: menuAction(async () => {
        if (checkUpdates) await checkUpdates();
        else await dialog.showMessageBox(main || status, { message: 'Updates are available in installed Windows releases and Linux AppImages.', detail: 'Development and unpacked builds do not check for updates.' });
      }) },
    ] },
  ]));
}
function shutdown() {
  return shutdownPromise ||= (async () => {
    quitting = true;
    const activeInstaller = installer;
    if (activeInstaller && activeInstaller.exitCode === null) {
      await new Promise(resolve => {
        const terminate = signal => {
          if (process.platform === 'win32') spawn('taskkill', ['/pid', String(activeInstaller.pid), '/t', '/f'], { windowsHide: true, stdio: 'ignore' });
          else { try { process.kill(-activeInstaller.pid, signal); } catch { activeInstaller.kill(signal); } }
        };
        const timer = setTimeout(() => terminate('SIGKILL'), 3000);
        activeInstaller.once('exit', () => { clearTimeout(timer); resolve(); });
        terminate('SIGTERM');
      });
    }
    await service?.stop();
    connection = null;
  })();
}
app.on('before-quit', event => {
  if (allowQuit) return;
  event.preventDefault();
  shutdown().finally(() => { allowQuit = true; app.quit(); });
});
app.on('window-all-closed', () => app.quit());
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => app.quit());
if (!app.requestSingleInstanceLock()) { allowQuit = true; app.quit(); }
else {
  app.on('second-instance', () => { const win = main && !main.isDestroyed() ? main : status; if (win?.isMinimized()) win.restore(); win?.show(); win?.focus(); });
  app.whenReady().then(async () => {
    session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
    session.defaultSession.setPermissionCheckHandler(() => false);
    session.defaultSession.on('will-download', (_event, item) => item.setSaveDialogOptions({ title: 'Save Plainhand file' }));
    setMenu();
    await fs.mkdir(path.join(app.getPath('userData'), 'workspace'), { recursive: true });
    await showStatus('Starting your local workspace…');
    await chromiumSetup();
    if (quitting) return;
    await showStatus('Checking Chromium and PDF support…');
    if (await runNode([childEntry, 'chromium-verify']) !== 0) throw new Error('Chromium was downloaded but could not start or create a PDF. On Linux, ask your administrator to install the Chromium system libraries.');
    if (quitting) return;
    service = startServer({ executable: process.execPath, entry: childEntry, cwd: runtime, env: { ...nodeEnvironment(process.env, path.join(app.getPath('userData'), 'browsers')), PLAINHAND_RUNTIME: runtime, PLAINHAND_WORKSPACE: path.join(app.getPath('userData'), 'workspace') }, onExit: () => { connection = null; failure('The local Plainhand service stopped.').catch(() => {}); } });
    service.child.on('message', message => { if (message?.type === 'open-signin') external(message.url).catch(() => {}); });
    connection = await service.ready;
    if (quitting) return;
    main = new BrowserWindow({ width: 1280, height: 900, minWidth: 800, minHeight: 600, title: 'Plainhand', show: false, webPreferences: preferences });
    restrict(main, connection.origin);
    main.webContents.on('render-process-gone', () => failure('The Plainhand window stopped responding.').catch(() => {}));
    main.webContents.on('did-fail-load', (_event, code, _description, _url, isMainFrame) => { if (isMainFrame && code !== -3) failure('The Plainhand window could not load.').catch(() => {}); });
    await main.loadURL(connection.origin);
    main.show();
    status?.destroy(); status = null;
    if (smoke) {
      const state = await request(connection, 'state');
      if (state.version !== 1) throw new Error('Smoke readiness failed');
      const isolated = await main.webContents.executeJavaScript("typeof require === 'undefined' && typeof process === 'undefined'");
      if (!isolated || !main.webContents.getLastWebPreferences().sandbox) throw new Error('Renderer isolation failed');
      console.log('DESKTOP_SMOKE_READY');
      setTimeout(() => app.quit(), 500);
      return;
    }
    const { autoUpdater } = require('electron-updater');
    checkUpdates = configureUpdates({ app, updater: autoUpdater, dialog, window: () => main, restart: async install => { await shutdown(); allowQuit = true; install(); } });
    checkUpdates?.();
  }).catch(error => { if (smoke) { console.error('DESKTOP_SMOKE_FAILED', error.message); app.exit(1); } else failure('Plainhand could not start. ' + error.message).catch(() => app.quit()); });
}
