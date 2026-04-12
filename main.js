const { app, BrowserWindow, ipcMain, Tray, Menu, dialog } = require('electron');
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

// ============ БАЗА ДАННЫХ ============
function initDatabase() {
  const Database = require('better-sqlite3');
  const userDataPath = app.getPath('userData');
  const dbPath = path.join(userDataPath, 'hubpro.db');
  
  db = new Database(dbPath);
  
  db.exec(`
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
  
  console.log('Database initialized at:', dbPath);
  return db;
}

// ============ АВТООБНОВЛЕНИЕ ============
autoUpdater.autoDownload = true;
autoUpdater.autoInstallOnAppQuit = true;
autoUpdater.logger = null;

app.whenReady().then(async () => {
  db = initDatabase();
  createWindow();
  await createTray();
  setupAutoUpdater();
  startScheduleChecker();
  
  // ============ IPC ОБРАБОТЧИКИ ============
  
  // БОТЫ
  ipcMain.handle('db:getBots', () => {
    const bots = db.prepare('SELECT * FROM bots ORDER BY id').all();
    // Расшифровываем токены для отображения
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
      const result = stmt.run(name, text, groupId, botId, scheduledTime, repeatType, 'pending');
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
    return { botCount, groupCount, messageCount, scheduleCount };
  });
  
  // СИНХРОНИЗАЦИЯ POLLING
  ipcMain.on('tg:sync-config', async () => {
    const bots = db.prepare('SELECT * FROM bots WHERE online = 1').all();
    const groups = db.prepare('SELECT * FROM groups').all();
    syncPolling(bots, groups);
  });
  
  // ЗАПУСК POLLING
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
    icon: path.join(__dirname, 'build/icon.ico'),
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
  const iconPath = path.join(__dirname, 'build/icon.png');
  if (!fs.existsSync(iconPath)) {
    const base64 = 'image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAAXNSR0IArs4c6QAAAC5JREFUOE9jZKAQMFKonmFA1jBQ20BRcYw0YDQAAwMDAwMjGQMmBtMwMAwMAAChTgkG7y3wHAAAAABJRU5ErkJggg==';
    fs.writeFileSync(iconPath, Buffer.from(base64.split(',')[1], 'base64'));
  }
  tray = new Tray(iconPath);
  const contextMenu = Menu.buildFromTemplate([
    { label: 'Открыть HubPro', click: () => { win.show(); win.focus(); } },
    { type: 'separator' },
    { label: 'Закрыть полностью', click: () => { app.isQuitting = true; app.quit(); } }
  ]);
  tray.setToolTip('HubPro — Управление Telegram ботами');
  tray.setContextMenu(contextMenu);
  tray.on('double-click', () => { win.show(); win.focus(); });
}

// ============ TELEGRAM API ============
ipcMain.handle('tg:send', async (_, { token, chatId, text }) => {
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML' })
    });
    return await res.json();
  } catch (err) {
    return { ok: false, description: err.message };
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

// ============ POLLING ВХОДЯЩИХ ============
function syncPolling(bots, groups) {
  Object.values(pollingIntervals).forEach(clearInterval);
  pollingIntervals = {};
  botOffsets = {};

  bots.forEach(bot => {
    const decryptedToken = decrypt(bot.token);
    botOffsets[bot.id] = 0;
    pollingIntervals[bot.id] = setInterval(async () => {
      try {
        const res = await fetch(`https://api.telegram.org/bot${decryptedToken}/getUpdates?offset=${botOffsets[bot.id]}&timeout=10`);
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
      } catch (err) { console.error('Polling error:', err); }
    }, 3000);
  });
}

// ============ РАСПИСАНИЕ ============
function startScheduleChecker() {
  // Очищаем старые интервалы
  scheduleIntervals.forEach(id => clearInterval(id));
  scheduleIntervals = [];
  
  // Проверяем каждую секунду
  const intervalId = setInterval(async () => {
    try {
      const now = new Date();
      const currentTime = now.toTimeString().slice(0, 5); // HH:MM
      const currentDate = now.toISOString().split('T')[0]; // YYYY-MM-DD
      
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
  
  // Проверяем время
  if (currentTime !== scheduledTime.slice(0, 5)) return false;
  
  // Проверяем дату для повторяющихся
  if (schedule.repeat_type === 'once') {
    // Для одноразовых - проверяем дату
    return schedule.scheduled_time.startsWith(currentDate);
  }
  
  // Для повторяющихся
  const scheduleDate = new Date(schedule.scheduled_time);
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
    
    if (!bot || !group) {
      console.error('Bot or group not found for schedule:', schedule.id);
      return;
    }
    
    const token = decrypt(bot.token);
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: group.chat_id, text: schedule.text, parse_mode: 'HTML' })
    });
    
    const result = await res.json();
    
    if (result.ok) {
      // Сохраняем сообщение
      db.prepare('INSERT INTO messages (group_id, text, sent, sender) VALUES (?, ?, 1, ?)').run(
        group.id, schedule.text, 'HubPro (авто)'
      );
      
      // Обновляем last_executed
      db.prepare('UPDATE schedules SET last_executed = ? WHERE id = ?').run(new Date().toISOString(), schedule.id);
      
      // Уведомляем UI
      win.webContents.send('tg:scheduleExecuted', { scheduleId: schedule.id, success: true });
      console.log(`Schedule ${schedule.id} executed successfully`);
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
    win.webContents.send('update-available', info);
  });
  autoUpdater.on('update-downloaded', (info) => {
    win.webContents.send('update-downloaded', info);
    dialog.showMessageBox(win, {
      type: 'info',
      title: 'Обновление',
      message: `Загружена версия ${info.version}. Перезапустить?`,
      buttons: ['Перезапустить', 'Позже']
    }).then(({ response }) => {
      if (response === 0) autoUpdater.quitAndInstall();
    });
  });
  setTimeout(() => autoUpdater.checkForUpdates().catch(() => {}), 3000);
}

// ============ ЗАВЕРШЕНИЕ ============
app.on('window-all-closed', () => process.platform !== 'darwin' && app.quit());
app.on('activate', () => BrowserWindow.getAllWindows().length === 0 && createWindow());
app.on('before-quit', () => {
  scheduleIntervals.forEach(id => clearInterval(id));
  if (db) db.close();
});