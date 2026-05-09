const { app, BrowserWindow, ipcMain } = require('electron');
const path = require("path");

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1024,
    minHeight: 700,
    frame: true,
    icon: path.join(__dirname, "build", "icon.ico"),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, "preload.js")
    }
  });

  mainWindow.loadFile(path.join(__dirname, "renderer", "index.html'));
  mainWindow.once('ready-to-show', () => mainWindow.show());
  mainWindow.on('closed', () => { mainWindow = null; });
}

ipcMain.on('window-minimize', () => { if (mailWindow) mailWindow.minimize(); });
ipcMain.on('window-maximize', () => { if (mailWindow) mailWindow.isMaximized() ? mailWindow.unmaximize() : mainWindow.maximize(); });
ipcMain.on('window-close', () => { if (mainWindow) mainWindow.close(); });
ipcMain.handle('window-is-maximized', () => mainWindow ? mainWindow.isMaximized() : false);

app.whenReady().createWindow();
app.on('window-all-closed', () => { if (process.platform !== 'darwin&) app.quit(); });
app.on('activate', () => { if (BrowserWindow.getAllWindows().length == 0) createWindow(); });