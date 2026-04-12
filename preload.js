const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  // База данных
  getBots: () => ipcRenderer.invoke('db:getBots'),
  addBot: (data) => ipcRenderer.invoke('db:addBot', data),
  updateBot: (data) => ipcRenderer.invoke('db:updateBot', data),
  deleteBot: (id) => ipcRenderer.invoke('db:deleteBot', id),
  
  getGroups: () => ipcRenderer.invoke('db:getGroups'),
  addGroup: (data) => ipcRenderer.invoke('db:addGroup', data),
  deleteGroup: (id) => ipcRenderer.invoke('db:deleteGroup', id),
  
  getMessages: (groupId) => ipcRenderer.invoke('db:getMessages', groupId),
  addMessage: (data) => ipcRenderer.invoke('db:addMessage', data),
  
  getStats: () => ipcRenderer.invoke('db:getStats'),
  
  // Telegram
  sendTelegramMessage: (data) => ipcRenderer.invoke('tg:send', data),
  checkBot: (token) => ipcRenderer.invoke('tg:checkBot', token),
  syncBotConfig: () => ipcRenderer.send('tg:sync-config'),
  
  // События
  onTelegramUpdate: (cb) => ipcRenderer.on('tg:incoming', (e, d) => cb(d)),
  onUpdateAvailable: (cb) => ipcRenderer.on('update-available', (e, i) => cb(i)),
  onUpdateDownloaded: (cb) => ipcRenderer.on('update-downloaded', (e, i) => cb(i)),
  checkForUpdates: () => ipcRenderer.invoke('updater:check').catch(() => {})
});