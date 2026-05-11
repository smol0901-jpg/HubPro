const express = require('express');
const bodyParser = require('body-parser');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { Telegraf } = require('telegraf');
const cron = require('node-cron');
const ExcelJS = require('exceljs');

const CONFIG = {
    port: 3000,
    webPort: 8080,
    encryptionKey: 'HubPro2026SecretKey',
    adminLogin: 'admin',
    adminPassword: '901Admin',
    dbPath: './database',
    excelPath: './excel'
};

const app = express();
app.use(bodyParser.json());
app.use(express.static('renderer'));

let bots = {};
let schedules = [];
let users = [];
let settings = {};

function initDB() {
    if (!fs.existsSyncSync(CONFIG.dbPath)) fs.mkdirSync(CONFIG.dbPath, { recursive: true });
    if (!fs.existsSyncSync(CONFIG.excelPath)) fs.mkdirSync(CONFIG.excelPath, { recursive: true });
    const tables = ['kbots', 'groups', 'schedules', 'templates', 'users', 'messages', 'notifications', 'ai_tasks', 'error_logs', 'settings'];
    tables.forEach(table => {
        const file = path.join(CONFIG.dbPath, table + '.json');
        if (!fs.existsSyncSync(file)) fs.writeFileSync(file, '[]');
    });
}

function loadData() {
    try {
        bots = JSON.parse(fs.readFileSync(path.join(CONFIG.dbPath, 'kbots.json'), 'utf8') || '{}');
        schedules = JSON.parse(fs.readFileSync(path.join(CONFIG.dbPath, 'schedules.json'), 'utf8') || '[]');
        users = JSON.parse(fs.readFileSync(path.join(CONFIG.dbPath, 'users.json'), 'utf8') || '[]');
        settings = JSON.parse(fs.readFileSync(path.join(CONFIG.dbPath, 'settings.json'), 'utf8') || '{}');
    } catch (e) { console.error('Error loading data:', e.message); }
}

function saveData() {
    try {
        fs.writeFileSync(path.join(CONFIG.dbPath, 'kbots.json'), JSON.stringify(bots, null, 2));
        fs.writeFileSync(path.join(CONFIG.dbPath, 'schedules.json'), JSON.stringify(schedules, null, 2));
        fs.writeFileSync(path.join(CONFIG.dbPath, 'users.json'), JSON.stringify(users, null, 2));
        fs.writeFileSync(path.join(CONFIG.dbPath, 'settings.json'), JSON.stringify(settings, null, 2));
    } catch (e) { console.error('Error saving data:', e.message); }
}

function startBot(token) {
    if (bots[token]) return;
    try {
        const bot = new Telegraf(token);
        bots[token] = bot;

        bot.on('message', async (ctx) => {
            const msg = ctx.message;
            if (msg.text) {
                const msgData = {
                    id: Date.now(),
                    botToken: token,
                    chatId: msg.chat.id,
                    chatTitle: msg.chat.title || msg.chat.username || 'Private',
                    text: msg.text,
                    date: new Date().toISOString()
                };
                const msgs = JSON.parse(fs.readFileSync(path.join(CONFIG.dbPath, 'messages.json'), 'utf8') || '[]');
                msgs.push(msgData);
                fs.writeFileSync(path.join(CONFIG.dbPath, 'messages.json'), JSON.stringify(msgs, null, 2));
            }
        });

        bot.launch().then(() => console.log(`Bot started: ${token.substring(0,10)}...`)).catch(e => console.error('Bot error:', e.message));
    } catch (e) { console.error('Start bot error:', e.message); }
}

// API Routes with proper error handling
app.post('/api/login', (req, res) => {
    const { login, password } = req.body;

    console.log(`[LOGIN] Attempt: ${login}`);

    if (!login || !password) {
        console.log('[LOGIN] ERROR: Empty login or password');
        return res.json({ success: false, error: 'Введите логин и пароль' });
    }

    if (login === CONFIG.adminLogin && password === CONFIG.adminPassword) {
        console.log('[LOGIN] SUCCESS: Admin logged in');
        res.json({ success: true, user: { login: CONFIG.adminLogin, role: 'admin' } });
    } else {
        console.log(`[LOGIN] FAILED: Wrong credentials for ${login}`);
        res.json({ success: false, error: 'Неверный логин или пароль' });
    }
});

app.get('/api/check-server', (req, res) => {
    res.json({ status: 'ok', time: new Date().toISOString() });
});

app.get('/api/bots', (req, res) => {
    res.json(bots);
});

app.post('/api/bots', (req, res) => {
    const { name, token } = req.body;
    if (!name || !token) {
        return res.json({ success: false, error: 'Укажите имя и токен бота' });
    }
    const bot = { id: Date.now(), name, token, active: true };
    bots[token] = bot;
    saveData();
    startBot(token);
    res.json({ success: true, bot });
});

app.delete('/api/bots/:token', (req, res) => {
    const { token } = req.params;
    if (bots[token] && bots[token].stop) {
        bots[token].stop();
    }
    delete bots[token];
    saveData();
    res.json({ success: true });
});

app.get('/api/groups', (req, res) => {
    const groups = JSON.parse(fs.readFileSync(path.join(CONFIG.dbPath, 'groups.json'), 'utf8') || '[]');
    res.json(groups);
});

app.post('/api/groups', (req, res) => {
    const { name, chatId, botToken } = req.body;
    const groups = JSON.parse(fs.readFileSync(path.join(CONFIG.dbPath, 'groups.json'), 'utf8') || '[]');
    groups.push({ id: Date.now(), name, chatId, botToken });
    fs.writeFileSync(path.join(CONFIG.dbPath, 'groups.json'), JSON.stringify(groups, null, 2));
    res.json({ success: true });
});

app.get('/api/schedules', (req, res) => {
    res.json(schedules);
});

app.post('/api/schedules', (req, res) => {
    const { name, cronExpr, message, groupId, botToken } = req.body;
    const schedule = { id: Date.now(), name, cronExpr, message, groupId, botToken, active: true };
    schedules.push(schedule);
    saveData();
    res.json({ success: true, schedule });
});

app.get('/api/messages', (req, res) => {
    const messages = JSON.parse(fs.readFileSync(path.join(CONFIG.dbPath, 'messages.json'), 'utf8') || '[]');
    res.json(messages);
});

app.get('/api/settings', (req, res) => {
    res.json(settings);
});

app.post('/api/settings', (req, res) => {
    settings = { ...settings, ...req.body };
    saveData();
    res.json({ success: true });
});

app.get('/api/stats', (req, res) => {
    const messages = JSON.parse(fs.readFileSync(path.join(CONFIG.dbPath, 'messages.json'), 'utf8') || '[]');
    const groups = JSON.parse(fs.readFileSync(path.join(CONFIG.dbPath, 'groups.json'), 'utf8') || '[]');
    res.json({
        totalMessages: messages.length,
        totalGroups: groups.length,
        activeBots: Object.keys(bots).length,
        activeSchedules: schedules.filter(s => s.active).length
    });
});

// Start server
async function start() {
    initDB();
    loadData();

    console.log('Database initialized');
    console.log(`Admin: ${CONFIG.adminLogin} / ${CONFIG.adminPassword}`);

    // Start bots
    Object.keys(bots).forEach(token => {
        if (bots[token].active) startBot(token);
    });

    // Start cron schedules
    schedules.forEach(schedule => {
        if (schedule.active && cron.validate(schedule.cronExpr)) {
            cron.schedule(schedule.cronExpr, async () => {
                if (bots[schedule.botToken]) {
                    try {
                        await bots[schedule.botToken].telegram.sendMessage(schedule.groupId, schedule.message);
                    } catch (e) { console.error('Schedule error:', e.message); }
                }
            });
        }
    });

    app.listen(CONFIG.port, () => {
        console.log(`\n✅ Server started on http://localhost:${CONFIG.port}`);
        console.log(`✅ Web interface: http://localhost:${CONFIG.port}`);
    });
}

start();
