const { app, BrowserWindow, ipcMain, Tray, Menu, nativeImage, dialog } = require('electron');
const { autoUpdater } = require('electron-updater');
const path = require('path');
const fs = require('fs');

let win;
let tray;
let pollingIntervals = {};
let botOffsets = {};

// 🔧 Настройка автообновления
autoUpdater.autoDownload = true;
autoUpdater.autoInstallOnAppQuit = true;
autoUpdater.logger = null;

app.whenReady().then(async () => {
  createWindow();
  await createTray();
  setupAutoUpdater();
  ipcMain.on('tg:sync-config', async (event, config) => {
    syncPolling(config.bots, config.groups);
  });
});

function createWindow() {
  win = new BrowserWindow({
    width: 1280,
    height: 850,
    title: 'BotHub',
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
    { label: 'Открыть BotHub', click: () => { win.show(); win.focus(); } },
    { type: 'separator' },
    { label: 'Закрыть полностью', click: () => { app.isQuitting = true; app.quit(); } }
  ]);
  tray.setToolTip('BotHub — Управление Telegram ботами');
  tray.setContextMenu(contextMenu);
  tray.on('double-click', () => { win.show(); win.focus(); });
}

// 📡 Отправка сообщений (реальный API)
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

// 📥 Входящие сообщения (getUpdates polling)
function syncPolling(bots, groups) {
  Object.values(pollingIntervals).forEach(clearInterval);
  pollingIntervals = {};
  botOffsets = {};

  const onlineBots = bots.filter(b => b.online);
  onlineBots.forEach(bot => {
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
              const group = groups.find(g => g.botId === bot.id && g.chatId === chatId);
              if (group) {
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

// 🔄 Автообновление
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