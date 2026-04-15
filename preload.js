const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  // ВЕРСИЯ
  getVersion: () => ipcRenderer.invoke('app:getVersion'),
  
  // АВТОРИЗАЦИЯ
  login: (data) => ipcRenderer.invoke('auth:login', data),
  getUsers: () => ipcRenderer.invoke('auth:getUsers'),
  addUser: (data) => ipcRenderer.invoke('auth:addUser', data),
  updateUser: (data) => ipcRenderer.invoke('auth:updateUser', data),
  requestDeleteUser: (id) => ipcRenderer.invoke('auth:requestDelete', id),
  approveDeleteUser: (id) => ipcRenderer.invoke('auth:approveDelete', id),
  cancelDeleteUser: (id) => ipcRenderer.invoke('auth:cancelDelete', id),
  
  // БОТЫ
  getBots: () => ipcRenderer.invoke('db:getBots'),
  addBot: (data) => ipcRenderer.invoke('db:addBot', data),
  updateBot: (data) => ipcRenderer.invoke('db:updateBot', data),
  deleteBot: (id) => ipcRenderer.invoke('db:deleteBot', id),
  
  // ГРУППЫ
  getGroups: () => ipcRenderer.invoke('db:getGroups'),
  addGroup: (data) => ipcRenderer.invoke('db:addGroup', data),
  updateGroup: (data) => ipcRenderer.invoke('db:updateGroup', data),
  deleteGroup: (id) => ipcRenderer.invoke('db:deleteGroup', id),
  
  // СООБЩЕНИЯ
  getMessages: (groupId) => ipcRenderer.invoke('db:getMessages', groupId),
  addMessage: (data) => ipcRenderer.invoke('db:addMessage', data),
  clearMessages: (groupId) => ipcRenderer.invoke('db:clearMessages', groupId),
  
  // РАСПИСАНИЕ
  getSchedules: () => ipcRenderer.invoke('db:getSchedules'),
  getScheduleLogs: (scheduleId) => ipcRenderer.invoke('db:getScheduleLogs', scheduleId),
  addSchedule: (data) => ipcRenderer.invoke('db:addSchedule', data),
  updateSchedule: (data) => ipcRenderer.invoke('db:updateSchedule', data),
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