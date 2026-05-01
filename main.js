const { app, BrowserWindow, ipcMain, Tray, Menu, dialog, nativeImage, Notification } = require('electron');
const { autoUpdater } = require('electron-updater');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const http = require('http');

const VERSION = '2.3.0';
const COMPANY_NAME = 'NEURAL_ARCHITECT_PREMIUM++';
const UPDATE_INFO = [
  { version: '2.3.0', date: '2026-04-23', changes: ['Система логирования расписания', 'Раздел планирования', 'Исправления багов', 'Безопасность HelpNeural'] },
  { version: '2.2.2', date: '2026-04-23', changes: ['Исправлено время', 'Веб настройки'] }
];

let win, tray, pollingIntervals = {}, botOffsets = {}, db, scheduleIntervals = [], SQL;
let webhookServer = null, webServer = null;
const WEBHOOK_PORT = 3001;
let WEB_PORT = 8080;
const MAIN_ADMIN_LOGIN = 'NeuralAP';
const HELPER_LOGIN = 'HelpNeural';
const LOCAL_TZ = 'Europe/Moscow';

const ENCRYPTION_KEY = crypto.scryptSync(app.getPath('userData'), 'hubpro-salt', 32);
const IV_LENGTH = 16;

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

// СИСТЕМА ЛОГИРОВАНИЯ РАСПИСАНИЯ
const ScheduleLogger = {
  logs: [],
  add(scheduleId, scheduleName, action, details, status = 'success', error = null) {
    const entry = {
      id: Date.now(),
      schedule_id: scheduleId,
      schedule_name: scheduleName,
      action: action, // 'created', 'executed', 'deleted', 'error', 'updated'
      details: details,
      status: status, // 'success', 'error', 'warning'
      error_message: error,
      timestamp: new Date().toISOString(),
      user_id: null
    };
    this.logs.push(entry);
    if (this.logs.length > 1000) this.logs = this.logs.slice(-500);
    return entry;
  },
  getLogs(filters = {}) {
    let result = this.logs.slice().reverse();
    if (filters.scheduleId) result = result.filter(l => l.schedule_id === filters.scheduleId);
    if (filters.action) result = result.filter(l => l.action === filters.action);
    if (filters.status) result = result.filter(l => l.status === filters.status);
    if (filters.search) result = result.filter(l => l.details.toLowerCase().includes(filters.search.toLowerCase()));
    return result.slice(0, filters.limit || 100);
  },
  getErrors() { return this.logs.filter(l => l.status === 'error'); },
  getBySchedule(scheduleId) { return this.logs.filter(l => l.schedule_id === scheduleId).slice().reverse(); }
};

// СИСТЕМА ПЛАНИРОВАНИЯ
const PlanningSystem = {
  plans: [],
  add(plan) {
    const entry = {
      id: Date.now(),
      title: plan.title,
      description: plan.description || '',
      type: plan.type, // 'task', 'expense', 'income'
      period: plan.period, // 'day', 'week', 'month', 'half_year', 'year'
      planned_date: plan.planned_date,
      planned_amount: plan.planned_amount || 0,
      actual_amount: plan.actual_amount || 0,
      group_id: plan.group_id || null,
      status: 'pending', // 'pending', 'in_progress', 'completed', 'cancelled'
      notify_before: plan.notify_before || 60, // минут
      created_at: new Date().toISOString(),
      completed_at: null,
      created_by: plan.created_by || null
    };
    this.plans.push(entry);
    return entry;
  },
  update(id, data) {
    const idx = this.plans.findIndex(p => p.id === id);
    if (idx >= 0) {
      Object.assign(this.plans[idx], data);
      if (data.status === 'completed') this.plans[idx].completed_at = new Date().toISOString();
      return this.plans[idx];
    }
    return null;
  },
  delete(id) { this.plans = this.plans.filter(p => p.id !== id); },
  getPlans(filters = {}) {
    let result = this.plans.slice();
    if (filters.period) result = result.filter(p => p.period === filters.period);
    if (filters.type) result = result.filter(p => p.type === filters.type);
    if (filters.status) result = result.filter(p => p.status === filters.status);
    if (filters.groupId) result = result.filter(p => p.group_id === filters.groupId);
    if (filters.dateFrom) result = result.filter(p => p.planned_date >= filters.dateFrom);
    if (filters.dateTo) result = result.filter(p => p.planned_date <= filters.dateTo);
    return result.sort((a, b) => new Date(a.planned_date) - new Date(b.planned_date));
  },
  getDashboard() {
    const today = new Date().toISOString().split('T')[0];
    const weekStart = new Date(); weekStart.setDate(weekStart.getDate() - weekStart.getDay());
    const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
    
    return {
      day: this.plans.filter(p => p.period === 'day' && p.planned_date === today),
      week: this.plans.filter(p => p.period === 'week' && p.planned_date >= weekStart.toISOString().split('T')[0]),
      month: this.plans.filter(p => p.period === 'month' && p.planned_date >= monthStart.toISOString().split('T')[0]),
      pending: this.plans.filter(p => p.status === 'pending'),
      completed: this.plans.filter(p => p.status === 'completed'),
      totalIncome: this.plans.filter(p => p.type === 'income').reduce((sum, p) => sum + (p.actual_amount || p.planned_amount), 0),
      totalExpense: this.plans.filter(p => p.type === 'expense').reduce((sum, p) => sum + (p.actual_amount || p.planned_amount), 0)
    };
  },
  checkDue() {
    const now = new Date();
    const due = [];
    this.plans.forEach(p => {
      if (p.status !== 'pending') return;
      const planned = new Date(p.planned_date);
      const diffMs = planned - now;
      const diffMins = Math.floor(diffMs / 60000);
      if (diffMins > 0 && diffMins <= p.notify_before) due.push(p);
    });
    return due;
  }
};

function encrypt(text) { if (!text) return text; const iv = crypto.randomBytes(IV_LENGTH); const cipher = crypto.createCipheriv('aes-256-cbc', ENCRYPTION_KEY, iv); let encrypted = cipher.update(text, 'utf8', 'hex'); encrypted += cipher.final('hex'); return iv.toString('hex') + ':' + encrypted; }
function decrypt(text) { if (!text || !text.includes(':')) return text; try { const parts = text.split(':'); const iv = Buffer.from(parts[0], 'hex'); const decipher = crypto.createDecipheriv('aes-256-cbc', ENCRYPTION_KEY, iv); let decrypted = decipher.update(parts[1], 'hex', 'utf8'); decrypted += decipher.final('utf8'); return decrypted; } catch (e) { return text; } }
function hashPassword(password) { return crypto.createHash('sha256').update(password).digest('hex'); }

function getLocalTime() {
  const date = new Date();
  return date.toLocaleString('ru-RU', { timeZone: LOCAL_TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function getLocalTimestamp() {
  const date = new Date();
  const utc = date.getTime() + (date.getTimezoneOffset() * 60000);
  return utc + (3 * 3600000);
}

function showNotification(title, body) {
  if (Notification.isSupported()) {
    const notification = new Notification({ title, body, icon: path.join(__dirname, 'build', 'icon.png') });
    notification.show();
  }
}

const ROLE_PERMISSIONS = {
  admin: { tabs: ['dashboard', 'bots', 'groups', 'chat', 'schedule', 'users', 'notifications', 'activity', 'ai_monitor', 'settings', 'templates', 'web', 'planning'] },
  helper: { tabs: ['users', 'notifications', 'settings', 'planning'] },
  user: { tabs: ['dashboard', 'chat', 'notifications', 'settings'] }
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
  
  if (!tableNames.includes('bots')) db.run(`CREATE TABLE bots (id INTEGER PRIMARY KEY, name TEXT, token TEXT UNIQUE, status TEXT DEFAULT 'active', online INTEGER DEFAULT 0, webhook_url TEXT, created_at DATETIME DEFAULT CURRENT_TIMESTAMP)`);
  if (!tableNames.includes('groups')) db.run(`CREATE TABLE groups (id INTEGER PRIMARY KEY, name TEXT, chat_id TEXT, bot_id INTEGER, topic_ids TEXT, status TEXT DEFAULT 'active', created_at DATETIME DEFAULT CURRENT_TIMESTAMP)`);
  if (!tableNames.includes('messages')) db.run(`CREATE TABLE messages (id INTEGER PRIMARY KEY, group_id INTEGER, text TEXT, sent INTEGER DEFAULT 1, sender TEXT, status TEXT DEFAULT 'sent', time DATETIME DEFAULT CURRENT_TIMESTAMP)`);
  if (!tableNames.includes('schedules')) db.run(`CREATE TABLE schedules (id INTEGER PRIMARY KEY, name TEXT, text TEXT, group_id INTEGER, bot_id INTEGER, scheduled_time TEXT, repeat_type TEXT DEFAULT 'once', status TEXT DEFAULT 'active', last_executed DATETIME, created_at DATETIME DEFAULT CURRENT_TIMESTAMP)`);
  if (!tableNames.includes('schedule_logs')) db.run(`CREATE TABLE schedule_logs (id INTEGER PRIMARY KEY, schedule_id INTEGER, status TEXT, error TEXT, executed_at DATETIME DEFAULT CURRENT_TIMESTAMP)`);
  if (!tableNames.includes('notifications')) db.run(`CREATE TABLE notifications (id INTEGER PRIMARY KEY, user_id INTEGER, from_id INTEGER, text TEXT, read INTEGER DEFAULT 0, type TEXT DEFAULT 'message', created_at DATETIME DEFAULT CURRENT_TIMESTAMP)`);
  if (!tableNames.includes('settings')) db.run(`CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT)`);
  if (!tableNames.includes('activity_log')) db.run(`CREATE TABLE activity_log (id INTEGER PRIMARY KEY, user_id INTEGER, action TEXT, details TEXT, created_at DATETIME DEFAULT CURRENT_TIMESTAMP)`);
  if (!tableNames.includes('templates')) db.run(`CREATE TABLE templates (id INTEGER PRIMARY KEY, name TEXT, content TEXT, created_at DATETIME DEFAULT CURRENT_TIMESTAMP)`);
  
  // ТАБЛИЦА ПЛАНИРОВАНИЯ
  if (!tableNames.includes('planning')) {
    db.run(`CREATE TABLE planning (
      id INTEGER PRIMARY KEY,
      title TEXT,
      description TEXT,
      type TEXT DEFAULT 'task',
      period TEXT DEFAULT 'day',
      planned_date TEXT,
      planned_amount REAL DEFAULT 0,
      actual_amount REAL DEFAULT 0,
      group_id INTEGER,
      status TEXT DEFAULT 'pending',
      notify_before INTEGER DEFAULT 60,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      completed_at DATETIME,
      created_by INTEGER
    )`);
  }
  
  // ТАБЛИЦА ЛОГОВ РАСПИСАНИЯ
  if (!tableNames.includes('schedule_action_logs')) {
    db.run(`CREATE TABLE schedule_action_logs (
      id INTEGER PRIMARY KEY,
      schedule_id INTEGER,
      schedule_name TEXT,
      action TEXT,
      details TEXT,
      status TEXT DEFAULT 'success',
      error_message TEXT,
      user_id INTEGER,
      timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);
  }
  
  // Настройки веб
  const webPortSetting = queryOne("SELECT * FROM settings WHERE key = 'web_port'");
  if (!webPortSetting) db.run("INSERT INTO settings (key, value) VALUES ('web_port', '8080')");
  const webEnabledSetting = queryOne("SELECT * FROM settings WHERE key = 'web_enabled'");
  if (!webEnabledSetting) db.run("INSERT INTO settings (key, value) VALUES ('web_enabled', 'true')");
  
  // Главный админ
  const admin = queryOne("SELECT id FROM users WHERE login = ?", [MAIN_ADMIN_LOGIN]);
  if (!admin) db.run("INSERT INTO users (login, password, role, status) VALUES (?, ?, ?, ?)", [MAIN_ADMIN_LOGIN, hashPassword('0901Admin'), 'admin', 'active']);
  
  // Резервный пользователь HelpNeural
  const help = queryOne("SELECT id FROM users WHERE login = ?", [HELPER_LOGIN]);
  if (!help) db.run("INSERT INTO users (login, password, role, status) VALUES (?, ?, ?, ?)", [HELPER_LOGIN, hashPassword('admin000'), 'helper', 'active']);
  
  saveDatabase();
  console.log('Database:', dbPath);
  console.log('Company:', COMPANY_NAME);
  console.log('Timezone:', LOCAL_TZ);
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

function generateExcel(data) {
  let csv = '';
  if (data.type === 'messages') {
    csv = 'ID,Время,Текст,Отправитель,Статус,Тип\n';
    data.items.forEach(m => { csv += `${m.id},"${m.time}","${(m.text || '').replace(/"/g, '""')}","${m.sender || ''}","${m.status}","${m.sent ? 'Отправлено' : 'Получено'}"\n`; });
  } else if (data.type === 'bots') {
    csv = 'ID,Название,Статус,Дата создания\n';
    data.items.forEach(b => { csv += `${b.id},"${b.name}","${b.status}","${b.created_at}"\n`; });
  } else if (data.type === 'groups') {
    csv = 'ID,Название,Chat ID,Бот,Статус\n';
    data.items.forEach(g => { csv += `${g.id},"${g.name}","${g.chat_id}","${g.bot_name || ''}","${g.status}"\n`; });
  } else if (data.type === 'schedules') {
    csv = 'ID,Название,Группа,Бот,Время,Повтор,Статус\n';
    data.items.forEach(s => { csv += `${s.id},"${s.name}","${s.group_name || ''}","${s.bot_name || ''}","${s.scheduled_time}","${s.repeat_type}","${s.status}"\n`; });
  } else if (data.type === 'users') {
    csv = 'ID,Логин,Роль,Статус,Дата создания\n';
    data.items.forEach(u => { csv += `${u.id},"${u.login}","${u.role}","${u.status}","${u.created_at}"\n`; });
  } else if (data.type === 'activity') {
    csv = 'ID,Пользователь,Действие,Детали,Время\n';
    data.items.forEach(a => { csv += `${a.id},"${a.login || 'Система'}","${a.action}","${a.details || ''}","${a.created_at}"\n`; });
  }
  return csv;
}

// ============ WEB SERVER ============
function startWebServer(port) {
  if (webServer) { console.log('Веб-сервер уже запущен на порту ' + port); return; }
  
  const htmlPath = path.join(__dirname, 'renderer', 'index.html');
  let htmlContent = fs.existsSync(htmlPath) ? fs.readFileSync(htmlPath, 'utf8') : '';
  
  webServer = http.createServer(async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    
    if (req.method === 'OPTIONS') { res.writeHead(200); res.end(); return; }
    
    const url = req.url.split('?')[0];
    const query = req.url.includes('?') ? req.url.split('?')[1] : '';
    
    if (url.startsWith('/api/')) {
      const apiPath = url.replace('/api/', '');
      let body = '';
      req.on('data', chunk => body += chunk);
      req.on('end', async () => {
        try {
          let params = {};
          if (body) params = JSON.parse(body);
          if (query) query.split('&').forEach(p => { const [k, v] = p.split('='); if (k) params[k] = decodeURIComponent(v || ''); });
          const result = await handleAPI(apiPath, params);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(result));
        } catch (e) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: e.message }));
        }
      });
      return;
    }
    
    if (url === '/' || url === '/index.html') { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(htmlContent); return; }
    
    const filePath = path.join(__dirname, 'renderer', url);
    if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
      const ext = path.extname(filePath);
      const contentTypes = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.png': 'image/png', '.jpg': 'image/jpeg' };
      res.writeHead(200, { 'Content-Type': contentTypes[ext] || 'text/plain' });
      res.end(fs.readFileSync(filePath));
      return;
    }
    
    res.writeHead(404); res.end('Not found');
  });
  
  webServer.on('error', (err) => { if (err.code === 'EADDRINUSE') { console.log(`Порт ${port} занят, пробую ${port + 1}`); WEB_PORT = port + 1; startWebServer(WEB_PORT); } });
  
  webServer.listen(port, '0.0.0.0', () => {
    console.log(`🌐 Веб-интерфейс: http://localhost:${port}`);
    console.log(`📱 С телефона: http://${getLocalIP()}:${port}`);
    showNotification('HubPro', `Веб на http://${getLocalIP()}:${port}`);
  });
}

function stopWebServer() { if (webServer) { webServer.close(); webServer = null; console.log('Веб-сервер остановлен'); } }
function restartWebServer(port) { stopWebServer(); setTimeout(() => startWebServer(port), 500); }

function getLocalIP() {
  const os = require('os');
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) return iface.address;
    }
  }
  return 'localhost';
}

async function handleAPI(path, params) {
  if (path === 'login') {
    const user = queryOne("SELECT * FROM users WHERE login = ?", [params.login]);
    if (!user) return { success: false, error: 'Пользователь не найден' };
    if (user.password !== hashPassword(params.password)) return { success: false, error: 'Неверный пароль' };
    if (user.status !== 'active') return { success: false, error: 'Аккаунт заблокирован' };
    return { success: true, user: { id: user.id, login: user.login, role: user.role }, permissions: ROLE_PERMISSIONS[user.role] };
  }
  
  if (path === 'getData') {
    return {
      bots: queryAll("SELECT * FROM bots WHERE status = 'active'").map(b => ({ ...b, token: decrypt(b.token) })),
      groups: queryAll("SELECT g.*, b.name as bot_name FROM groups g LEFT JOIN bots b ON g.bot_id = b.id WHERE g.status = 'active'"),
      schedules: queryAll("SELECT s.*, g.name as group_name, b.name as bot_name FROM schedules s LEFT JOIN groups g ON s.group_id = g.id LEFT JOIN bots b ON s.bot_id = b.id"),
      users: queryAll("SELECT id, login, role, status, created_at FROM users"),
      templates: queryAll("SELECT * FROM templates"),
      stats: getStats(),
      planning: PlanningSystem.getPlans(),
      planningDashboard: PlanningSystem.getDashboard()
    };
  }
  
  if (path === 'getGroups') return queryAll("SELECT g.*, b.name as bot_name FROM groups g LEFT JOIN bots b ON g.bot_id = b.id WHERE g.status = 'active'");
  
  if (path === 'sendMessage') {
    const groupId = parseInt(params.groupId);
    const text = params.text;
    const sender = params.sender || 'Web';
    
    const group = queryOne("SELECT g.*, b.token as bot_token FROM groups g LEFT JOIN bots b ON g.bot_id = b.id WHERE g.id = ?", [groupId]);
    if (!group) return { success: false, error: 'Группа не найдена' };
    if (!group.bot_token) return { success: false, error: 'Бот не назначен' };
    
    const token = decrypt(group.bot_token);
    try {
      const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: group.chat_id, text, parse_mode: 'HTML' })
      });
      const result = await res.json();
      
      if (result.ok) {
        db.run("INSERT INTO messages (group_id, text, sent, sender, status) VALUES (?, ?, ?, ?, ?)", [groupId, text, 1, sender, 'sent']);
        saveDatabase();
        if (win && !win.isDestroyed()) win.webContents.send('tg:incoming', { groupId: groupId, text, time: Date.now(), sender, fromWeb: true });
        return { success: true, message: 'Отправлено' };
      }
      return { success: false, error: result.description };
    } catch (e) { return { success: false, error: e.message }; }
  }
  
  if (path === 'getMessages') {
    const groupId = parseInt(params.groupId);
    const lastId = parseInt(params.lastId) || 0;
    let sql = "SELECT * FROM messages WHERE group_id = ?";
    const queryParams = [groupId];
    if (lastId > 0) { sql += " AND id > ?"; queryParams.push(lastId); }
    sql += " ORDER BY time ASC LIMIT 100";
    return queryAll(sql, queryParams);
  }
  
  if (path === 'getStats') return getStats();
  if (path === 'getVersion') return { version: VERSION, updates: UPDATE_INFO, timezone: LOCAL_TZ, company: COMPANY_NAME };
  if (path === 'getTime') return { time: getLocalTime(), timestamp: getLocalTimestamp(), timezone: LOCAL_TZ };
  
  // Логи расписания
  if (path === 'getScheduleLogs') return ScheduleLogger.getLogs(params);
  if (path === 'getScheduleErrors') return ScheduleLogger.getErrors();
  
  // Планирование
  if (path === 'getPlanning') return { plans: PlanningSystem.getPlans(params), dashboard: PlanningSystem.getDashboard() };
  if (path === 'addPlan') {
    const plan = PlanningSystem.add(params);
    return { success: true, plan };
  }
  if (path === 'updatePlan') {
    const plan = PlanningSystem.update(params.id, params);
    return { success: !!plan, plan };
  }
  if (path === 'deletePlan') {
    PlanningSystem.delete(params.id);
    return { success: true };
  }
  
  // Настройки веб
  if (path === 'getWebSettings') {
    const webPort = queryOne("SELECT value FROM settings WHERE key = 'web_port'")?.value || '8080';
    const webEnabled = queryOne("SELECT value FROM settings WHERE key = 'web_enabled'")?.value || 'true';
    return { port: parseInt(webPort), enabled: webEnabled === 'true', ip: getLocalIP() };
  }
  
  if (path === 'setWebSettings') {
    if (params.port) runSql("INSERT OR REPLACE INTO settings (key, value) VALUES ('web_port', ?)", [params.port.toString()]);
    if (params.enabled !== undefined) runSql("INSERT OR REPLACE INTO settings (key, value) VALUES ('web_enabled', ?)", [params.enabled ? 'true' : 'false']);
    const newPort = parseInt(params.port) || WEB_PORT;
    const enabled = params.enabled !== undefined ? params.enabled : true;
    if (enabled) restartWebServer(newPort); else stopWebServer();
    return { success: true, port: newPort, enabled };
  }
  
  if (path === 'exportExcel') {
    const type = params.type;
    let items = [];
    if (type === 'messages' && params.groupId) items = queryAll("SELECT * FROM messages WHERE group_id = ? ORDER BY time DESC", [parseInt(params.groupId)]);
    else if (type === 'bots') items = queryAll("SELECT * FROM bots ORDER BY id");
    else if (type === 'groups') items = queryAll("SELECT g.*, b.name as bot_name FROM groups g LEFT JOIN bots b ON g.bot_id = b.id ORDER BY g.id");
    else if (type === 'schedules') items = queryAll("SELECT s.*, g.name as group_name, b.name as bot_name FROM schedules s LEFT JOIN groups g ON s.group_id = g.id LEFT JOIN bots b ON s.bot_id = b.id ORDER BY s.id");
    else if (type === 'users') items = queryAll("SELECT * FROM users ORDER BY id");
    else if (type === 'activity') items = queryAll("SELECT a.*, u.login FROM activity_log a LEFT JOIN users u ON a.user_id = u.id ORDER BY a.created_at DESC LIMIT 500");
    else if (type === 'planning') items = PlanningSystem.getPlans();
    
    const csv = generateExcel({ type, items });
    return { success: true, csv, filename: `hubpro_${type}_${new Date().toISOString().split('T')[0]}.csv` };
  }
  
  return { error: 'Unknown API: ' + path };
}

function getStats() {
  const today = new Date().toISOString().split('T')[0];
  return {
    botCount: queryAll("SELECT COUNT(*) as c FROM bots")[0]?.c || 0,
    activeBots: queryAll("SELECT COUNT(*) as c FROM bots WHERE status = 'active'")[0]?.c || 0,
    groupCount: queryAll("SELECT COUNT(*) as c FROM groups")[0]?.c || 0,
    activeGroups: queryAll("SELECT COUNT(*) as c FROM groups WHERE status = 'active'")[0]?.c || 0,
    messageCount: queryAll("SELECT COUNT(*) as c FROM messages")[0]?.c || 0,
    messagesToday: queryAll("SELECT COUNT(*) as c FROM messages WHERE date(time) = ?", [today])[0]?.c || 0,
    userCount: queryAll("SELECT COUNT(*) as c FROM users")[0]?.c || 0,
    activeUsers: queryAll("SELECT COUNT(*) as c FROM users WHERE status = 'active'")[0]?.c || 0,
    scheduleCount: queryAll("SELECT COUNT(*) as c FROM schedules")[0]?.c || 0,
    activeSchedules: queryAll("SELECT COUNT(*) as c FROM schedules WHERE status = 'active'")[0]?.c || 0,
    templateCount: queryAll("SELECT COUNT(*) as c FROM templates")[0]?.c || 0,
    // Ошибки со всех групп
    errorsToday: queryAll("SELECT COUNT(*) as c FROM messages WHERE status = 'failed' AND date(time) = ?", [today])[0]?.c || 0,
    errorsTotal: queryAll("SELECT COUNT(*) as c FROM messages WHERE status = 'failed'")[0]?.c || 0,
    // Планирование
    pendingPlans: PlanningSystem.plans.filter(p => p.status === 'pending').length,
    completedPlans: PlanningSystem.plans.filter(p => p.status === 'completed').length
  };
}

// ============ WEBHOOK SERVER ============
function startWebhookServer(port = WEBHOOK_PORT) {
  if (webhookServer) return;
  
  webhookServer = http.createServer(async (req, res) => {
    if (req.method === 'POST' && req.url.startsWith('/webhook/')) {
      let body = '';
      req.on('data', chunk => body += chunk);
      req.on('end', async () => {
        try {
          const token = req.url.split('/webhook/')[1];
          const update = JSON.parse(body);
          
          if (update.message) {
            const bot = queryOne("SELECT id FROM bots WHERE token LIKE ?", ['%' + token]);
            if (bot) {
              const groups = queryAll("SELECT * FROM groups WHERE bot_id = ? AND status = 'active'", [bot.id]);
              const group = groups.find(g => g.chat_id === update.message.chat.id.toString());
              if (group) {
                db.run("INSERT INTO messages (group_id, text, sent, sender, status) VALUES (?, ?, ?, ?, ?)", 
                  [group.id, update.message.text, 0, update.message.from.first_name || update.message.from.username, 'received']);
                saveDatabase();
                if (win && !win.isDestroyed()) win.webContents.send('tg:incoming', { groupId: group.id, text: update.message.text, time: getLocalTimestamp(), sender: update.message.from.first_name || update.message.from.username });
              }
            }
          }
          res.writeHead(200); res.end('OK');
        } catch (e) { console.error('Webhook error:', e); res.writeHead(500); res.end('Error'); }
      });
    } else { res.writeHead(404); res.end('Not found'); }
  });
  
  webhookServer.on('error', (err) => { if (err.code === 'EADDRINUSE') { console.log(`Порт ${port} занят, webhook сервер не запущен`); webhookServer = null; } });
  webhookServer.listen(port, () => { console.log(`Webhook server started on port ${port}`); });
}

function registerIPCHandlers() {
  // Основные
  ipcMain.handle('app:getVersion', () => ({ version: VERSION, updates: UPDATE_INFO, timezone: LOCAL_TZ, company: COMPANY_NAME }));
  ipcMain.handle('app:getTime', () => ({ time: getLocalTime(), timestamp: getLocalTimestamp(), timezone: LOCAL_TZ }));
  ipcMain.handle('app:getPermissions', (_, role) => ({ permissions: ROLE_PERMISSIONS[role] || ROLE_PERMISSIONS.user }));
  ipcMain.handle('app:checkSchedule', () => checkAllSchedules());
  ipcMain.handle('app:getMainAdmin', () => ({ login: MAIN_ADMIN_LOGIN }));
  ipcMain.handle('app:getHelper', () => ({ login: HELPER_LOGIN }));
  ipcMain.handle('app:reloadAll', () => { syncPolling(queryAll("SELECT * FROM bots WHERE online = 1 AND status = 'active'"), queryAll("SELECT * FROM groups WHERE status = 'active'")); return { success: true }; });
  
  // Веб-настройки
  ipcMain.handle('app:getWebSettings', () => {
    const webPort = queryOne("SELECT value FROM settings WHERE key = 'web_port'")?.value || '8080';
    const webEnabled = queryOne("SELECT value FROM settings WHERE key = 'web_enabled'")?.value || 'true';
    return { port: parseInt(webPort), enabled: webEnabled === 'true', ip: getLocalIP() };
  });
  
  ipcMain.handle('app:setWebSettings', async (_, { port, enabled }) => {
    if (port) { runSql("INSERT OR REPLACE INTO settings (key, value) VALUES ('web_port', ?)", [port.toString()]); WEB_PORT = port; }
    if (enabled !== undefined) runSql("INSERT OR REPLACE INTO settings (key, value) VALUES ('web_enabled', ?)", [enabled ? 'true' : 'false']);
    if (enabled === false) stopWebServer(); else restartWebServer(WEB_PORT);
    return { success: true, port: WEB_PORT, enabled: enabled !== false };
  });
  
  ipcMain.handle('app:restartWeb', () => { restartWebServer(WEB_PORT); return { success: true }; });
  
  // Логи расписания
  ipcMain.handle('schedule:getLogs', (_, filters) => ScheduleLogger.getLogs(filters));
  ipcMain.handle('schedule:getErrors', () => ScheduleLogger.getErrors());
  ipcMain.handle('schedule:getById', (_, scheduleId) => ScheduleLogger.getBySchedule(scheduleId));
  
  // Планирование
  ipcMain.handle('planning:get', (_, filters) => ({ plans: PlanningSystem.getPlans(filters), dashboard: PlanningSystem.getDashboard() }));
  ipcMain.handle('planning:add', (_, plan) => ({ success: true, plan: PlanningSystem.add(plan) }));
  ipcMain.handle('planning:update', (_, { id, ...data }) => ({ success: true, plan: PlanningSystem.update(id, data) }));
  ipcMain.handle('planning:delete', (_, id) => { PlanningSystem.delete(id); return { success: true }; });
  ipcMain.handle('planning:getDashboard', () => PlanningSystem.getDashboard());
  
  // Данные
  ipcMain.handle('data:export', async () => { try { return { success: true, data: { bots: queryAll("SELECT id, name, token, online, status, created_at FROM bots").map(b => ({...b, token: decrypt(b.token)})), groups: queryAll("SELECT g.id, g.name, g.chat_id, g.bot_id, g.topic_ids, g.status, g.created_at, b.name as bot_name FROM groups g LEFT JOIN bots b ON g.bot_id = b.id"), schedules: queryAll("SELECT s.*, g.name as group_name, b.name as bot_name FROM schedules s LEFT JOIN groups g ON s.group_id = g.id LEFT JOIN bots b ON s.bot_id = b.id"), users: queryAll("SELECT id, login, role, status, created_at FROM users"), templates: queryAll("SELECT * FROM templates"), planning: PlanningSystem.plans } }; } catch (err) { return { success: false, error: err.message }; } });
  ipcMain.handle('data:import', async (_, { bots, groups, schedules, users, templates, planning }) => { try { 
    if (bots) for (const b of bots) if (b.name && b.token) try { db.run("INSERT OR IGNORE INTO bots (name, token, online, status) VALUES (?, ?, ?, ?)", [b.name, encrypt(b.token), b.online ? 1 : 0, b.status || 'active']); } catch(e) {} 
    if (groups) for (const g of groups) if (g.name && g.chat_id && g.bot_id) try { db.run("INSERT OR IGNORE INTO groups (name, chat_id, bot_id, topic_ids, status) VALUES (?, ?, ?, ?, ?)", [g.name, g.chat_id, g.bot_id, g.topic_ids || null, g.status || 'active']); } catch(e) {} 
    if (schedules) for (const s of schedules) if (s.name && s.text && s.group_id && s.bot_id) try { db.run("INSERT OR IGNORE INTO schedules (name, text, group_id, bot_id, scheduled_time, repeat_type, status) VALUES (?, ?, ?, ?, ?, ?, ?)", [s.name, s.text, s.group_id, s.bot_id, s.scheduled_time, s.repeat_type || 'once', s.status || 'active']); } catch(e) {} 
    if (templates) for (const t of templates) if (t.name && t.content) try { db.run("INSERT OR IGNORE INTO templates (name, content) VALUES (?, ?)", [t.name, t.content]); } catch(e) {} 
    if (planning) for (const p of planning) try { PlanningSystem.add(p); } catch(e) {} 
    saveDatabase(); return { success: true }; 
  } catch (err) { return { success: false, error: err.message }; } });
  
  ipcMain.handle('data:exportExcel', async (_, { type, groupId }) => {
    try {
      let items = [];
      if (type === 'messages' && groupId) items = queryAll("SELECT * FROM messages WHERE group_id = ? ORDER BY time DESC", [groupId]);
      else if (type === 'bots') items = queryAll("SELECT * FROM bots ORDER BY id");
      else if (type === 'groups') items = queryAll("SELECT g.*, b.name as bot_name FROM groups g LEFT JOIN bots b ON g.bot_id = b.id ORDER BY g.id");
      else if (type === 'schedules') items = queryAll("SELECT s.*, g.name as group_name, b.name as bot_name FROM schedules s LEFT JOIN groups g ON s.group_id = g.id LEFT JOIN bots b ON s.bot_id = b.id ORDER BY s.id");
      else if (type === 'users') items = queryAll("SELECT * FROM users ORDER BY id");
      else if (type === 'activity') items = queryAll("SELECT a.*, u.login FROM activity_log a LEFT JOIN users u ON a.user_id = u.id ORDER BY a.created_at DESC LIMIT 500");
      else if (type === 'planning') items = PlanningSystem.getPlans();
      
      const csv = generateExcel({ type, items });
      return { success: true, csv, filename: `hubpro_${type}_${new Date().toISOString().split('T')[0]}.csv` };
    } catch (err) { return { success: false, error: err.message }; }
  });
  
  // Аутентификация
  ipcMain.handle('auth:login', (_, { login, password }) => { 
    const user = queryOne("SELECT * FROM users WHERE login = ?", [login]); 
    if (!user) return { success: false, error: 'Пользователь не найден' }; 
    if (user.password !== hashPassword(password)) return { success: false, error: 'Неверный пароль' }; 
    if (user.delete_request === 1) return { success: false, error: 'Аккаунт отмечен на удаление' }; 
    if (user.status !== 'active') return { success: false, error: 'Аккаунт заблокирован' }; 
    AIMonitor.log('LOGIN', user.id, `Пользователь ${user.login} вошёл`, 'low');
    logActivity(user.id, 'LOGIN', `Вход в систему`);
    showNotification('HubPro', `${user.login} вошёл в систему`);
    return { success: true, user: { id: user.id, login: user.login, role: user.role }, permissions: ROLE_PERMISSIONS[user.role] || ROLE_PERMISSIONS.user }; 
  });
  
  ipcMain.handle('auth:getUsers', () => queryAll("SELECT id, login, role, status, created_at, delete_request FROM users ORDER BY id"));
  
  // БЕЗОПАСНОСТЬ: HelpNeural может менять только NeuralAP
  ipcMain.handle('auth:addUser', (_, { login, password, role, currentUserRole, currentUserId, currentUserLogin }) => { 
    // Проверка на HelpNeural
    if (login === HELPER_LOGIN && currentUserRole !== 'admin') return { success: false, error: 'Только главный админ может создать резервного пользователя' };
    if (currentUserRole !== 'admin') return { success: false, error: 'Нет прав' }; 
    const exists = queryOne("SELECT id FROM users WHERE login = ?", [login]);
    if (exists) return { success: false, error: 'Логин занят' }; 
    AIMonitor.log('ADD_USER', null, `Создан пользователь: ${login}`, role === 'admin' ? 'high' : 'low');
    logActivity(null, 'ADD_USER', `Создан пользователь ${login}`);
    return runSql("INSERT INTO users (login, password, role, status) VALUES (?, ?, ?, ?)", [login, hashPassword(password), role || 'user', 'active']); 
  });
  
  ipcMain.handle('auth:updateUser', (_, { id, login, password, currentUserId, currentUserRole, currentUserLogin }) => { 
    const targetUser = queryOne("SELECT * FROM users WHERE id = ?", [id]); 
    if (!targetUser) return { success: false, error: 'Пользователь не найден' }; 
    
    // Защита HelpNeural - только NeuralAP может менять
    if (targetUser.login === HELPER_LOGIN) {
      if (currentUserLogin !== MAIN_ADMIN_LOGIN) return { success: false, error: 'Только главный админ NeuralAP может изменить резервного пользователя' };
    }
    
    // Защита NeuralAP
    if (targetUser.login === MAIN_ADMIN_LOGIN && currentUserLogin !== MAIN_ADMIN_LOGIN) {
      return { success: false, error: 'Главный админ защищён' };
    }
    
    if (login) { 
      const exists = queryOne("SELECT id FROM users WHERE login = ? AND id != ?", [login, id]); 
      if (exists) return { success: false, error: 'Логин занят' }; 
      runSql("UPDATE users SET login = ? WHERE id = ?", [login, id]); 
      logActivity(currentUserId, 'CHANGE_LOGIN', `Смена логина ${id}`); 
    } 
    if (password) { 
      runSql("UPDATE users SET password = ? WHERE id = ?", [hashPassword(password), id]); 
      logActivity(currentUserId, 'CHANGE_PASSWORD', `Смена пароля ${id}`); 
    } 
    return { success: true }; 
  });
  
  ipcMain.handle('auth:deleteUser', (_, { id, currentUserRole, currentUserId, currentUserLogin }) => { 
    if (currentUserRole !== 'admin') return { success: false, error: 'Нет прав' }; 
    const target = queryOne("SELECT * FROM users WHERE id = ?", [id]); 
    
    // Защита NeuralAP
    if (target?.login === MAIN_ADMIN_LOGIN) { AIMonitor.log('SECURITY_ALERT', null, 'Попытка удаления главного админа', 'critical'); return { success: false, error: 'Главный админ защищён' }; }
    // Защита HelpNeural
    if (target?.login === HELPER_LOGIN && currentUserLogin !== MAIN_ADMIN_LOGIN) return { success: false, error: 'Только NeuralAP может удалить резервного пользователя' };
    if (id === currentUserId) return { success: false, error: 'Нельзя удалить себя' };
    AIMonitor.log('DELETE_USER', null, `Удалён пользователь ${id}`, 'medium'); 
    logActivity(null, 'DELETE_USER', `Удалён пользователь ${id}`); 
    const result = runSql("DELETE FROM users WHERE id = ?", [id]);
    if (result.success) syncPolling(queryAll("SELECT * FROM bots WHERE online = 1 AND status = 'active'"), queryAll("SELECT * FROM groups WHERE status = 'active'"));
    return result; 
  });
  
  ipcMain.handle('auth:toggleUserStatus', (_, { id, status, currentUserRole, currentUserId, currentUserLogin }) => { 
    const target = queryOne("SELECT * FROM users WHERE id = ?", [id]); 
    
    // Защита NeuralAP - только NeuralAP может блокировать
    if (target?.login === MAIN_ADMIN_LOGIN) {
      if (currentUserLogin !== MAIN_ADMIN_LOGIN) return { success: false, error: 'Только NeuralAP может заблокировать главного админа' };
    }
    
    // Защита HelpNeural - только NeuralAP может блокировать
    if (target?.login === HELPER_LOGIN) {
      if (currentUserLogin !== MAIN_ADMIN_LOGIN) return { success: false, error: 'Только NeuralAP может заблокировать резервного пользователя' };
    }
    
    // HelpNeural может разблокировать всех
    if (currentUserLogin === HELPER_LOGIN && status === 'active') {
      // Разрешаем
    } else if (currentUserRole !== 'admin' && currentUserRole !== 'helper') {
      return { success: false, error: 'Нет прав' };
    }
    
    if (id === currentUserId) return { success: false, error: 'Нельзя заблокировать себя' };
    AIMonitor.log(status === 'active' ? 'UNBLOCK_USER' : 'BLOCK_USER', null, `Пользователь ${id}: ${status}`, status === 'inactive' ? 'medium' : 'low'); 
    logActivity(null, status === 'active' ? 'UNBLOCK_USER' : 'BLOCK_USER', `Пользователь ${id}: ${status}`); 
    return runSql("UPDATE users SET status = ? WHERE id = ?", [status, id]); 
  });
  
  ipcMain.handle('ai:getLogs', () => AIMonitor.getLogs());
  ipcMain.handle('ai:getAlerts', () => AIMonitor.getAlerts());
  ipcMain.handle('auth:getActivityLog', () => queryAll("SELECT a.*, u.login FROM activity_log a LEFT JOIN users u ON a.user_id = u.id ORDER BY a.created_at DESC LIMIT 100"));
  
  // Боты
  ipcMain.handle('db:getBots', () => queryAll("SELECT * FROM bots ORDER BY id").map(b => ({ ...b, token: decrypt(b.token) })));
  ipcMain.handle('db:addBot', (_, { name, token }) => { try { db.run("INSERT INTO bots (name, token, status) VALUES (?, ?, ?)", [name, encrypt(token), 'active']); const lastId = queryOne("SELECT last_insert_rowid() as id"); AIMonitor.log('ADD_BOT', null, `Добавлен бот: ${name}`, 'medium'); logActivity(null, 'ADD_BOT', `Добавлен бот ${name}`); saveDatabase(); return { success: true, id: lastId.id }; } catch (err) { return { success: false, error: err.message }; } });
  ipcMain.handle('db:updateBot', (_, { id, name, token, status }) => { if (token) return runSql("UPDATE bots SET name = ?, token = ?, status = ? WHERE id = ?", [name, encrypt(token), status || 'active', id]); else return runSql("UPDATE bots SET name = ?, status = ? WHERE id = ?", [name, status || 'active', id]); });
  ipcMain.handle('db:deleteBot', (_, id) => { AIMonitor.log('DELETE_BOT', null, `Удалён бот ${id}`, 'medium'); logActivity(null, 'DELETE_BOT', `Удалён бот ${id}`); const result = runSql("DELETE FROM bots WHERE id = ?", [id]); if (result.success) syncPolling(queryAll("SELECT * FROM bots WHERE online = 1 AND status = 'active'"), queryAll("SELECT * FROM groups WHERE status = 'active'")); return result; });
  ipcMain.handle('db:toggleBotStatus', (_, { id, status }) => runSql("UPDATE bots SET status = ? WHERE id = ?", [status, id]));
  
  // Группы
  ipcMain.handle('db:getGroups', () => queryAll("SELECT g.*, b.name as bot_name, b.token as bot_token FROM groups g LEFT JOIN bots b ON g.bot_id = b.id ORDER BY g.id"));
  ipcMain.handle('db:addGroup', (_, { name, chatId, botId, topicIds }) => { try { db.run("INSERT INTO groups (name, chat_id, bot_id, topic_ids, status) VALUES (?, ?, ?, ?, ?)", [name, chatId, botId, topicIds || null, 'active']); const lastId = queryOne("SELECT last_insert_rowid() as id"); AIMonitor.log('ADD_GROUP', null, `Добавлена группа: ${name}`, 'low'); logActivity(null, 'ADD_GROUP', `Добавлена группа ${name}`); saveDatabase(); return { success: true, id: lastId.id }; } catch (err) { return { success: false, error: err.message }; } });
  ipcMain.handle('db:updateGroup', (_, { id, name, chatId, botId, topicIds, status }) => runSql("UPDATE groups SET name = ?, chat_id = ?, bot_id = ?, topic_ids = ?, status = ? WHERE id = ?", [name, chatId, botId, topicIds || null, status || 'active', id]));
  ipcMain.handle('db:deleteGroup', (_, id) => { AIMonitor.log('DELETE_GROUP', null, `Удалена группа ${id}`, 'medium'); logActivity(null, 'DELETE_GROUP', `Удалена группа ${id}`); return runSql("DELETE FROM groups WHERE id = ?", [id]); });
  ipcMain.handle('db:toggleGroupStatus', (_, { id, status }) => runSql("UPDATE groups SET status = ? WHERE id = ?", [status, id]));
  
  // Сообщения
  ipcMain.handle('db:getMessages', (_, groupId) => queryAll("SELECT * FROM messages WHERE group_id = ? ORDER BY time ASC", [groupId]));
  ipcMain.handle('db:addMessage', (_, { groupId, text, sent, sender, status }) => { try { db.run("INSERT INTO messages (group_id, text, sent, sender, status) VALUES (?, ?, ?, ?, ?)", [groupId, text, sent ? 1 : 0, sender || null, status || 'sent']); saveDatabase(); return { success: true }; } catch (err) { return { success: false, error: err.message }; } });
  ipcMain.handle('db:clearMessages', (_, groupId) => { if (groupId) return runSql("DELETE FROM messages WHERE group_id = ?", [groupId]); else return runSql("DELETE FROM messages"); });
  
  // Расписания
  ipcMain.handle('db:getSchedules', () => queryAll("SELECT s.*, g.name as group_name, g.chat_id, b.name as bot_name FROM schedules s LEFT JOIN groups g ON s.group_id = g.id LEFT JOIN bots b ON s.bot_id = b.id ORDER BY s.id"));
  ipcMain.handle('db:getScheduleLogs', (_, scheduleId) => queryAll("SELECT * FROM schedule_logs WHERE schedule_id = ? ORDER BY executed_at DESC LIMIT 50", [scheduleId]));
  ipcMain.handle('db:addSchedule', (_, { name, text, groupId, botId, scheduledTime, repeatType }) => { 
    try { 
      db.run("INSERT INTO schedules (name, text, group_id, bot_id, scheduled_time, repeat_type, status) VALUES (?, ?, ?, ?, ?, ?, ?)", [name, text, groupId, botId, scheduledTime, repeatType, 'active']); 
      const lastId = queryOne("SELECT last_insert_rowid() as id"); 
      AIMonitor.log('ADD_SCHEDULE', null, `Создано расписание: ${name}`, 'low'); 
      logActivity(null, 'ADD_SCHEDULE', `Создано расписание ${name}`); 
      // ЛОГ РАСПИСАНИЯ
      ScheduleLogger.add(lastId.id, name, 'created', `Создано расписание: ${name}`, 'success');
      saveDatabase(); 
      return { success: true, id: lastId.id }; 
    } catch (err) { return { success: false, error: err.message }; } 
  });
  ipcMain.handle('db:updateSchedule', (_, { id, name, text, groupId, botId, scheduledTime, repeatType }) => runSql("UPDATE schedules SET name = ?, text = ?, group_id = ?, bot_id = ?, scheduled_time = ?, repeat_type = ? WHERE id = ?", [name, text, groupId, botId, scheduledTime, repeatType, id]));
  ipcMain.handle('db:deleteSchedule', (_, id) => { 
    const schedule = queryOne("SELECT * FROM schedules WHERE id = ?", [id]);
    logActivity(null, 'DELETE_SCHEDULE', `Удалено расписание ${id}`);
    // ЛОГ РАСПИСАНИЯ
    if (schedule) ScheduleLogger.add(id, schedule.name, 'deleted', `Удалено расписание: ${schedule.name}`, 'success');
    return runSql("DELETE FROM schedules WHERE id = ?", [id]); 
  });
  ipcMain.handle('db:toggleSchedule', (_, { id, status }) => runSql("UPDATE schedules SET status = ? WHERE id = ?", [status, id]));
  ipcMain.handle('db:resetSchedule', (_, id) => runSql("UPDATE schedules SET last_executed = NULL WHERE id = ?", [id]));
  
  // Шаблоны
  ipcMain.handle('db:getTemplates', () => queryAll("SELECT * FROM templates ORDER BY id"));
  ipcMain.handle('db:addTemplate', (_, { name, content }) => { try { db.run("INSERT INTO templates (name, content) VALUES (?, ?)", [name, content]); saveDatabase(); return { success: true }; } catch (err) { return { success: false, error: err.message }; } });
  ipcMain.handle('db:updateTemplate', (_, { id, name, content }) => runSql("UPDATE templates SET name = ?, content = ? WHERE id = ?", [name, content, id]));
  ipcMain.handle('db:deleteTemplate', (_, id) => runSql("DELETE FROM templates WHERE id = ?", [id]));
  
  ipcMain.handle('db:getStats', () => getStats());
  
  // Уведомления
  ipcMain.handle('notifications:send', (_, { userId, fromId, text, type }) => runSql("INSERT INTO notifications (user_id, from_id, text, type) VALUES (?, ?, ?, ?)", [userId, fromId, text, type || 'message']));
  ipcMain.handle('notifications:get', (_, userId) => queryAll("SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 50", [userId]));
  ipcMain.handle('notifications:markRead', (_, id) => runSql("UPDATE notifications SET read = 1 WHERE id = ?", [id]));
  ipcMain.handle('notifications:getUnreadCount', (_, userId) => ({ count: queryAll("SELECT COUNT(*) as c FROM notifications WHERE user_id = ? AND read = 0", [userId])[0]?.c || 0 }));
  
  // Telegram
  ipcMain.on('tg:sync-config', async () => { const bots = queryAll("SELECT * FROM bots WHERE online = 1 AND status = 'active'"); const groups = queryAll("SELECT * FROM groups WHERE status = 'active'"); syncPolling(bots, groups); });
  ipcMain.handle('tg:send', async (_, { token, chatId, text, topicIds }) => { 
    try { 
      const me = await (await fetch(`https://api.telegram.org/bot${token}/getMe`)).json(); 
      if (!me.ok) return { ok: false, description: 'Неверный токен' }; 
      const chat = await (await fetch(`https://api.telegram.org/bot${token}/getChat?chat_id=${chatId}`)).json(); 
      if (!chat.ok) return { ok: false, description: 'Бот не в группе' }; 
      if (topicIds && Array.isArray(topicIds) && topicIds.length > 0) { 
        const results = []; 
        for (const tid of topicIds) results.push(await (await fetch(`https://api.telegram.org/bot${token}/sendMessage`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ chat_id: chatId, text, message_thread_id: tid, parse_mode: 'HTML' }) })).json()); 
        return { ok: results.every(r => r.ok), results }; 
      } 
      const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML' }) }); 
      return await res.json(); 
    } catch (err) { return { ok: false, description: err.message }; } 
  });
  
  ipcMain.handle('tg:sendMulti', async (_, { groupIds, text }) => {
    const results = [];
    for (const groupId of groupIds) {
      const g = queryOne("SELECT g.*, b.token as bot_token FROM groups g LEFT JOIN bots b ON g.bot_id = b.id WHERE g.id = ?", [groupId]);
      if (g && g.bot_token) {
        try {
          const token = decrypt(g.bot_token);
          const res = await (await fetch(`https://api.telegram.org/bot${token}/sendMessage`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ chat_id: g.chat_id, text, parse_mode: 'HTML' }) })).json();
          results.push({ groupId, groupName: g.name, success: res.ok, error: res.description });
          if (res.ok) db.run("INSERT INTO messages (group_id, text, sent, sender, status) VALUES (?, ?, ?, ?, ?)", [groupId, text, 1, 'HubPro (мульти)', 'sent']);
          else db.run("INSERT INTO messages (group_id, text, sent, sender, status) VALUES (?, ?, ?, ?, ?)", [groupId, text, 0, 'HubPro (мульти)', 'failed']);
        } catch (e) { results.push({ groupId, groupName: g.name, success: false, error: e.message }); }
      } else { results.push({ groupId, groupName: g?.name || 'Unknown', success: false, error: 'Бот не найден' }); }
    }
    saveDatabase();
    return { success: true, results };
  });
  
  ipcMain.handle('tg:checkBot', async (_, token) => { try { return await (await fetch(`https://api.telegram.org/bot${token}/getMe`)).json(); } catch (err) { return { ok: false, error: err.message }; } });
  ipcMain.handle('tg:getTopics', async (_, { token, chatId }) => { try { const data = await (await fetch(`https://api.telegram.org/bot${token}/getForumTopics?chat_id=${chatId}`)).json(); return data.ok ? { ok: true, topics: data.topics || [] } : { ok: false, error: data.description }; } catch (err) { return { ok: false, error: err.message }; } });
  
  console.log('IPC handlers registered');
}

function checkAllSchedules() {
  try {
    const now = new Date();
    const currentHour = String(now.getHours()).padStart(2, '0');
    const currentMinute = String(now.getMinutes()).padStart(2, '0');
    const currentTime = `${currentHour}:${currentMinute}`;
    const currentDate = now.toISOString().split('T')[0];
    
    const schedules = queryAll("SELECT * FROM schedules WHERE status = 'active'");
    let executed = 0;
    
    for (const s of schedules) {
      let scheduleTime = s.scheduled_time;
      if (scheduleTime && scheduleTime.includes('T')) scheduleTime = scheduleTime.split('T')[1].substring(0, 5);
      
      if (scheduleTime === currentTime) {
        if (s.repeat_type === 'once') {
          if (s.scheduled_time && s.scheduled_time.startsWith(currentDate)) {
            if (!s.last_executed || s.last_executed === null) {
              executeSchedule(s);
              executed++;
            }
          }
        } else {
          // ДЛЯ ПОВТОРЯЮЩИХСЯ - проверяем каждый интервал
          if (!s.last_executed) {
            executeSchedule(s);
            executed++;
          } else {
            const lastExec = new Date(s.last_executed);
            const diffMs = now.getTime() - lastExec.getTime();
            const diffMins = Math.floor(diffMs / 60000);
            
            let shouldExecute = false;
            if (s.repeat_type === 'daily' && diffMins >= 1440) shouldExecute = true;
            if (s.repeat_type === 'weekly' && diffMins >= 10080) shouldExecute = true;
            if (s.repeat_type === 'monthly') {
              const lastMonth = lastExec.getMonth();
              if (lastMonth !== now.getMonth()) shouldExecute = true;
            }
            if (s.repeat_type === 'hourly' && diffMins >= 60) shouldExecute = true;
            
            if (shouldExecute) {
              executeSchedule(s);
              executed++;
            }
          }
        }
      }
    }
    
    if (executed > 0) console.log(`Выполнено расписаний: ${executed}`);
    return { success: true, executed };
  } catch (e) {
    console.error('Ошибка расписания:', e);
    return { success: false, error: e.message };
  }
}

async function executeSchedule(s) {
  try { 
    const bot = queryOne("SELECT * FROM bots WHERE id = ?", [s.bot_id]); 
    const group = queryOne("SELECT * FROM groups WHERE id = ?", [s.group_id]); 
    if (!bot || !group) {
      ScheduleLogger.add(s.id, s.name, 'error', 'Бот или группа не найдены', 'error', 'Bot or group not found');
      return; 
    }
    
    const token = decrypt(bot.token);
    const res = await (await fetch(`https://api.telegram.org/bot${token}/sendMessage`, { 
      method: 'POST', 
      headers: { 'Content-Type': 'application/json' }, 
      body: JSON.stringify({ chat_id: group.chat_id, text: s.text, parse_mode: 'HTML' }) 
    })).json();
    
    if (res.ok) { 
      db.run("INSERT INTO schedule_logs (schedule_id, status, error) VALUES (?, ?, ?)", [s.id, 'success', null]); 
      db.run("INSERT INTO messages (group_id, text, sent, sender, status) VALUES (?, ?, ?, ?, ?)", [group.id, s.text, 1, 'HubPro (авто)', 'sent']); 
      db.run("UPDATE schedules SET last_executed = ? WHERE id = ?", [new Date().toISOString(), s.id]); 
      // ЛОГ РАСПИСАНИЯ
      ScheduleLogger.add(s.id, s.name, 'executed', `Выполнено: ${s.text}`, 'success');
      if (win && !win.isDestroyed()) win.webContents.send('tg:scheduleExecuted', { scheduleId: s.id, success: true, message: 'Сообщение отправлено' });
      showNotification('HubPro', `Расписание "${s.name}" выполнено`);
    } else { 
      db.run("INSERT INTO schedule_logs (schedule_id, status, error) VALUES (?, ?, ?)", [s.id, 'error', res.description]); 
      db.run("INSERT INTO messages (group_id, text, sent, sender, status) VALUES (?, ?, ?, ?, ?)", [group.id, s.text, 0, 'HubPro (авто)', 'failed']); 
      // ЛОГ РАСПИСАНИЯ С ОШИБКОЙ
      ScheduleLogger.add(s.id, s.name, 'error', `Ошибка отправки: ${s.text}`, 'error', res.description);
      if (win && !win.isDestroyed()) win.webContents.send('tg:scheduleExecuted', { scheduleId: s.id, success: false, error: res.description });
      showNotification('HubPro', `Ошибка расписания: ${res.description}`);
    } 
  } catch (e) { 
    db.run("INSERT INTO schedule_logs (schedule_id, status, error) VALUES (?, ?, ?)", [s.id, 'error', e.message]); 
    // ЛОГ РАСПИСАНИЯ С ОШИБКОЙ
    ScheduleLogger.add(s.id, s.name, 'error', `Исключение: ${s.text}`, 'error', e.message);
    if (win && !win.isDestroyed()) win.webContents.send('tg:scheduleExecuted', { scheduleId: s.id, success: false, error: e.message });
    showNotification('HubPro', `Ошибка: ${e.message}`);
  } 
  saveDatabase(); 
}

function setupAutoUpdater() {
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.logger = require('electron-log');
  autoUpdater.feedUrl = 'https://github.com/smol0901-jpg/HubPro/releases/latest';
  
  autoUpdater.on('checking-for-update', () => { console.log('Проверка обновлений...'); });
  autoUpdater.on('update-available', (info) => {
    console.log('Доступно обновление:', info.version);
    if (win?.webContents) win.webContents.send('update-available', info);
    showNotification('HubPro', `Доступно обновление v${info.version}`);
  });
  autoUpdater.on('update-not-available', () => { console.log('Обновлений нет'); });
  autoUpdater.on('download-progress', (progress) => { console.log(`Загрузка: ${progress.percent.toFixed(1)}%`); });
  autoUpdater.on('update-downloaded', (info) => {
    if (win?.webContents) win.webContents.send('update-downloaded', info);
    dialog.showMessageBox(win, { type: 'info', title: 'Обновление', message: `Загружена версия ${info.version}. Перезапустить?`, buttons: ['Да', 'Нет'] }).then(r => { if (r.response === 0) autoUpdater.quitAndInstall(); });
  });
  autoUpdater.on('error', (e) => { console.error('Ошибка обновления:', e); });
  
  if (app.isPackaged) autoUpdater.checkForUpdatesAndNotify();
}

autoUpdater.autoDownload = true; autoUpdater.autoInstallOnAppQuit = true;
app.whenReady().then(async () => { 
  db = await initDatabase(); 
  registerIPCHandlers(); 
  createWindow(); 
  await createTray(); 
  setupAutoUpdater(); 
  startScheduleChecker(); 
  startWebhookServer(WEBHOOK_PORT);
  
  // Загружаем настройки веб
  const webPortSetting = queryOne("SELECT value FROM settings WHERE key = 'web_port'");
  const webEnabledSetting = queryOne("SELECT value FROM settings WHERE key = 'web_enabled'");
  WEB_PORT = parseInt(webPortSetting?.value) || 8080;
  const webEnabled = webEnabledSetting?.value !== 'false';
  
  if (webEnabled) startWebServer(WEB_PORT);
  
  checkAllSchedules();
  
  // АВТО ОБНОВЛЕНИЕ ГРУПП ПРИ ЗАПУСКЕ
  const bots = queryAll("SELECT * FROM bots WHERE online = 1 AND status = 'active'"); 
  const groups = queryAll("SELECT * FROM groups WHERE status = 'active'"); 
  syncPolling(bots, groups); 
  
  showNotification('HubPro', `${COMPANY_NAME} v${VERSION} запущен`);
});

function createWindow() { 
  win = new BrowserWindow({ 
    width: 1400, 
    height: 900, 
    title: `${COMPANY_NAME} v${VERSION}`, 
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false }, 
    show: false 
  }); 
  win.loadFile('renderer/index.html'); 
  win.once('ready-to-show', () => win.show()); 
  win.on('close', (event) => {
    if (!app.isQuitting) {
      event.preventDefault();
      win.hide();
      showNotification('HubPro', 'Приложение свёрнуто в трей');
    }
  });
}

async function createTray() {
  const buildDir = path.join(__dirname, 'build'); 
  if (!fs.existsSync(buildDir)) fs.mkdirSync(buildDir, { recursive: true });
  const iconPath = path.join(buildDir, 'icon.png');
  if (!fs.existsSync(iconPath)) fs.writeFileSync(iconPath, Buffer.from([0x89,0x50,0x4E,0x47,0x0D,0x0A,0x1A,0x0A,0x00,0x00,0x00,0x0D,0x49,0x48,0x44,0x52,0x00,0x00,0x00,0x10,0x00,0x00,0x00,0x10,0x08,0x06,0x00,0x00,0x00,0x1F,0xF3,0xFF,0x61,0x00,0x00,0x00,0x01,0x73,0x52,0x47,0x42,0x00,0xAE,0xCE,0x1C,0xE9,0x00,0x00,0x00,0x3D,0x49,0x44,0x41,0x54,0x38,0x4F,0x63,0x64,0x60,0x18,0x05,0xA3,0x00,0x31,0x80,0x98,0x98,0x98,0x98,0x18,0x05,0xA3,0x00,0x31,0x80,0x98,0x98,0x98,0x98,0x18,0x05,0xA3,0x00,0x31,0x80,0x98,0x98,0x98,0x98,0x18,0x05,0xA3,0x00,0x31,0x80,0x98,0x98,0x98,0x98,0x18,0x05,0xA3,0x00,0x00,0x0A,0x3F,0x04,0x1C,0xB8,0xD1,0x3E,0x00,0x00,0x00,0x00,0x49,0x45,0x4E,0x44,0xAE,0x42,0x60,0x82]));
  
  tray = new Tray(nativeImage.createFromPath(iconPath).isEmpty() ? nativeImage.createEmpty() : nativeImage.createFromPath(iconPath));
  tray.setToolTip(`${COMPANY_NAME} v${VERSION}`);
  
  const contextMenu = Menu.buildFromTemplate([
    { label: '📱 Открыть HubPro', click: () => { win.show(); win.focus(); } },
    { type: 'separator' },
    { label: '🌐 Веб-интерфейс', click: () => { require('electron').shell.openExternal(`http://localhost:${WEB_PORT}`); }},
    { label: '🔄 Перезапустить polling', click: () => { const bots = queryAll("SELECT * FROM bots WHERE online = 1 AND status = 'active'"); const groups = queryAll("SELECT * FROM groups WHERE status = 'active'"); syncPolling(bots, groups); showNotification('HubPro', 'Polling перезапущен'); }},
    { label: '📊 Проверить расписание', click: () => { const result = checkAllSchedules(); showNotification('HubPro', result.success ? `Проверка: ${result.executed} выполнено` : 'Ошибка'); } },
    { type: 'separator' },
    { label: '❌ Выход', click: () => { app.isQuitting = true; app.quit(); }}
  ]);
  
  tray.setContextMenu(contextMenu);
  tray.on('double-click', () => { win.show(); win.focus(); });
  showNotification('HubPro', `${COMPANY_NAME} v${VERSION} запущен\nЧасовой пояс: ${LOCAL_TZ}`);
}

function syncPolling(bots, groups) { 
  Object.values(pollingIntervals).forEach(clearInterval); 
  pollingIntervals = {}; 
  botOffsets = {}; 
  bots.forEach(bot => { 
    const token = decrypt(bot.token); 
    botOffsets[bot.id] = 0; 
    const poll = async () => { 
      try { 
        const c = new AbortController(); 
        const t = setTimeout(() => c.abort(), 10000); 
        const data = await (await fetch(`https://api.telegram.org/bot${token}/getUpdates?offset=${botOffsets[bot.id]}&timeout=10`, { signal: c.signal })).json(); 
        clearTimeout(t); 
        if (data.ok && data.result) data.result.forEach(u => { 
          botOffsets[bot.id] = u.update_id + 1; 
          if (u.message?.message?.text) { 
            const g = groups.find(g => g.bot_id === bot.id && g.chat_id === u.message.chat.id.toString()); 
            if (g) { 
              db.run("INSERT INTO messages (group_id, text, sent, sender, status) VALUES (?, ?, ?, ?, ?)", [g.id, u.message.text, 0, u.message.from.first_name || u.message.from.username, 'received']); 
              saveDatabase();
              if (win && !win.isDestroyed()) win.webContents.send('tg:incoming', { groupId: g.id, text: u.message.text, time: getLocalTimestamp(), sender: u.message.from.first_name || u.message.from.username }); 
            } 
          } 
        }); 
      } catch (e) { if (e.name !== 'AbortError') console.log('Poll', bot.id, e.message); } 
    }; 
    pollingIntervals[bot.id] = setInterval(poll, 3000); 
  }); 
  saveDatabase(); 
}

function startScheduleChecker() { 
  scheduleIntervals.forEach(id => clearInterval(id)); 
  scheduleIntervals = []; 
  const id = setInterval(() => { checkAllSchedules(); }, 1000);
  scheduleIntervals.push(id); 
}

app.on('window-all-closed', () => {});
app.on('activate', () => BrowserWindow.getAllWindows().length === 0 && createWindow()); 
app.on('before-quit', () => { app.isQuitting = true; scheduleIntervals.forEach(id => clearInterval(id)); if (webServer) webServer.close(); if (db) { saveDatabase(); db.close(); } });