const express = require('express');
const bodyParser = require('body-parser');
const path = require('path');
const fs = require('fs');
const { Telegraf } = require('telegraf');
const cron = require('node-cron');
const http = require('http');

const CONFIG = {
    port: 3000,
    adminLogin: 'admin',
    adminPassword: '901Admin',
    dbPath: './database',
    excelPath: './excel'
};

const app = express();
app.use(bodyParser.json());

// Serve static files
app.use(express.static('renderer', { index: false }));

// Root redirects to login
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'renderer', 'login.html'));
});

app.get('/login', (req, res) => {
    res.sendFile(path.join(__dirname, 'renderer', 'login.html'));
});

let bots = {};
let schedules = [];
let settings = {};

function initDB() {
    if (!fs.existsSyncSync(CONFIG.dbPath)) fs.mkdirSync(CONFIG.dbPath, { recursive: true });
    if (!fs.existsSyncSync(CONFIG.excelPath)) fs.mkdirSync(CONFIG.excelPath, { recursive: true });
    ['kbots', 'groups', 'schedules', 'users', 'messages', 'settings'].forEach(table => {
        const file = path.join(CONFIG.dbPath, table + '.json');
        if (!fs.existsSyncSync(file)) fs.writeFileSync(file, table === 'kbots' ? '{}' : '[]');
    });
}

function loadData() {
    try {
        bots = JSON.parse(fs.readFileSync(path.join(CONFIG.dbPath, 'kbots.json'), 'utf8') || '{}');
        schedules = JSON.parse(fs.readFileSync(path.join(CONFIG.dbPath, 'schedules.json'), 'utf8') || '[]');
        settings = JSON.parse(fs.readFileSync(path.join(CONFIG.dbPath, 'settings.json'), 'utf8') || '{}');
    } catch (e) { console.error('Error loading data:', e.message); }
}

function saveData() {
    try {
        fs.writeFileSync(path.join(CONFIG.dbPath, 'kbots.json'), JSON.stringify(bots, null, 2));
        fs.writeFileSync(path.join(CONFIG.dbPath, 'schedules.json'), JSON.stringify(schedules, null, 2));
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
                const msgs = JSON.parse(fs.readFileSync(path.join(CONFIG.dbPath, 'messages.json'), 'utf8') || '[]');
                msgs.push({ id: Date.now(), botToken: token, chatId: msg.chat.id, chatTitle: msg.chat.title || 'Private', text: msg.text, date: new Date().toISOString() });
                fs.writeFileSync(path.join(CONFIG.dbPath, 'messages.json'), JSON.stringify(msgs, null, 2));
            }
        });
        bot.launch().then(() => console.log(`Bot started: ${token.substring(0,10)}...`)).catch(e => console.error('Bot error:', e.message));
    } catch (e) { console.error('Start bot error:', e.message); }
}

// API Routes
app.post('/api/login', (req, res) => {
    const { login, password } = req.body;
    console.log(`[LOGIN] Attempt: ${login}`);

    if (!login || !password) {
        return res.json({ success: false, error: 'Введите логин и пароль' });
    }

    if (login === CONFIG.adminLogin && password === CONFIG.adminPassword) {
        console.log('[LOGIN] SUCCESS');
        res.json({ success: true, user: { login: CONFIG.adminLogin, role: 'admin' } });
    } else {
        console.log('[LOGIN] FAILED: Wrong credentials');
        res.json({ success: false, error: 'Неверный логин или пароль' });
    }
});

app.get('/api/check-server', (req, res) => {
    res.json({ status: 'ok', port: CONFIG.port, time: new Date().toISOString() });
});

app.get('/api/bots', (req, res) => res.json(bots));
app.post('/api/bots', (req, res) => {
    const { name, token } = req.body;
    if (!name || !token) return res.json({ success: false, error: 'Укажите имя и токен' });
    bots[token] = { id: Date.now(), name, token, active: true };
    saveData();
    startBot(token);
    res.json({ success: true });
});
app.delete('/api/bots/:token', (req, res) => {
    if (bots[req.params.token]) bots[req.params.token].stop();
    delete bots[req.params.token];
    saveData();
    res.json({ success: true });
});

app.get('/api/groups', (req, res) => {
    res.json(JSON.parse(fs.readFileSync(path.join(CONFIG.dbPath, 'groups.json'), 'utf8') || '[]'));
});
app.post('/api/groups', (req, res) => {
    const groups = JSON.parse(fs.readFileSync(path.join(CONFIG.dbPath, 'groups.json'), 'utf8') || '[]');
    groups.push({ id: Date.now(), ...req.body });
    fs.writeFileSync(path.join(CONFIG.dbPath, 'groups.json'), JSON.stringify(groups, null, 2));
    res.json({ success: true });
});

app.get('/api/schedules', (req, res) => res.json(schedules));
app.post('/api/schedules', (req, res) => {
    schedules.push({ id: Date.now(), ...req.body, active: true });
    saveData();
    res.json({ success: true });
});

app.get('/api/messages', (req, res) => {
    res.json(JSON.parse(fs.readFileSync(path.join(CONFIG.dbPath, 'messages.json'), 'utf8') || '[]'));
});

app.get('/api/stats', (req, res) => {
    const messages = JSON.parse(fs.readFileSync(path.join(CONFIG.dbPath, 'messages.json'), 'utf8') || '[]');
    const groups = JSON.parse(fs.readFileSync(path.join(CONFIG.dbPath, 'groups.json'), 'utf8') || '[]');
    res.json({ totalMessages: messages.length, totalGroups: groups.length, activeBots: Object.keys(bots).length, activeSchedules: schedules.filter(s => s.active).length });
});

async function start() {
    initDB();
    loadData();

    // Try to start server, handle port in use
    const server = http.createServer(app);

    server.on('error', (err) => {
        if (err.code === 'EADDRINUSE') {
            console.log(`\n⚠️ Порт ${CONFIG.port} занят!`);
            console.log('Попробую порт 3001...');
            CONFIG.port = 3001;
        } else {
            console.error('Server error:', err);
        }
    });

    server.listen(CONFIG.port, () => {
        console.log('\n✅ HubPro Server Started');
        console.log(`   URL: http://localhost:${CONFIG.port}`);
        console.log(`   Login: ${CONFIG.adminLogin} / ${CONFIG.adminPassword}`);

        Object.keys(bots).forEach(t => bots[t].active && startBot(t));

        schedules.forEach(s => {
            if (s.active && cron.validate(s.cronExpr)) {
                cron.schedule(s.cronExpr, async () => {
                    if (bots[s.botToken]) try { await bots[s.botToken].telegram.sendMessage(s.groupId, s.message); } catch(e) {}
                });
            }
        });

        console.log('\n🚀 Ready to use!');
    });
}

start();
