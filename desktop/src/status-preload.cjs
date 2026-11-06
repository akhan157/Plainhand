const { ipcRenderer } = require('electron');
// One-way text updates only; no filesystem, URL opening, or general IPC bridge.
ipcRenderer.on('desktop-status', (_event, text) => {
  document.getElementById('status').textContent = String(text);
});
