const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  // АВТОРИЗАЦИЯ
  login: (data) => ipcRenderer.invoke('auth:login', data),
  getUsers: () => ipcRenderer.invoke('auth:getUsers'),
  addUser: (data) => ipcRenderer.invoke('auth:addUser', data),
  requestDeleteUser: (id) => ipcRenderer.invoke('auth:requestDelete', id),
  approveDeleteUser: (id) => ipcRenderer.invoke('auth:approveDelete', id),
  cancelDeleteUser: (id) => ipcRenderer.invoke('auth:cancelDelete', id),
  
  // База данных - БОТЫ
  getBots: () => ipcRenderer.invoke('db:getBots'),
  addBot: (data) => ipcRenderer.invoke('db:addBot', data),
  updateBot: (data) => ipcRenderer.invoke('db:updateBot', data),
  deleteBot: (id) => ipcRenderer.invoke('db:deleteBot', id),
  
  // База данных - ГРУППЫ
  getGroups: () => ipcRenderer.invoke('db:getGroups'),
  addGroup: (data) => ipcRenderer.invoke('db:addGroup', data),
  deleteGroup: (id) => ipcRenderer.invoke('db:deleteGroup', id),
  
  // База данных - СООБЩЕНИЯ
  getMessages: (groupId) => ipcRenderer.invoke('db:getMessages', groupId),
  addMessage: (data) => ipcRenderer.invoke('db:addMessage', data),
  
  // База данных - РАСПИСАНИЕ
  getSchedules: () => ipcRenderer.invoke('db:getSchedules'),
  addSchedule: (data) => ipcRenderer.invoke('db:addSchedule', data),
  deleteSchedule: (id) => ipcRenderer.invoke('db:deleteSchedule', id),
  toggleSchedule: (data) => ipcRenderer.invoke('db:toggleSchedule', data),
  
  // Статистика
  getStats: () => ipcRenderer.invoke('db:getStats'),
  
  // Telegram API
  sendTelegramMessage: (data) => ipcRenderer.invoke('tg:send', data),
  checkBot: (token) => ipcRenderer.invoke('tg:checkBot', token),
  syncBotConfig: () => ipcRenderer.send('tg:sync-config'),
  
  // Обновления
  checkForUpdates: () => ipcRenderer.invoke('updater:check').catch(() => {}),
  
  // События
  onTelegramUpdate: (cb) => ipcRenderer.on('tg:incoming', (e, d) => cb(d)),
  onScheduleExecuted: (cb) => ipcRenderer.on('tg:scheduleExecuted', (e, d) => cb(d)),
  onUpdateAvailable: (cb) => ipcRenderer.on('update-available', (e, i) => cb(i)),
  onUpdateDownloaded: (cb) => ipcRenderer.on('update-downloaded', (e, i) => cb(i))
});