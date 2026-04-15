const { app, BrowserWindow, ipcMain, Tray, Menu, dialog, nativeImage } = require('electron');
const { autoUpdater } = require('electron-updater');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

let win;
let tray;
let pollingIntervals = {};
let botOffsets = {};
let db;
let scheduleIntervals = [];

// ============ ШИФРОВАНИЕ ============
const ENCRYPTION_KEY = crypto.scryptSync(app.getPath('userData'), 'hubpro-salt', 32);
const IV_LENGTH = 16;

function encrypt(text) {
  if (!text) return text;
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv('aes-256-cbc', ENCRYPTION_KEY, iv);
  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  return iv.toString('hex') + ':' + encrypted;
}

function decrypt(text) {
  if (!text || !text.includes(':')) return text;
  try {
    const parts = text.split(':');
    const iv = Buffer.from(parts[0], 'hex');
    const encrypted = parts[1];
    const decipher = crypto.createDecipheriv('aes-256-cbc', ENCRYPTION_KEY, iv);
    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  } catch (e) {
    return text;
  }
}

// ============ ХЕШИРОВАНИЕ ПАРОЛЯ ============
function hashPassword(password) {
  return crypto.createHash('sha256').update(password).digest('hex');
}

// ============ БАЗА ДАННЫХ ============
function initDatabase() {
  const Database = require('better-sqlite3');
  const userDataPath = app.getPath('userData');
  const dbPath = path.join(userDataPath, 'hubpro.db');
  
  db = new Database(dbPath);
  
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      login TEXT NOT NULL UNIQUE,
      password TEXT NOT NULL,
      role TEXT DEFAULT 'user',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      delete_request INTEGER DEFAULT 0
    );
    
    CREATE TABLE IF NOT EXISTS bots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      token TEXT NOT NULL UNIQUE,
      online INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    
    CREATE TABLE IF NOT EXISTS groups (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      chat_id TEXT NOT NULL,
      bot_id INTEGER NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (bot_id) REFERENCES bots(id) ON DELETE CASCADE
    );
    
    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      group_id INTEGER NOT NULL,
      text TEXT NOT NULL,
      sent INTEGER DEFAULT 1,
      sender TEXT,
      time DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (group_id) REFERENCES groups(id) ON DELETE CASCADE
    );
    
    CREATE TABLE IF NOT EXISTS schedules (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      text TEXT NOT NULL,
      group_id INTEGER NOT NULL,
      bot_id INTEGER NOT NULL,
      scheduled_time TEXT NOT NULL,
      repeat_type TEXT DEFAULT 'once',
      status TEXT DEFAULT 'pending',
      last_executed DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (group_id) REFERENCES groups(id) ON DELETE CASCADE,
      FOREIGN KEY (bot_id) REFERENCES bots(id) ON DELETE CASCADE
    );
    
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT
    );
  `);
  
  const adminExists = db.prepare('SELECT id FROM users WHERE login = ?').get('NeuralAP');
  if (!adminExists) {
    db.prepare('INSERT INTO users (login, password, role) VALUES (?, ?, ?)').run(
      'NeuralAP', hashPassword('0901Admin'), 'admin'
    );
    console.log('Admin created: NeuralAP / 0901Admin');
  }
  
  console.log('Database initialized at:', dbPath);
  return db;
}

// ============ РЕГИСТРАЦИЯ IPC ОБРАБОТЧИКОВ ============
function registerIPCHandlers() {
  // АВТОРИЗАЦИЯ
  ipcMain.handle('auth:login', (_, { login, password }) => {
    const user = db.prepare('SELECT * FROM users WHERE login = ?').get(login);
    if (!user) return { success: false, error: 'Пользователь не найден' };
    if (user.password !== hashPassword(password)) return { success: false, error: 'Неверный пароль' };
    if (user.delete_request === 1) return { success: false, error: 'Аккаунт отмечен на удаление' };
    return { success: true, user: { id: user.id, login: user.login, role: user.role } };
  });
  
  ipcMain.handle('auth:getUsers', () => {
    return db.prepare('SELECT id, login, role, created_at, delete_request FROM users ORDER BY id').all();
  });
  
  ipcMain.handle('auth:addUser', (_, { login, password, role }) => {
    try {
      const exists = db.prepare('SELECT id FROM users WHERE login = ?').get(login);
      if (exists) return { success: false, error: 'Логин уже занят' };
      db.prepare('INSERT INTO users (login, password, role) VALUES (?, ?, ?)').run(
        login, hashPassword(password), role || 'user'
      );
      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });
  
  ipcMain.handle('auth:requestDelete', (_, id) => {
    try {
      db.prepare('UPDATE users SET delete_request = 1 WHERE id = ?').run(id);
      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });
  
  ipcMain.handle('auth:approveDelete', (_, id) => {
    try {
      db.prepare('DELETE FROM users WHERE id = ?').run(id);
      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });
  
  ipcMain.handle('auth:cancelDelete', (_, id) => {
    try {
      db.prepare('UPDATE users SET delete_request = 0 WHERE id = ?').run(id);
      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });
  
  // БОТЫ
  ipcMain.handle('db:getBots', () => {
    const bots = db.prepare('SELECT * FROM bots ORDER BY id').all();
    return bots.map(b => ({ ...b, token: decrypt(b.token) }));
  });
  
  ipcMain.handle('db:addBot', (_, { name, token }) => {
    try {
      const encryptedToken = encrypt(token);
      const stmt = db.prepare('INSERT INTO bots (name, token, online) VALUES (?, ?, 0)');
      const result = stmt.run(name, encryptedToken);
      return { success: true, id: result.lastInsertRowid };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });
  
  ipcMain.handle('db:updateBot', (_, { id, name, token, online }) => {
    try {
      const encryptedToken = encrypt(token);
      db.prepare('UPDATE bots SET name = ?, token = ?, online = ? WHERE id = ?').run(name, encryptedToken, online ? 1 : 0, id);
      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });
  
  ipcMain.handle('db:deleteBot', (_, id) => {
    try {
      db.prepare('DELETE FROM bots WHERE id = ?').run(id);
      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });
  
  // ГРУППЫ
  ipcMain.handle('db:getGroups', () => {
    return db.prepare('SELECT g.*, b.name as bot_name FROM groups g LEFT JOIN bots b ON g.bot_id = b.id ORDER BY g.id').all();
  });
  
  ipcMain.handle('db:addGroup', (_, { name, chatId, botId }) => {
    try {
      const stmt = db.prepare('INSERT INTO groups (name, chat_id, bot_id) VALUES (?, ?, ?)');
      const result = stmt.run(name, chatId, botId);
      return { success: true, id: result.lastInsertRowid };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });
  
  ipcMain.handle('db:deleteGroup', (_, id) => {
    try {
      db.prepare('DELETE FROM groups WHERE id = ?').run(id);
      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });
  
  // СООБЩЕНИЯ
  ipcMain.handle('db:getMessages', (_, groupId) => {
    return db.prepare('SELECT * FROM messages WHERE group_id = ? ORDER BY time ASC').all(groupId);
  });
  
  ipcMain.handle('db:addMessage', (_, { groupId, text, sent, sender }) => {
    try {
      const stmt = db.prepare('INSERT INTO messages (group_id, text, sent, sender) VALUES (?, ?, ?, ?)');
      const result = stmt.run(groupId, text, sent ? 1 : 0, sender || null);
      return { success: true, id: result.lastInsertRowid };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });
  
  // РАСПИСАНИЕ
  ipcMain.handle('db:getSchedules', () => {
    return db.prepare(`
      SELECT s.*, g.name as group_name, g.chat_id, b.name as bot_name 
      FROM schedules s 
      LEFT JOIN groups g ON s.group_id = g.id 
      LEFT JOIN bots b ON s.bot_id = b.id 
      ORDER BY s.id
    `).all();
  });
  
  ipcMain.handle('db:addSchedule', (_, { name, text, groupId, botId, scheduledTime, repeatType }) => {
    try {
      const stmt = db.prepare('INSERT INTO schedules (name, text, group_id, bot_id, scheduled_time, repeat_type, status) VALUES (?, ?, ?, ?, ?, ?, ?)');
      const result = stmt.run(name, text, groupId, botId, scheduledTime, repeatType, 'active');
      return { success: true, id: result.lastInsertRowid };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });
  
  ipcMain.handle('db:deleteSchedule', (_, id) => {
    try {
      db.prepare('DELETE FROM schedules WHERE id = ?').run(id);
      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });
  
  ipcMain.handle('db:toggleSchedule', (_, { id, status }) => {
    try {
      db.prepare('UPDATE schedules SET status = ? WHERE id = ?').run(status, id);
      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });
  
  // СТАТИСТИКА
  ipcMain.handle('db:getStats', () => {
    const botCount = db.prepare('SELECT COUNT(*) as count FROM bots').get().count;
    const groupCount = db.prepare('SELECT COUNT(*) as count FROM groups').get().count;
    const messageCount = db.prepare('SELECT COUNT(*) as count FROM messages').get().count;
    const scheduleCount = db.prepare('SELECT COUNT(*) as count FROM schedules').get().count;
    const userCount = db.prepare('SELECT COUNT(*) as count FROM users').get().count;
    const deleteRequests = db.prepare('SELECT COUNT(*) as count FROM users WHERE delete_request = 1').get().count;
    return { botCount, groupCount, messageCount, scheduleCount, userCount, deleteRequests };
  });
  
  // СИНХРОНИЗАЦИЯ POLLING
  ipcMain.on('tg:sync-config', async () => {
    const bots = db.prepare('SELECT * FROM bots WHERE online = 1').all();
    const groups = db.prepare('SELECT * FROM groups').all();
    syncPolling(bots, groups);
  });
  
  // TELEGRAM API - УЛУЧШЕННАЯ ОТПРАВКА ============
  ipcMain.handle('tg:send', async (_, { token, chatId, text }) => {
    try {
      // Проверяем токен
      const meRes = await fetch(`https://api.telegram.org/bot${token}/getMe`);
      const meData = await meRes.json();
      if (!meData.ok) {
        return { ok: false, description: 'Неверный токен бота' };
      }
      
      // Проверяем доступ к чату
      const chatRes = await fetch(`https://api.telegram.org/bot${token}/getChat?chat_id=${chatId}`);
      const chatData = await chatRes.json();
      if (!chatData.ok) {
        return { ok: false, description: 'Бот не добавлен в группу или нет прав. Добавьте бота в группу и дайте права администратора' };
      }
      
      // Отправляем сообщение
      const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, text: text, parse_mode: 'HTML' })
      });
      const result = await res.json();
      
      if (!result.ok) {
        if (result.description.includes('chat not found')) {
          return { ok: false, description: 'Группа не найдена. Проверьте Chat ID' };
        }
        if (result.description.includes('bot was kicked')) {
          return { ok: false, description: 'Бот удалён из группы. Добавьте бота в группу' };
        }
        if (result.description.includes('rights')) {
          return { ok: false, description: 'Нет прав. Дайте боту права администратора в группе' };
        }
        return result;
      }
      
      return result;
    } catch (err) {
      console.error('Telegram send error:', err.message);
      return { ok: false, description: 'Ошибка соединения: ' + err.message };
    }
  });

  ipcMain.handle('tg:checkBot', async (_, token) => {
    try {
      const res = await fetch(`https://api.telegram.org/bot${token}/getMe`);
      return await res.json();
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });
  
  console.log('IPC handlers registered');
}

// ============ АВТООБНОВЛЕНИЕ ============
autoUpdater.autoDownload = true;
autoUpdater.autoInstallOnAppQuit = true;

app.whenReady().then(async () => {
  db = initDatabase();
  registerIPCHandlers();
  createWindow();
  await createTray();
  setupAutoUpdater();
  startScheduleChecker();
  
  const bots = db.prepare('SELECT * FROM bots WHERE online = 1').all();
  const groups = db.prepare('SELECT * FROM groups').all();
  syncPolling(bots, groups);
});

// ============ ОКНО И ТРЕЙ ============
function createWindow() {
  win = new BrowserWindow({
    width: 1280,
    height: 850,
    title: 'HubPro',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    },
    show: false
  });
  win.loadFile('renderer/index.html');
  win.once('ready-to-show', () => win.show());

  win.on('close', (event) => {
    if (!app.isQuitting) {
      event.preventDefault();
      win.hide();
    }
  });
}

async function createTray() {
  const buildDir = path.join(__dirname, 'build');
  if (!fs.existsSync(buildDir)) {
    fs.mkdirSync(buildDir, { recursive: true });
  }
  
  const iconPath = path.join(buildDir, 'icon.png');
  
  if (!fs.existsSync(iconPath)) {
    const iconBuffer = Buffer.from([
      0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0x00, 0x00, 0x00, 0x0D,
      0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x10, 0x00, 0x00, 0x00, 0x10,
      0x08, 0x06, 0x00, 0x00, 0x00, 0x1F, 0xF3, 0xFF, 0x61, 0x00, 0x00, 0x00,
      0x01, 0x73, 0x52, 0x47, 0x42, 0x00, 0xAE, 0xCE, 0x1C, 0xE9, 0x00, 0x00,
      0x00, 0x3D, 0x49, 0x44, 0x41, 0x54, 0x38, 0x4F, 0x63, 0x64, 0x60, 0x18,
      0x05, 0xA3, 0x00, 0x31, 0x80, 0x98, 0x98, 0x98, 0x98, 0x18, 0x05, 0xA3,
      0x00, 0x31, 0x80, 0x98, 0x98, 0x98, 0x98, 0x18, 0x05, 0xA3, 0x00, 0x31,
      0x80, 0x98, 0x98, 0x98, 0x98, 0x18, 0x05, 0xA3, 0x00, 0x31, 0x80, 0x98,
      0x98, 0x98, 0x98, 0x18, 0x05, 0xA3, 0x00, 0x00, 0x0A, 0x3F, 0x04, 0x1C,
      0xB8, 0xD1, 0x3E, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4E, 0x44, 0xAE,
      0x42, 0x60, 0x82
    ]);
    fs.writeFileSync(iconPath, iconBuffer);
  }
  
  const icon = nativeImage.createFromPath(iconPath);
  tray = new Tray(icon.isEmpty() ? nativeImage.createEmpty() : icon);
  
  const contextMenu = Menu.buildFromTemplate([
    { label: 'Открыть HubPro', click: () => { win.show(); win.focus(); } },
    { type: 'separator' },
    { label: 'Закрыть полностью', click: () => { app.isQuitting = true; app.quit(); } }
  ]);
  tray.setToolTip('HubPro — Управление Telegram ботами');
  tray.setContextMenu(contextMenu);
  tray.on('double-click', () => { win.show(); win.focus(); });
}

// ============ POLLING С УЛУЧШЕННОЙ ОБРАБОТКОЙ ОШИБОК ============
function syncPolling(bots, groups) {
  Object.values(pollingIntervals).forEach(clearInterval);
  pollingIntervals = {};
  botOffsets = {};

  bots.forEach(bot => {
    const decryptedToken = decrypt(bot.token);
    botOffsets[bot.id] = 0;
    
    const poll = async () => {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 10000);
        
        const res = await fetch(
          `https://api.telegram.org/bot${decryptedToken}/getUpdates?offset=${botOffsets[bot.id]}&timeout=10`,
          { signal: controller.signal }
        );
        clearTimeout(timeoutId);
        
        const data = await res.json();
        if (data.ok && data.result) {
          data.result.forEach(update => {
            botOffsets[bot.id] = update.update_id + 1;
            if (update.message && update.message.chat && update.message.text) {
              const chatId = update.message.chat.id.toString();
              const group = groups.find(g => g.bot_id === bot.id && g.chat_id === chatId);
              if (group) {
                db.prepare('INSERT INTO messages (group_id, text, sent, sender) VALUES (?, ?, 0, ?)').run(
                  group.id, update.message.text, update.message.from.first_name || update.message.from.username
                );
                win.webContents.send('tg:incoming', {
                  groupId: group.id,
                  text: update.message.text,
                  time: update.message.date * 1000,
                  sender: update.message.from.first_name || update.message.from.username
                });
              }
            }
          });
        }
      } catch (err) {
        // Игнорируем таймауты - это нормально
        if (err.name === 'AbortError') return;
        // Логируем только важные ошибки
        console.log('Polling bot', bot.id, ':', err.message);
      }
    };
    
    pollingIntervals[bot.id] = setInterval(poll, 3000);
  });
}

// ============ РАСПИСАНИЕ ============
function startScheduleChecker() {
  scheduleIntervals.forEach(id => clearInterval(id));
  scheduleIntervals = [];
  
  const intervalId = setInterval(async () => {
    try {
      const now = new Date();
      const currentTime = now.toTimeString().slice(0, 5);
      const currentDate = now.toISOString().split('T')[0];
      
      const schedules = db.prepare("SELECT * FROM schedules WHERE status = 'active'").all();
      
      for (const schedule of schedules) {
        const shouldExecute = checkScheduleTime(schedule, currentTime, currentDate, now);
        
        if (shouldExecute) {
          await executeSchedule(schedule);
        }
      }
    } catch (err) {
      console.error('Schedule checker error:', err);
    }
  }, 1000);
  
  scheduleIntervals.push(intervalId);
}

function checkScheduleTime(schedule, currentTime, currentDate, now) {
  const scheduledTime = schedule.scheduled_time;
  
  if (currentTime !== scheduledTime.slice(0, 5)) return false;
  
  if (schedule.repeat_type === 'once') {
    return schedule.scheduled_time.startsWith(currentDate);
  }
  
  const lastExecuted = schedule.last_executed ? new Date(schedule.last_executed) : null;
  
  switch (schedule.repeat_type) {
    case 'daily':
      return !lastExecuted || lastExecuted.toDateString() !== now.toDateString();
    case 'weekly':
      if (!lastExecuted) return true;
      const daysDiff = Math.floor((now - lastExecuted) / (1000 * 60 * 60 * 24));
      return daysDiff >= 7;
    case 'monthly':
      if (!lastExecuted) return true;
      return lastExecuted.getMonth() !== now.getMonth() || lastExecuted.getFullYear() !== now.getFullYear();
    default:
      return false;
  }
}

async function executeSchedule(schedule) {
  try {
    const bot = db.prepare('SELECT * FROM bots WHERE id = ?').get(schedule.bot_id);
    const group = db.prepare('SELECT * FROM groups WHERE id = ?').get(schedule.group_id);
    
    if (!bot || !group) return;
    
    const token = decrypt(bot.token);
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: group.chat_id, text: schedule.text, parse_mode: 'HTML' })
    });
    
    const result = await res.json();
    
    if (result.ok) {
      db.prepare('INSERT INTO messages (group_id, text, sent, sender) VALUES (?, ?, 1, ?)').run(
        group.id, schedule.text, 'HubPro (авто)'
      );
      db.prepare('UPDATE schedules SET last_executed = ? WHERE id = ?').run(new Date().toISOString(), schedule.id);
      win.webContents.send('tg:scheduleExecuted', { scheduleId: schedule.id, success: true });
    } else {
      win.webContents.send('tg:scheduleExecuted', { scheduleId: schedule.id, success: false, error: result.description });
    }
  } catch (err) {
    console.error('Execute schedule error:', err);
    win.webContents.send('tg:scheduleExecuted', { scheduleId: schedule.id, success: false, error: err.message });
  }
}

// ============ АВТООБНОВЛЕНИЕ ============
function setupAutoUpdater() {
  autoUpdater.on('update-available', (info) => {
    console.log('Update available:', info.version);
    if (win && win.webContents) {
      win.webContents.send('update-available', info);
    }
  });
  
  autoUpdater.on('update-downloaded', (info) => {
    console.log('Update downloaded:', info.version);
    if (win && win.webContents) {
      win.webContents.send('update-downloaded', info);
    }
    dialog.showMessageBox(win, {
      type: 'info',
      title: 'Обновление',
      message: `Загружена версия ${info.version}. Перезапустить?`,
      buttons: ['Перезапустить', 'Позже']
    }).then(({ response }) => {
      if (response === 0) autoUpdater.quitAndInstall();
    });
  });
  
  autoUpdater.on('error', (err) => {
    console.error('AutoUpdater error:', err);
  });
  
  if (app.isPackaged) {
    autoUpdater.checkForUpdatesAndNotify();
  }
}

// ============ ЗАВЕРШЕНИЕ ============
app.on('window-all-closed', () => process.platform !== 'darwin' && app.quit());
app.on('activate', () => BrowserWindow.getAllWindows().length === 0 && createWindow());
app.on('before-quit', () => {
  scheduleIntervals.forEach(id => clearInterval(id));
  if (db) db.close();
});