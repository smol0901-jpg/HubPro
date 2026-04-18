const { app, BrowserWindow, ipcMain, Tray, Menu, dialog, nativeImage } = require('electron');
const { autoUpdater } = require('electron-updater');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const VERSION = '1.5.1';
const UPDATE_INFO = [
  { version: '1.5.1', date: '2026-04-18', changes: ['Полный аудит и исправления', 'Восстановление функционала', 'Исправление AI мониторинга', 'Улучшение логирования'] },
  { version: '1.5.0', date: '2026-04-17', changes: ['Разграничение ролей', 'AI мониторинг'] }
];

let win, tray, pollingIntervals = {}, botOffsets = {}, db, scheduleIntervals = [], SQL;


const ENCRYPTION_KEY = crypto.scryptSync(app.getPath('userData'), 'hubpro-salt', 32);
const IV_LENGTH = 16;

// AI Monitoring System
const AIMonitor = {
  logs: [],
  log(action, userId, details, risk = 'low') {
    const entry = { id: Date.now(), timestamp: new Date().toISOString(), action, userId, details, risk, ai_analyzed: false };
    this.logs.push(entry);
    if (this.logs.length > 1000) this.logs = this.logs.slice(-500);
    if (risk === 'high' || risk === 'critical') this.analyzeAction(entry);
    return entry;
  },
  analyzeAction(entry) {
    const patterns = [
      { pattern: /delete.*user/i, risk: 'critical', message: 'Попытка удаления пользователя' },
      { pattern: /block.*admin/i, risk: 'critical', message: 'Попытка блокировки админа' },
      { pattern: /change.*password.*admin/i, risk: 'high', message: 'Попытка смены пароля админа' },
      { pattern: /add.*admin/i, risk: 'high', message: 'Попытка создания админа' },
    ];
    for (const p of patterns) {
      if (p.pattern.test(entry.details || entry.action)) {
        entry.ai_warning = p.message;
        entry.risk = p.risk;
        entry.ai_analyzed = true;
        break;
      }
    }
  },
  getLogs(limit = 50) { return this.logs.slice(-limit).reverse(); },
  getAlerts() { return this.logs.filter(l => l.risk === 'high' || l.risk === 'critical').slice(-20); }
};

function encrypt(text) { if (!text) return text; const iv = crypto.randomBytes(IV_LENGTH); const cipher = crypto.createCipheriv('aes-256-cbc', ENCRYPTION_KEY, iv); let encrypted = cipher.update(text, 'utf8', 'hex'); encrypted += cipher.final('hex'); return iv.toString('hex') + ':' + encrypted; }
function decrypt(text) { if (!text || !text.includes(':')) return text; try { const parts = text.split(':'); const iv = Buffer.from(parts[0], 'hex'); const decipher = crypto.createDecipheriv('aes-256-cbc', ENCRYPTION_KEY, iv); let decrypted = decipher.update(parts[1], 'hex', 'utf8'); decrypted += decipher.final('utf8'); return decrypted; } catch (e) { return text; } }
function hashPassword(password) { return crypto.createHash('sha256').update(password).digest('hex'); }

const ROLE_PERMISSIONS = {
  admin: { tabs: ['dashboard', 'bots', 'groups', 'chat', 'schedule', 'users', 'notifications', 'activity', 'ai_monitor', 'settings'], bots: ['add', 'edit', 'delete', 'toggle'], groups: ['add', 'edit', 'delete', 'toggle'], chat: ['send', 'delete'], schedule: ['add', 'edit', 'delete', 'toggle'], users: ['add', 'edit', 'delete', 'toggle', 'view_all'], settings: ['all'], canViewCredentials: true, canViewAIAlerts: true },
  helper: { tabs: ['users', 'notifications', 'settings'], bots: [], groups: [], chat: [], schedule: [], users: ['toggle', 'change_password'], settings: ['change_password'], canViewCredentials: false, canViewAIAlerts: true },
  user: { tabs: ['dashboard', 'chat', 'notifications', 'settings'], bots: [], groups: [], chat: ['send'], schedule: [], users: [], settings: ['change_password'], canViewCredentials: false, canViewAIAlerts: false }
};

async function initDatabase() {
  const initSqlJs = require('sql.js');
  SQL = await initSqlJs();
  const dbPath = path.join(app.getPath('userData'), 'hubpro.db');
  let data = null;
  if (fs.existsSync(dbPath)) data = fs.readFileSync(dbPath);
  db = new SQL.Database(data ? new Uint8Array(data) : undefined);
  
  const tables = db.exec("SELECT name FROM sqlite_master WHERE type='table'");
  const tableNames = tables.length > 0 ? tables[0].values.map(t => t[0]) : [];
  
  if (!tableNames.includes('users')) db.run(`CREATE TABLE users (id INTEGER PRIMARY KEY, login TEXT UNIQUE, password TEXT, role TEXT DEFAULT 'user', status TEXT DEFAULT 'active', created_at DATETIME DEFAULT CURRENT_TIMESTAMP, delete_request INTEGER DEFAULT 0)`);
  else { try { db.run("ALTER TABLE users ADD COLUMN status TEXT DEFAULT 'active'"); } catch(e) {} }
  
  if (!tableNames.includes('bots')) db.run(`CREATE TABLE bots (id INTEGER PRIMARY KEY, name TEXT, token TEXT UNIQUE, status TEXT DEFAULT 'active', online INTEGER DEFAULT 0, created_at DATETIME DEFAULT CURRENT_TIMESTAMP)`);
  else { try { db.run("ALTER TABLE bots ADD COLUMN status TEXT DEFAULT 'active'"); } catch(e) {} }
  
  if (!tableNames.includes('groups')) db.run(`CREATE TABLE groups (id INTEGER PRIMARY KEY, name TEXT, chat_id TEXT, bot_id INTEGER, topic_ids TEXT, status TEXT DEFAULT 'active', created_at DATETIME DEFAULT CURRENT_TIMESTAMP)`);
  else { try { db.run("ALTER TABLE groups ADD COLUMN topic_ids TEXT"); } catch(e) {} try { db.run("ALTER TABLE groups ADD COLUMN status TEXT DEFAULT 'active'"); } catch(e) {} }
  
  if (!tableNames.includes('messages')) db.run(`CREATE TABLE messages (id INTEGER PRIMARY KEY, group_id INTEGER, text TEXT, sent INTEGER DEFAULT 1, sender TEXT, status TEXT DEFAULT 'sent', time DATETIME DEFAULT CURRENT_TIMESTAMP)`);
  else { try { db.run("ALTER TABLE messages ADD COLUMN status TEXT DEFAULT 'sent'"); } catch(e) {} }
  
  if (!tableNames.includes('schedules')) db.run(`CREATE TABLE schedules (id INTEGER PRIMARY KEY, name TEXT, text TEXT, group_id INTEGER, bot_id INTEGER, scheduled_time TEXT, repeat_type TEXT DEFAULT 'once', status TEXT DEFAULT 'active', last_executed DATETIME, created_at DATETIME DEFAULT CURRENT_TIMESTAMP)`);
  if (!tableNames.includes('schedule_logs')) db.run(`CREATE TABLE schedule_logs (id INTEGER PRIMARY KEY, schedule_id INTEGER, status TEXT, error TEXT, executed_at DATETIME DEFAULT CURRENT_TIMESTAMP)`);
  if (!tableNames.includes('notifications')) db.run(`CREATE TABLE notifications (id INTEGER PRIMARY KEY, user_id INTEGER, from_id INTEGER, text TEXT, read INTEGER DEFAULT 0, type TEXT DEFAULT 'message', created_at DATETIME DEFAULT CURRENT_TIMESTAMP)`);
  if (!tableNames.includes('settings')) db.run(`CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT)`);
  if (!tableNames.includes('activity_log')) db.run(`CREATE TABLE activity_log (id INTEGER PRIMARY KEY, user_id INTEGER, action TEXT, details TEXT, created_at DATETIME DEFAULT CURRENT_TIMESTAMP)`);
  
  const admin = queryOne("SELECT id FROM users WHERE login = 'NeuralAP'");
  if (!admin) db.run("INSERT INTO users (login, password, role, status) VALUES (?, ?, ?, ?)", ['NeuralAP', hashPassword('0901Admin'), 'admin', 'active']);
  
  const help = queryOne("SELECT id FROM users WHERE login = 'HelpNeural'");
  if (!help) db.run("INSERT INTO users (login, password, role, status) VALUES (?, ?, ?, ?)", ['HelpNeural', hashPassword('admin000'), 'helper', 'active']);
  
  saveDatabase();
  console.log('Database:', dbPath);
  return db;
}

function saveDatabase() {
  const dbPath = path.join(app.getPath('userData'), 'hubpro.db');
  const data = db.export();
  fs.writeFileSync(dbPath, Buffer.from(data));
}

function queryAll(sql, params = []) {
  try {
    const stmt = db.prepare(sql);
    if (params.length) stmt.bind(params);
    const results = [];
    while (stmt.step()) results.push(stmt.getAsObject());
    stmt.free();
    return results;
  } catch(e) { return []; }
}

function queryOne(sql, params = []) { const r = queryAll(sql, params); return r.length > 0 ? r[0] : null; }
function runSql(sql, params = []) { try { db.run(sql, params); saveDatabase(); return { success: true }; } catch(e) { return { success: false, error: e.message }; } }
function logActivity(userId, action, details) { db.run("INSERT INTO activity_log (user_id, action, details) VALUES (?, ?, ?)", [userId, action, details || null]); saveDatabase(); }

function registerIPCHandlers() {
  ipcMain.handle('app:getVersion', () => ({ version: VERSION, updates: UPDATE_INFO }));
  ipcMain.handle('app:getPermissions', (_, role) => ({ permissions: ROLE_PERMISSIONS[role] || ROLE_PERMISSIONS.user }));
  
  ipcMain.handle('data:export', async () => { try { return { success: true, data: { bots: queryAll("SELECT id, name, token, online, status, created_at FROM bots").map(b => ({...b, token: decrypt(b.token)})), groups: queryAll("SELECT g.id, g.name, g.chat_id, g.bot_id, g.topic_ids, g.status, g.created_at, b.name as bot_name FROM groups g LEFT JOIN bots b ON g.bot_id = b.id"), schedules: queryAll("SELECT s.*, g.name as group_name, b.name as bot_name FROM schedules s LEFT JOIN groups g ON s.group_id = g.id LEFT JOIN bots b ON s.bot_id = b.id"), users: queryAll("SELECT id, login, role, status, created_at FROM users") } }; } catch (err) { return { success: false, error: err.message }; } });
  ipcMain.handle('data:import', async (_, { bots, groups, schedules, users }) => { try { if (bots) for (const b of bots) if (b.name && b.token) try { db.run("INSERT OR IGNORE INTO bots (name, token, online, status) VALUES (?, ?, ?, ?)", [b.name, encrypt(b.token), b.online ? 1 : 0, b.status || 'active']); } catch(e) {} if (groups) for (const g of groups) if (g.name && g.chat_id && g.bot_id) try { db.run("INSERT OR IGNORE INTO groups (name, chat_id, bot_id, topic_ids, status) VALUES (?, ?, ?, ?, ?)", [g.name, g.chat_id, g.bot_id, g.topic_ids || null, g.status || 'active']); } catch(e) {} if (schedules) for (const s of schedules) if (s.name && s.text && s.group_id && s.bot_id) try { db.run("INSERT OR IGNORE INTO schedules (name, text, group_id, bot_id, scheduled_time, repeat_type, status) VALUES (?, ?, ?, ?, ?, ?, ?)", [s.name, s.text, s.group_id, s.bot_id, s.scheduled_time, s.repeat_type || 'once', s.status || 'active']); } catch(e) {} saveDatabase(); return { success: true }; } catch (err) { return { success: false, error: err.message }; } });
  
  ipcMain.handle('auth:login', (_, { login, password }) => { 
    const user = queryOne("SELECT * FROM users WHERE login = ?", [login]); 
    if (!user) return { success: false, error: 'Пользователь не найден' }; 
    if (user.password !== hashPassword(password)) return { success: false, error: 'Неверный пароль' }; 
    if (user.delete_request === 1) return { success: false, error: 'Аккаунт отмечен на удаление' }; 
    if (user.status !== 'active') return { success: false, error: 'Аккаунт заблокирован' }; 
    AIMonitor.log('LOGIN', user.id, `Пользователь ${user.login} вошёл`, 'low');
    logActivity(user.id, 'LOGIN', `Вход в систему`);
    return { success: true, user: { id: user.id, login: user.login, role: user.role }, permissions: ROLE_PERMISSIONS[user.role] || ROLE_PERMISSIONS.user }; 
  });
  
  ipcMain.handle('auth:getUsers', () => queryAll("SELECT id, login, role, status, created_at, delete_request FROM users ORDER BY id"));
  ipcMain.handle('auth:addUser', (_, { login, password, role, currentUserRole }) => { 
    if (currentUserRole !== 'admin') return { success: false, error: 'Нет прав' };
    const exists = queryOne("SELECT id FROM users WHERE login = ?", [login]); 
    if (exists) return { success: false, error: 'Логин занят' }; 
    AIMonitor.log('ADD_USER', null, `Создан пользователь: ${login}, роль: ${role}`, role === 'admin' ? 'high' : 'low');
    logActivity(null, 'ADD_USER', `Создан пользователь ${login}`);
    return runSql("INSERT INTO users (login, password, role, status) VALUES (?, ?, ?, ?)", [login, hashPassword(password), role || 'user', 'active']); 
  });
  ipcMain.handle('auth:updateUser', (_, { id, login, password, currentUserId, currentUserRole }) => { 
    const targetUser = queryOne("SELECT * FROM users WHERE id = ?", [id]);
    if (!targetUser) return { success: false, error: 'Пользователь не найден' };
    if (password && targetUser.role === 'admin' && id !== currentUserId) { AIMonitor.log('SECURITY_ALERT', currentUserId, `Попытка смены пароля админа ${targetUser.login}`, 'critical'); return { success: false, error: 'Запрещено AI' }; }
    if (id !== currentUserId && currentUserRole !== 'admin') return { success: false, error: 'Нет прав' }; 
    if (login) { const exists = queryOne("SELECT id FROM users WHERE login = ? AND id != ?", [login, id]); if (exists) return { success: false, error: 'Логин занят' }; runSql("UPDATE users SET login = ? WHERE id = ?", [login, id]); logActivity(currentUserId, 'CHANGE_LOGIN', `Смена логина ${id}`); }
    if (password) { runSql("UPDATE users SET password = ? WHERE id = ?", [hashPassword(password), id]); logActivity(currentUserId, 'CHANGE_PASSWORD', `Смена пароля ${id}`); }
    return { success: true }; 
  });
  ipcMain.handle('auth:deleteUser', (_, { id, currentUserRole }) => { 
    if (currentUserRole !== 'admin') return { success: false, error: 'Нет прав' };
    const target = queryOne("SELECT * FROM users WHERE id = ?", [id]);
    if (target?.role === 'admin') { AIMonitor.log('SECURITY_ALERT', null, 'Попытка удаления админа', 'critical'); return { success: false, error: 'Защищено AI' }; }
    AIMonitor.log('DELETE_USER', null, `Удалён пользователь ${id}`, 'high');
    logActivity(null, 'DELETE_USER', `Удалён пользователь ${id}`);
    return runSql("DELETE FROM users WHERE id = ?", [id]); 
  });
  ipcMain.handle('auth:toggleUserStatus', (_, { id, status, currentUserRole }) => { 
    if (currentUserRole !== 'admin' && currentUserRole !== 'helper') return { success: false, error: 'Нет прав' };
    const target = queryOne("SELECT * FROM users WHERE id = ?", [id]);
    if (target?.role === 'admin') { AIMonitor.log('SECURITY_ALERT', null, 'Попытка блокировки админа', 'critical'); return { success: false, error: 'Защищено AI' }; }
    AIMonitor.log(status === 'active' ? 'UNBLOCK_USER' : 'BLOCK_USER', null, `Пользователь ${id}: ${status}`, status === 'inactive' ? 'medium' : 'low');
    logActivity(null, status === 'active' ? 'UNBLOCK_USER' : 'BLOCK_USER', `Пользователь ${id}: ${status}`);
    return runSql("UPDATE users SET status = ? WHERE id = ?", [status, id]); 
  });
  
  ipcMain.handle('ai:getLogs', () => AIMonitor.getLogs());
  ipcMain.handle('ai:getAlerts', () => AIMonitor.getAlerts());
  ipcMain.handle('auth:getActivityLog', () => queryAll("SELECT a.*, u.login FROM activity_log a LEFT JOIN users u ON a.user_id = u.id ORDER BY a.created_at DESC LIMIT 100"));
  
  // Bots
  ipcMain.handle('db:getBots', () => queryAll("SELECT * FROM bots ORDER BY id").map(b => ({ ...b, token: '***HIDDEN***' })));
  ipcMain.handle('db:addBot', (_, { name, token }) => { try { db.run("INSERT INTO bots (name, token, status) VALUES (?, ?, ?)", [name, encrypt(token), 'active']); const lastId = queryOne("SELECT last_insert_rowid() as id"); AIMonitor.log('ADD_BOT', null, `Добавлен бот: ${name}`, 'medium'); logActivity(null, 'ADD_BOT', `Добавлен бот ${name}`); saveDatabase(); return { success: true, id: lastId.id }; } catch (err) { return { success: false, error: err.message }; } });
  ipcMain.handle('db:updateBot', (_, { id, name, token, status }) => { if (token) return runSql("UPDATE bots SET name = ?, token = ?, status = ? WHERE id = ?", [name, encrypt(token), status || 'active', id]); else return runSql("UPDATE bots SET name = ?, status = ? WHERE id = ?", [name, status || 'active', id]); });
  ipcMain.handle('db:deleteBot', (_, id) => { AIMonitor.log('DELETE_BOT', null, `Удалён бот ${id}`, 'medium'); logActivity(null, 'DELETE_BOT', `Удалён бот ${id}`); return runSql("DELETE FROM bots WHERE id = ?", [id]); });
  ipcMain.handle('db:toggleBotStatus', (_, { id, status }) => runSql("UPDATE bots SET status = ? WHERE id = ?", [status, id]));
  
  // Groups
  ipcMain.handle('db:getGroups', () => queryAll("SELECT g.*, b.name as bot_name FROM groups g LEFT JOIN bots b ON g.bot_id = b.id ORDER BY g.id"));
  ipcMain.handle('db:addGroup', (_, { name, chatId, botId, topicIds }) => { try { db.run("INSERT INTO groups (name, chat_id, bot_id, topic_ids, status) VALUES (?, ?, ?, ?, ?)", [name, chatId, botId, topicIds || null, 'active']); const lastId = queryOne("SELECT last_insert_rowid() as id"); AIMonitor.log('ADD_GROUP', null, `Добавлена группа: ${name}`, 'low'); logActivity(null, 'ADD_GROUP', `Добавлена группа ${name}`); saveDatabase(); return { success: true, id: lastId.id }; } catch (err) { return { success: false, error: err.message }; } });
  ipcMain.handle('db:updateGroup', (_, { id, name, chatId, botId, topicIds, status }) => runSql("UPDATE groups SET name = ?, chat_id = ?, bot_id = ?, topic_ids = ?, status = ? WHERE id = ?", [name, chatId, botId, topicIds || null, status || 'active', id]));
  ipcMain.handle('db:deleteGroup', (_, id) => { AIMonitor.log('DELETE_GROUP', null, `Удалена группа ${id}`, 'medium'); logActivity(null, 'DELETE_GROUP', `Удалена группа ${id}`); return runSql("DELETE FROM groups WHERE id = ?", [id]); });
  ipcMain.handle('db:toggleGroupStatus', (_, { id, status }) => runSql("UPDATE groups SET status = ? WHERE id = ?", [status, id]));
  
  // Messages
  ipcMain.handle('db:getMessages', (_, groupId) => queryAll("SELECT * FROM messages WHERE group_id = ? ORDER BY time ASC", [groupId]));
  ipcMain.handle('db:addMessage', (_, { groupId, text, sent, sender, status }) => { try { db.run("INSERT INTO messages (group_id, text, sent, sender, status) VALUES (?, ?, ?, ?, ?)", [groupId, text, sent ? 1 : 0, sender || null, status || 'sent']); saveDatabase(); return { success: true }; } catch (err) { return { success: false, error: err.message }; } });
  ipcMain.handle('db:clearMessages', (_, groupId) => { if (groupId) return runSql("DELETE FROM messages WHERE group_id = ?", [groupId]); else return runSql("DELETE FROM messages"); });
  
  // Schedules
  ipcMain.handle('db:getSchedules', () => queryAll("SELECT s.*, g.name as group_name, g.chat_id, b.name as bot_name FROM schedules s LEFT JOIN groups g ON s.group_id = g.id LEFT JOIN bots b ON s.bot_id = b.id ORDER BY s.id"));
  ipcMain.handle('db:getScheduleLogs', (_, scheduleId) => queryAll("SELECT * FROM schedule_logs WHERE schedule_id = ? ORDER BY executed_at DESC LIMIT 50", [scheduleId]));
  ipcMain.handle('db:addSchedule', (_, { name, text, groupId, botId, scheduledTime, repeatType }) => { try { db.run("INSERT INTO schedules (name, text, group_id, bot_id, scheduled_time, repeat_type, status) VALUES (?, ?, ?, ?, ?, ?, ?)", [name, text, groupId, botId, scheduledTime, repeatType, 'active']); const lastId = queryOne("SELECT last_insert_rowid() as id"); AIMonitor.log('ADD_SCHEDULE', null, `Создано расписание: ${name}`, 'low'); logActivity(null, 'ADD_SCHEDULE', `Создано расписание ${name}`); saveDatabase(); return { success: true, id: lastId.id }; } catch (err) { return { success: false, error: err.message }; } });
  ipcMain.handle('db:updateSchedule', (_, { id, name, text, groupId, botId, scheduledTime, repeatType }) => runSql("UPDATE schedules SET name = ?, text = ?, group_id = ?, bot_id = ?, scheduled_time = ?, repeat_type = ? WHERE id = ?", [name, text, groupId, botId, scheduledTime, repeatType, id]));
  ipcMain.handle('db:deleteSchedule', (_, id) => { logActivity(null, 'DELETE_SCHEDULE', `Удалено расписание ${id}`); return runSql("DELETE FROM schedules WHERE id = ?", [id]); });
  ipcMain.handle('db:toggleSchedule', (_, { id, status }) => runSql("UPDATE schedules SET status = ? WHERE id = ?", [status, id]));
  
  // Stats
  ipcMain.handle('db:getStats', () => ({ botCount: queryAll("SELECT COUNT(*) as c FROM bots")[0]?.c || 0, activeBots: queryAll("SELECT COUNT(*) as c FROM bots WHERE status = 'active'")[0]?.c || 0, groupCount: queryAll("SELECT COUNT(*) as c FROM groups")[0]?.c || 0, activeGroups: queryAll("SELECT COUNT(*) as c FROM groups WHERE status = 'active'")[0]?.c || 0, messageCount: queryAll("SELECT COUNT(*) as c FROM messages")[0]?.c || 0, sentMessages: queryAll("SELECT COUNT(*) as c FROM messages WHERE sent = 1")[0]?.c || 0, receivedMessages: queryAll("SELECT COUNT(*) as c FROM messages WHERE sent = 0")[0]?.c || 0, failedMessages: queryAll("SELECT COUNT(*) as c FROM messages WHERE status = 'failed'")[0]?.c || 0, scheduleCount: queryAll("SELECT COUNT(*) as c FROM schedules")[0]?.c || 0, activeSchedules: queryAll("SELECT COUNT(*) as c FROM schedules WHERE status = 'active'")[0]?.c || 0, userCount: queryAll("SELECT COUNT(*) as c FROM users")[0]?.c || 0, activeUsers: queryAll("SELECT COUNT(*) as c FROM users WHERE status = 'active'")[0]?.c || 0 }));
  
  // Notifications
  ipcMain.handle('notifications:send', (_, { userId, fromId, text, type }) => runSql("INSERT INTO notifications (user_id, from_id, text, type) VALUES (?, ?, ?, ?)", [userId, fromId, text, type || 'message']));
  ipcMain.handle('notifications:get', (_, userId) => queryAll("SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 50", [userId]));
  ipcMain.handle('notifications:markRead', (_, id) => runSql("UPDATE notifications SET read = 1 WHERE id = ?", [id]));
  ipcMain.handle('notifications:getUnreadCount', (_, userId) => ({ count: queryAll("SELECT COUNT(*) as c FROM notifications WHERE user_id = ? AND read = 0", [userId])[0]?.c || 0 }));
  
  // Telegram
  ipcMain.on('tg:sync-config', async () => { const bots = queryAll("SELECT * FROM bots WHERE online = 1 AND status = 'active'"); const groups = queryAll("SELECT * FROM groups WHERE status = 'active'"); syncPolling(bots, groups); });
  ipcMain.handle('tg:send', async (_, { token, chatId, text, topicIds }) => { try { const me = await (await fetch(`https://api.telegram.org/bot${token}/getMe`)).json(); if (!me.ok) return { ok: false, description: 'Неверный токен' }; const chat = await (await fetch(`https://api.telegram.org/bot${token}/getChat?chat_id=${chatId}`)).json(); if (!chat.ok) return { ok: false, description: 'Бот не в группе' }; if (topicIds && Array.isArray(topicIds) && topicIds.length > 0) { const results = []; for (const tid of topicIds) results.push(await (await fetch(`https://api.telegram.org/bot${token}/sendMessage`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ chat_id: chatId, text, message_thread_id: tid, parse_mode: 'HTML' }) })).json()); return { ok: results.every(r => r.ok), results }; } const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML' }) }); return await res.json(); } catch (err) { return { ok: false, description: err.message }; } });
  ipcMain.handle('tg:checkBot', async (_, token) => { try { return await (await fetch(`https://api.telegram.org/bot${token}/getMe`)).json(); } catch (err) { return { ok: false, error: err.message }; } });
  ipcMain.handle('tg:getTopics', async (_, { token, chatId }) => { try { const data = await (await fetch(`https://api.telegram.org/bot${token}/getForumTopics?chat_id=${chatId}`)).json(); return data.ok ? { ok: true, topics: data.topics || [] } : { ok: false, error: data.description }; } catch (err) { return { ok: false, error: err.message }; } });
  
  console.log('IPC handlers registered');
}

autoUpdater.autoDownload = true; autoUpdater.autoInstallOnAppQuit = true;
app.whenReady().then(async () => { db = await initDatabase(); registerIPCHandlers(); createWindow(); await createTray(); setupAutoUpdater(); startScheduleChecker(); const bots = queryAll("SELECT * FROM bots WHERE online = 1 AND status = 'active'"); const groups = queryAll("SELECT * FROM groups WHERE status = 'active'"); syncPolling(bots, groups); });

function createWindow() { win = new BrowserWindow({ width: 1400, height: 900, title: 'HubPro v' + VERSION, webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false }, show: false }); win.loadFile('renderer/index.html'); win.once('ready-to-show', () => win.show()); win.on('close', (e) => { if (!app.isQuitting) { e.preventDefault(); win.hide(); } }); }

async function createTray() {
  const buildDir = path.join(__dirname, 'build'); if (!fs.existsSync(buildDir)) fs.mkdirSync(buildDir, { recursive: true });
  const iconPath = path.join(buildDir, 'icon.png');
  if (!fs.existsSync(iconPath)) fs.writeFileSync(iconPath, Buffer.from([0x89,0x50,0x4E,0x47,0x0D,0x0A,0x1A,0x0A,0x00,0x00,0x00,0x0D,0x49,0x48,0x44,0x52,0x00,0x00,0x00,0x10,0x00,0x00,0x00,0x10,0x08,0x06,0x00,0x00,0x00,0x1F,0xF3,0xFF,0x61,0x00,0x00,0x00,0x01,0x73,0x52,0x47,0x42,0x00,0xAE,0xCE,0x1C,0xE9,0x00,0x00,0x00,0x3D,0x49,0x44,0x41,0x54,0x38,0x4F,0x63,0x64,0x60,0x18,0x05,0xA3,0x00,0x31,0x80,0x98,0x98,0x98,0x98,0x18,0x05,0xA3,0x00,0x31,0x80,0x98,0x98,0x98,0x98,0x18,0x05,0xA3,0x00,0x31,0x80,0x98,0x98,0x98,0x98,0x18,0x05,0xA3,0x00,0x31,0x80,0x98,0x98,0x98,0x98,0x18,0x05,0xA3,0x00,0x00,0x0A,0x3F,0x04,0x1C,0xB8,0xD1,0x3E,0x00,0x00,0x00,0x00,0x49,0x45,0x4E,0x44,0xAE,0x42,0x60,0x82]));
  tray = new Tray(nativeImage.createFromPath(iconPath).isEmpty() ? nativeImage.createEmpty() : nativeImage.createFromPath(iconPath));
  tray.setToolTip('HubPro v' + VERSION); tray.setContextMenu(Menu.buildFromTemplate([{ label: 'Открыть HubPro', click: () => { win.show(); win.focus(); } }, { type: 'separator' }, { label: 'Закрыть', click: () => { app.isQuitting = true; app.quit(); } }]));
  tray.on('double-click', () => { win.show(); win.focus(); });
}

function syncPolling(bots, groups) { Object.values(pollingIntervals).forEach(clearInterval); pollingIntervals = {}; botOffsets = {}; bots.forEach(bot => { const token = decrypt(bot.token); botOffsets[bot.id] = 0; const poll = async () => { try { const c = new AbortController(); const t = setTimeout(() => c.abort(), 10000); const data = await (await fetch(`https://api.telegram.org/bot${token}/getUpdates?offset=${botOffsets[bot.id]}&timeout=10`, { signal: c.signal })).json(); clearTimeout(t); if (data.ok && data.result) data.result.forEach(u => { botOffsets[bot.id] = u.update_id + 1; if (u.message?.message?.text) { const g = groups.find(g => g.bot_id === bot.id && g.chat_id === u.message.chat.id.toString()); if (g) { db.run("INSERT INTO messages (group_id, text, sent, sender, status) VALUES (?, ?, ?, ?, ?)", [g.id, u.message.text, 0, u.message.from.first_name || u.message.from.username, 'received']); win.webContents.send('tg:incoming', { groupId: g.id, text: u.message.text, time: u.message.date * 1000, sender: u.message.from.first_name || u.message.from.username }); } } }); } catch (e) { if (e.name !== 'AbortError') console.log('Poll', bot.id, e.message); } }; pollingIntervals[bot.id] = setInterval(poll, 3000); }); saveDatabase(); }

function startScheduleChecker() { scheduleIntervals.forEach(id => clearInterval(id)); scheduleIntervals = []; const id = setInterval(async () => { try { const now = new Date(), ct = now.toTimeString().slice(0, 5), cd = now.toISOString().split('T')[0]; for (const s of queryAll("SELECT * FROM schedules WHERE status = 'active'")) { if (checkScheduleTime(s, ct, cd, now)) await executeSchedule(s); } } catch (e) { console.error(e); } }, 1000); scheduleIntervals.push(id); }
function checkScheduleTime(s, ct, cd, now) { if (ct !== s.scheduled_time.slice(0, 5)) return false; if (s.repeat_type === 'once') return s.scheduled_time.startsWith(cd); const le = s.last_executed ? new Date(s.last_executed) : null; switch (s.repeat_type) { case 'daily': return !le || le.toDateString() !== now.toDateString(); case 'weekly': return !le || Math.floor((now - le) / 86400000) >= 7; case 'monthly': return !le || le.getMonth() !== now.getMonth(); default: return false; } }

async function executeSchedule(s) { try { const bot = queryOne("SELECT * FROM bots WHERE id = ?", [s.bot_id]); const group = queryOne("SELECT * FROM groups WHERE id = ?", [s.group_id]); if (!bot || !group) return; const res = await (await fetch(`https://api.telegram.org/bot${decrypt(bot.token)}/sendMessage`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ chat_id: group.chat_id, text: s.text, parse_mode: 'HTML' }) })).json(); if (res.ok) { db.run("INSERT INTO schedule_logs (schedule_logs (schedule_id, status, error) VALUES (?, ?, ?)", [s.id, 'success', null]); db.run("INSERT INTO messages (group_id, text, sent, sender, status) VALUES (?, ?, ?, ?, ?)", [group.id, s.text, 1, 'HubPro (авто)', 'sent']); db.run("UPDATE schedules SET last_executed = ? WHERE id = ?", [new Date().toISOString(), s.id]); win.webContents.send('tg:scheduleExecuted', { scheduleId: s.id, success: true, message: 'Сообщение отправлено' }); } else { db.run("INSERT INTO schedule_logs (schedule_id, status, error) VALUES (?, ?, ?)", [s.id, 'error', res.description]); db.run("INSERT INTO messages (group_id, text, sent, sender, status) VALUES (?, ?, ?, ?, ?)", [group.id, s.text, 0, 'HubPro (авто)', 'failed']); win.webContents.send('tg:scheduleExecuted', { scheduleId: s.id, success: false, error: res.description }); } } catch (e) { db.run("INSERT INTO schedule_logs (schedule_id, status, error) VALUES (?, ?, ?)", [s.id, 'error', e.message]); win.webContents.send('tg:scheduleExecuted', { scheduleId: s.id, success: false, error: e.message }); } saveDatabase(); }

function setupAutoUpdater() { autoUpdater.on('update-available', (i) => { if (win?.webContents) win.webContents.send('update-available', i); }); autoUpdater.on('update-downloaded', (i) => { if (win?.webContents) win.webContents.send('update-downloaded', i); dialog.showMessageBox(win, { type: 'info', title: 'Обновление', message: `Загружена версия ${i.version}. Перезапустить?`, buttons: ['Да', 'Нет'] }).then(r => { if (r.response === 0) autoUpdater.quitAndInstall(); }); }); autoUpdater.on('error', e => console.error(e)); if (app.isPackaged) autoUpdater.checkForUpdatesAndNotify(); }
app.on('window-all-closed', () => process.platform !== 'darwin' && app.quit()); app.on('activate', () => BrowserWindow.getAllWindows().length === 0 && createWindow()); app.on('before-quit', () => { scheduleIntervals.forEach(id => clearInterval(id)); if (db) { saveDatabase(); db.close(); } });