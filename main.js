const { app, BrowserWindow, ipcMain, Tray, Menu, dialog } = require('electron');
const { autoUpdater } = require('electron-updater');
const path = require('path');
const fs = require('fs');

let win;
let tray;
let pollingIntervals = {};
let botOffsets = {};
let db;

// Инициализация БД
function initDatabase() {
  const Database = require('better-sqlite3');
  const userDataPath = app.getPath('userData');
  const dbPath = path.join(userDataPath, 'hubpro.db');
  
  db = new Database(dbPath);
  
  // Создание таблиц
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
    
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT
    );
  `);
  
  console.log('Database initialized at:', dbPath);
  return db;
}

// Настройка автообновления
autoUpdater.autoDownload = true;
autoUpdater.autoInstallOnAppQuit = true;
autoUpdater.logger = null;

app.whenReady().then(async () => {
  db = initDatabase();
  createWindow();
  await createTray();
  setupAutoUpdater();
  
  // Обработчики IPC
  ipcMain.handle('db:getBots', () => {
    return db.prepare('SELECT * FROM bots ORDER BY id').all();
  });
  
  ipcMain.handle('db:addBot', (_, { name, token }) => {
    try {
      const stmt = db.prepare('INSERT INTO bots (name, token, online) VALUES (?, ?, 0)');
      const result = stmt.run(name, token);
      return { success: true, id: result.lastInsertRowid };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });
  
  ipcMain.handle('db:updateBot', (_, { id, name, token, online }) => {
    try {
      db.prepare('UPDATE bots SET name = ?, token = ?, online = ? WHERE id = ?').run(name, token, online ? 1 : 0, id);
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
  
  ipcMain.handle('db:getStats', () => {
    const botCount = db.prepare('SELECT COUNT(*) as count FROM bots').get().count;
    const groupCount = db.prepare('SELECT COUNT(*) as count FROM groups').get().count;
    const messageCount = db.prepare('SELECT COUNT(*) as count FROM messages').get().count;
    return { botCount, groupCount, messageCount };
  });
  
  // Синхронизация polling при изменении конфигурации
  ipcMain.on('tg:sync-config', async () => {
    const bots = db.prepare('SELECT * FROM bots WHERE online = 1').all();
    const groups = db.prepare('SELECT * FROM groups').all();
    syncPolling(bots, groups);
  });
  
  // Запускаем polling для онлайн ботов
  const bots = db.prepare('SELECT * FROM bots WHERE online = 1').all();
  const groups = db.prepare('SELECT * FROM groups').all();
  syncPolling(bots, groups);
});

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

// Отправка сообщений
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

// Проверка бота
ipcMain.handle('tg:checkBot', async (_, token) => {
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/getMe`);
    return await res.json();
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

// Polling входящих сообщений
function syncPolling(bots, groups) {
  Object.values(pollingIntervals).forEach(clearInterval);
  pollingIntervals = {};
  botOffsets = {};

  bots.forEach(bot => {
    botOffsets[bot.id] = 0;
    pollingIntervals[bot.id] = setInterval(async () => {
      try {
        const res = await fetch(`https://api.telegram.org/bot${bot.token}/getUpdates?offset=${botOffsets[bot.id]}&timeout=10`);
        const data = await res.json();
        if (data.ok && data.result) {
          data.result.forEach(update => {
            botOffsets[bot.id] = update.update_id + 1;
            if (update.message && update.message.chat && update.message.text) {
              const chatId = update.message.chat.id.toString();
              const group = groups.find(g => g.bot_id === bot.id && g.chat_id === chatId);
              if (group) {
                // Сохраняем в БД
                db.prepare('INSERT INTO messages (group_id, text, sent, sender) VALUES (?, ?, 0, ?)').run(
                  group.id, update.message.text, update.message.from.first_name || update.message.from.username
                );
                // Отправляем в UI
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

// Автообновление
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

app.on('window-all-closed', () => process.platform !== 'darwin' && app.quit());
app.on('activate', () => BrowserWindow.getAllWindows().length === 0 && createWindow());
app.on('before-quit', () => {
  if (db) db.close();
});