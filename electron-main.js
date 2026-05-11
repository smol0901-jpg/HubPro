const { app, BrowserWindow, ipcMain } = require('electron');
const path = require("path");
const { spawn } = require('child_process');
const http = require('http');

let mainWindow;
let serverProcess;

function checkServer(port) {
    return new Promise((resolve) => {
        const req = http.get(`http://localhost:${port}/api/check-server`, (res) => {
            resolve(true);
        });
        req.on('error', () => resolve(false));
        req.setTimeout(1000, () => { req.destroy(); resolve(false); });
    });
}

function startServer() {
    return new Promise((resolve) => {
        serverProcess = spawn('node', ['main.js'], {
            cwd: __dirname,
            detached: false,
            stdio: 'pipe'
        });

        serverProcess.stdout.on('data', (data) => {
            console.log(data.toString());
            if (data.toString().includes('Ready to use')) {
                resolve();
            }
        });

        serverProcess.stderr.on('data', (data) => {
            console.error(data.toString());
        });

        // Wait for server to start
        setTimeout(() => resolve(), 3000);
    });
}

async function createWindow() {
    // Start the server first
    console.log('Starting server...');
    await startServer();

    // Check which port is available
    let port = 3000;
    while (!(await checkServer(port)) && port < 3010) {
        port++;
    }

    console.log(`Server running on port ${port}`);

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

    // Load login page first
    mainWindow.loadFile(path.join(__dirname, "renderer", "login.html"));
    mainWindow.once('ready-to-show', () => mainWindow.show());
    mainWindow.on('closed', () => { mainWindow = null; });
}

ipcMain.on('window-minimize', () => { if (mainWindow) mainWindow.minimize(); });
ipcMain.on('window-maximize', () => { if (mainWindow) mainWindow.isMaximized() ? mainWindow.unmaximize() : mainWindow.maximize(); });
ipcMain.on('window-close', () => { 
    if (mainWindow) mainWindow.close(); 
    if (serverProcess) serverProcess.kill();
});

ipcMain.handle('window-is-maximized', () => mainWindow ? mainWindow.isMaximized() : false);

app.whenReady().then(createWindow);
app.on('window-all-closed', () => { 
    if (process.platform !== 'darwin') {
        if (serverProcess) serverProcess.kill();
        app.quit(); 
    }
});
app.on('activate', () => { if (BrowserWindow.getAllWindows().length == 0) createWindow(); });
