const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  sendTelegramMessage: (data) => ipcRenderer.invoke('tg:send', data),
  syncBotConfig: (config) => ipcRenderer.send('tg:sync-config', config),
  onTelegramUpdate: (cb) => ipcRenderer.on('tg:incoming', (e, d) => cb(d)),
  onUpdateAvailable: (cb) => ipcRenderer.on('update-available', (e, i) => cb(i)),
  onUpdateDownloaded: (cb) => ipcRenderer.on('update-downloaded', (e, i) => cb(i)),
  checkForUpdates: () => ipcRenderer.invoke('updater:check').catch(() => {})
});