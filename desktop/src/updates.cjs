function configureUpdates({ app, updater, dialog, window, restart, platform = process.platform, env = process.env }) {
  if (!app.isPackaged || (platform === 'linux' && !env.APPIMAGE) || platform === 'darwin') return null;
  updater.autoDownload = false;
  updater.autoInstallOnAppQuit = false;
  updater.allowPrerelease = false;
  updater.allowDowngrade = false;
  let checking = false;
  updater.on('error', () => dialog.showMessageBox(window(), { type: 'warning', message: 'Could not check or download an update.', detail: 'Your current version still works. Check your internet connection and try Help → Check for updates.', buttons: ['OK'] }));
  updater.on('update-available', async info => {
    const result = await dialog.showMessageBox(window(), { type: 'info', message: `Plainhand ${info.version} is available.`, detail: 'Download the update now? You choose when to restart.', buttons: ['Download', 'Later'], defaultId: 0, cancelId: 1 });
    if (result.response === 0) updater.downloadUpdate().catch(() => {});
  });
  updater.on('download-progress', progress => window()?.setProgressBar(Math.max(0, Math.min(1, progress.percent / 100))));
  updater.on('update-downloaded', async () => {
    window()?.setProgressBar(-1);
    const result = await dialog.showMessageBox(window(), { type: 'info', message: 'The update is ready.', detail: 'Restart Plainhand to install it? Finish any running work first. Choosing Later keeps the current version, including when you quit.', buttons: ['Restart and install', 'Later'], defaultId: 1, cancelId: 1 });
    if (result.response === 0) await restart(() => updater.quitAndInstall(false, true));
  });
  return async () => {
    if (checking) return;
    checking = true;
    try { await updater.checkForUpdates(); } catch { /* the error event supplies a safe message */ } finally { checking = false; }
  };
}
module.exports = { configureUpdates };
