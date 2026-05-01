const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('electronAPI', {
  // Основные
  getVersion: () => ipcRenderer.invoke('app:getVersion'),
  getTime: () => ipcRenderer.invoke('app:getTime'),
  getPermissions: (role) => ipcRenderer.invoke('app:getPermissions', role),
  checkSchedule: () => ipcRenderer.invoke('app:checkSchedule'),
  reloadAll: () => ipcRenderer.invoke('app:reloadAll'),
  getMainAdmin: () => ipcRenderer.invoke('app:getMainAdmin'),
  getHelper: () => ipcRenderer.invoke('app:getHelper'),
  getWebPort: () => ipcRenderer.invoke('app:getWebPort'),
  getWebSettings: () => ipcRenderer.invoke('app:getWebSettings'),
  setWebSettings: (settings) => ipcRenderer.invoke('app:setWebSettings', settings),
  restartWeb: () => ipcRenderer.invoke('app:restartWeb'),
  
  // Логи расписания
  getScheduleLogs: (filters) => ipcRenderer.invoke('schedule:getLogs', filters),
  getScheduleErrors: () => ipcRenderer.invoke('schedule:getErrors'),
  getScheduleLogsById: (scheduleId) => ipcRenderer.invoke('schedule:getById', scheduleId),
  
  // Планирование
  getPlanning: (filters) => ipcRenderer.invoke('planning:get', filters),
  addPlan: (plan) => ipcRenderer.invoke('planning:add', plan),
  updatePlan: (data) => ipcRenderer.invoke('planning:update', data),
  deletePlan: (id) => ipcRenderer.invoke('planning:delete', id),
  getPlanningDashboard: () => ipcRenderer.invoke('planning:getDashboard'),
  
  // Данные
  exportData: () => ipcRenderer.invoke('data:export'),
  importData: (data) => ipcRenderer.invoke('data:import', data),
  exportExcel: (type, groupId) => ipcRenderer.invoke('data:exportExcel', { type, groupId }),
  
  // Аутентификация
  login: (data) => ipcRenderer.invoke('auth:login', data),
  getUsers: () => ipcRenderer.invoke('auth:getUsers'),
  addUser: (data) => ipcRenderer.invoke('auth:addUser', data),
  updateUser: (data) => ipcRenderer.invoke('auth:updateUser', data),
  deleteUser: (data) => ipcRenderer.invoke('auth:deleteUser', data),
  toggleUserStatus: (data) => ipcRenderer.invoke('auth:toggleUserStatus', data),
  getActivityLog: () => ipcRenderer.invoke('auth:getActivityLog'),
  
  // Боты
  getBots: () => ipcRenderer.invoke('db:getBots'),
  addBot: (data) => ipcRenderer.invoke('db:addBot', data),
  updateBot: (data) => ipcRenderer.invoke('db:updateBot', data),
  deleteBot: (id) => ipcRenderer.invoke('db:deleteBot', id),
  toggleBotStatus: (data) => ipcRenderer.invoke('db:toggleBotStatus', data),
  
  // Группы
  getGroups: () => ipcRenderer.invoke('db:getGroups'),
  addGroup: (data) => ipcRenderer.invoke('db:addGroup', data),
  updateGroup: (data) => ipcRenderer.invoke('db:updateGroup', data),
  deleteGroup: (id) => ipcRenderer.invoke('db:deleteGroup', id),
  toggleGroupStatus: (data) => ipcRenderer.invoke('db:toggleGroupStatus', data),
  
  // Сообщения
  getMessages: (groupId) => ipcRenderer.invoke('db:getMessages', groupId),
  addMessage: (data) => ipcRenderer.invoke('db:addMessage', data),
  clearMessages: (groupId) => ipcRenderer.invoke('db:clearMessages', groupId),
  
  // Расписания
  getSchedules: () => ipcRenderer.invoke('db:getSchedules'),
  getScheduleLogs: (scheduleId) => ipcRenderer.invoke('db:getScheduleLogs', scheduleId),
  addSchedule: (data) => ipcRenderer.invoke('db:addSchedule', data),
  updateSchedule: (data) => ipcRenderer.invoke('db:updateSchedule', data),
  deleteSchedule: (id) => ipcRenderer.invoke('db:deleteSchedule', id),
  toggleSchedule: (data) => ipcRenderer.invoke('db:toggleSchedule', data),
  resetSchedule: (id) => ipcRenderer.invoke('db:resetSchedule', id),
  
  // Шаблоны
  getTemplates: () => ipcRenderer.invoke('db:getTemplates'),
  addTemplate: (data) => ipcRenderer.invoke('db:addTemplate', data),
  updateTemplate: (data) => ipcRenderer.invoke('db:updateTemplate', data),
  deleteTemplate: (id) => ipcRenderer.invoke('db:deleteTemplate', id),
  
  // Статистика
  getStats: () => ipcRenderer.invoke('db:getStats'),
  
  // Telegram
  sendTelegramMessage: (data) => ipcRenderer.invoke('tg:send', data),
  sendMultiMessage: (data) => ipcRenderer.invoke('tg:sendMulti', data),
  checkBot: (token) => ipcRenderer.invoke('tg:checkBot', token),
  getTopics: (data) => ipcRenderer.invoke('tg:getTopics', data),
  syncBotConfig: () => ipcRenderer.send('tg:sync-config'),
  
  // Уведомления
  sendNotification: (data) => ipcRenderer.invoke('notifications:send', data),
  getNotifications: (userId) => ipcRenderer.invoke('notifications:get', userId),
  markNotificationRead: (id) => ipcRenderer.invoke('notifications:markRead', id),
  getUnreadCount: (userId) => ipcRenderer.invoke('notifications:getUnreadCount', userId),
  
  // AI
  getAILogs: () => ipcRenderer.invoke('ai:getLogs'),
  getAIAlerts: () => ipcRenderer.invoke('ai:getAlerts'),
  
  // События
  onTelegramUpdate: (cb) => ipcRenderer.on('tg:incoming', (e, d) => cb(d)),
  onScheduleExecuted: (cb) => ipcRenderer.on('tg:scheduleExecuted', (e, d) => cb(d)),
  onUpdateAvailable: (cb) => ipcRenderer.on('update-available', (e, i) => cb(i)),
  onUpdateDownloaded: (cb) => ipcRenderer.on('update-downloaded', (e, i) => cb(i))
});