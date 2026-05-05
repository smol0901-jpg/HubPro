const express = require('express');
const bodyParser = require('body-parser');
const path = require('path');
const fs = require('fs');
const https = require('https');
const http = require('http');
const crypto = require('crypto');
const { Telegraf, Scenes, session, Markup } = require('telegraf');
const cron = require('node-cron');
const { exec } = require('child_process');
const ExcelJS = require('exceljs');
const WebSocket = require('ws');
const axios = require('axios');

// ==================== КОНФИГУРАЦИЯ ====================
const CONFIG = {
    port: 3000,
    webPort: 8080,
    encryptionKey: 'HubPro2026SecretKey!',
    adminLogin: 'admin',
    adminPassword: '901Admin',
    dbPath: './database',
    excelPath: './excel'
};

// ==================== ШИФРОВАНИЕ ====================
function encrypt(text) {
    const iv = crypto.randomBytes(16);
    const key = crypto.scryptSync(CONFIG.encryptionKey, 'salt', 32);
    const cipher = crypto.createCipheriv('aes-256-cbc', key, iv);
    let encrypted = cipher.update(text, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    return iv.toString('hex') + ':' + encrypted;
}

function decrypt(text) {
    try {
        const parts = text.split(':');
        const iv = Buffer.from(parts[0], 'hex');
        const encrypted = parts[1];
        const key = crypto.scryptSync(CONFIG.encryptionKey, 'salt', 32);
        const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv);
        let decrypted = decipher.update(encrypted, 'hex', 'utf8');
        decrypted += decipher.final('utf8');
        return decrypted;
    } catch (e) {
        return text;
    }
}

// ==================== БД ====================
function initDB() {
    if (!fs.existsSync(CONFIG.dbPath)) fs.mkdirSync(CONFIG.dbPath, { recursive: true });
    if (!fs.existsSync(CONFIG.excelPath)) fs.mkdirSync(CONFIG.excelPath, { recursive: true });
    
    const tables = ['bots', 'groups', 'schedules', 'templates', 'users', 'messages', 'notifications', 'ai_tasks', 'error_logs', 'settings'];
    tables.forEach(table => {
        const file = path.join(CONFIG.dbPath, table + '.json');
        if (!fs.existsSync(file)) fs.writeFileSync(file, '[]');
    });
}


function db(table) {
    const file = path.join(CONFIG.dbPath, table + '.json');
    try {
        return JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch (e) {
        return [];
    }
}

function dbSave(table, data) {
    const file = path.join(CONFIG.dbPath, table + '.json');
    fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

// ==================== EXCEL ====================
async function loadExcel(table) {
    const file = path.join(CONFIG.excelPath, table + '.xlsx');
    if (!fs.existsSync(file)) return [];
    
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(file);
    const ws = workbook.getWorksheet(1);
    const data = [];
    
    ws.eachRow((row, rowNum) => {
        if (rowNum > 1) {
            const obj = {};
            row.eachCell((cell, colNum) => {
                const header = ws.getRow(1).getCell(colNum).value;
                obj[header] = cell.value;
            });
            data.push(obj);
        }
    });
    return data;
}

async function saveExcel(table, data) {
    const file = path.join(CONFIG.excelPath, table + '.xlsx');
    const workbook = new ExcelJS.Workbook();
    const ws = workbook.addWorksheet(table);
    
    if (data.length > 0) {
        const headers = Object.keys(data[0]);
        ws.addRow(headers);
        
        data.forEach(row => {
            ws.addRow(headers.map(h => row[h]));
        });
    }
    
    await workbook.xlsx.writeFile(file);
}

// ==================== API ====================
const app = express();
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, 'renderer')));


// Auth middleware
function auth(req, res, next) {
    const token = req.headers.authorization;
    if (!token) return res.status(401).json({ error: 'Нет токена' });
    
    try {
        const user = JSON.parse(Buffer.from(token, 'base64').toString());
        req.user = user;
        next();
    } catch (e) {
        res.status(401).json({ error: 'Неверный токен' });
    }
}

// Login
app.post('/api/login', async (req, res) => {
    const { login, password } = req.body;
    const users = await loadExcel('users');
    const user = users.find(u => u.login === login && u.password === password);
    
    if (user) {
        const token = Buffer.from(JSON.stringify(user)).toString('base64');
        res.json({ success: true, user, token });
    } else {
        res.json({ success: false, error: 'Неверный логин или пароль' });
    }
});

// Get Data
app.get('/api/getData', auth, async (req, res) => {
    const [bots, groups, schedules, templates, users, messages, notifications, ai_tasks, error_logs, settings] = await Promise.all([
        loadExcel('bots'), loadExcel('groups'), loadExcel('schedules'), 
        loadExcel('templates'), loadExcel('users'), loadExcel('messages'),
        loadExcel('notifications'), loadExcel('ai_tasks'), loadExcel('error_logs'), loadExcel('settings')
    ]);
    
    res.json({
        bots, groups, schedules, templates, users, messages, notifications, ai_tasks, error_logs, settings,
        stats: {
            botCount: bots.length,
            activeBots: bots.filter(b => b.status === 'active').length,
            groupCount: groups.length,
            activeGroups: groups.filter(g => g.status === 'active').length,
            messageCount: messages.length,
            messagesToday: messages.filter(m => new Date(m.time).toDateString() === new Date().toDateString()).length,
            userCount: users.length,
            activeUsers: users.filter(u => u.status === 'active').length,
            scheduleCount: schedules.length,
            activeSchedules: schedules.filter(s => s.status === 'active').length,
            aiTasksPending: ai_tasks.filter(t => t.status === 'pending').length,
            aiTasksActive: ai_tasks.filter(t => t.status === 'active').length
        }
    });
});

// Bots
app.post('/api/bots:add', auth, async (req, res) => {
    const bots = await loadExcel('bots');
    const newBot = { id: Date.now(), ...req.body, status: 'active', created_at: new Date().toISOString() };
    bots.push(newBot);
    await saveExcel('bots', bots);
    res.json({ success: true });
});

app.post('/api/bots:delete', auth, async (req, res) => {
    const bots = await loadExcel('bots');
    const filtered = bots.filter(b => b.id != req.query.id);
    await saveExcel('bots', filtered);
    res.json({ success: true });
});

// Groups
app.post('/api/groups:add', auth, async (req, res) => {
    const groups = await loadExcel('groups');
    const bots = await loadExcel('bots');
    const bot = bots.find(b => b.id == req.body.bot_id);
    const newGroup = { 
        id: Date.now(), 
        ...req.body, 
        bot_name: bot?.name || '',
        status: 'active', 
        created_at: new Date().toISOString() 
    };
    groups.push(newGroup);
    await saveExcel('groups', groups);
    syncPolling();
    res.json({ success: true });
});

app.post('/api/groups:delete', auth, async (req, res) => {
    const groups = await loadExcel('groups');
    const filtered = groups.filter(g => g.id != req.query.id);
    await saveExcel('groups', filtered);
    res.json({ success: true });
});

// Messages
app.post('/api/filterMessages', auth, async (req, res) => {
    const { filter, groupId } = req.body;
    let messages = await loadExcel('messages');
    messages = messages.filter(m => m.group_id == groupId);
    
    if (filter?.search) {
        const s = filter.search.toLowerCase();
        messages = messages.filter(m => m.text?.toLowerCase().includes(s));
    }
    
    if (filter?.period === 'today') {
        messages = messages.filter(m => new Date(m.time).toDateString() === new Date().toDateString());
    } else if (filter?.period === 'week') {
        const weekAgo = new Date();
        weekAgo.setDate(weekAgo.getDate() - 7);
        messages = messages.filter(m => new Date(m.time) >= weekAgo);
    } else if (filter?.period === 'month') {
        const monthAgo = new Date();
        monthAgo.setMonth(monthAgo.getMonth() - 1);
        messages = messages.filter(m => new Date(m.time) >= monthAgo);
    }
    
    messages.sort((a, b) => new Date(b.time) - new Date(a.time));
    res.json(messages);
});

app.post('/api/sendMessage', auth, async (req, res) => {
    const { groupId, text, sender } = req.body;
    const groups = await loadExcel('groups');
    const bots = await loadExcel('bots');
    const group = groups.find(g => g.id == groupId);
    const bot = bots.find(b => b.id == group.bot_id);
    
    if (!group || !bot) return res.json({ success: false, error: 'Группа или бот не найдены' });
    
    try {
        const telegraf = new Telegraf(decrypt(bot.token));
        await telegraf.telegram.sendMessage(group.chat_id, text);
        
        const messages = await loadExcel('messages');
        messages.push({
            id: Date.now(),
            group_id: groupId,
            text,
            sender,
            sent: true,
            time: new Date().toISOString()
        });
        await saveExcel('messages', messages);
        
        res.json({ success: true });
    } catch (e) {
        logError('ERR_API_TELEGRAM', e.message, 'Telegram');
        res.json({ success: false, error: e.message });
    }
});

// Schedules
app.post('/api/schedules:add', auth, async (req, res) => {
    const schedules = await loadExcel('schedules');
    const groups = await loadExcel('groups');
    const bots = await loadExcel('bots');
    const group = groups.find(g => g.id == req.body.group_id);
    const bot = bots.find(b => b.id == req.body.bot_id);
    
    const newSchedule = {
        id: Date.now(),
        ...req.body,
        group_name: group?.name || '',
        bot_name: bot?.name || '',
        status: 'active',
        last_run: null,
        created_at: new Date().toISOString()
    };
    schedules.push(newSchedule);
    await saveExcel('schedules', schedules);
    setupSchedule(newSchedule);
    res.json({ success: true });
});

app.post('/api/schedules:execute', auth, async (req, res) => {
    const schedules = await loadExcel('schedules');
    const schedule = schedules.find(s => s.id == req.query.id);
    
    if (schedule) {
        await executeSchedule(schedule);
        res.json({ success: true });
    } else {
        res.json({ success: false });
    }
});

app.post('/api/schedules:delete', auth, async (req, res) => {
    const schedules = await loadExcel('schedules');
    const filtered = schedules.filter(s => s.id != req.query.id);
    await saveExcel('schedules', filtered);
    res.json({ success: true });
});

// Templates
app.post('/api/templates:add', auth, async (req, res) => {
    const templates = await loadExcel('templates');
    templates.push({ id: Date.now(), ...req.body, created_at: new Date().toISOString() });
    await saveExcel('templates', templates);
    res.json({ success: true });
});

app.post('/api/templates:delete', auth, async (req, res) => {
    const templates = await loadExcel('templates');
    const filtered = templates.filter(t => t.id != req.query.id);
    await saveExcel('templates', filtered);
    res.json({ success: true });
});


// Users
app.post('/api/users:add', auth, async (req, res) => {
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'Нет прав' });
    
    const users = await loadExcel('users');
    users.push({ id: Date.now(), ...req.body, status: 'active', created_at: new Date().toISOString() });
    await saveExcel('users', users);
    res.json({ success: true });
});

app.post('/api/users:delete', auth, async (req, res) => {
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'Нет прав' });
    
    const users = await loadExcel('users');
    const filtered = users.filter(u => u.id != req.query.id);
    await saveExcel('users', filtered);
    res.json({ success: true });
});

// Notifications
app.get('/api/getNotifications', auth, async (req, res) => {
    const notifications = await loadExcel('notifications');
    res.json(notifications.sort((a, b) => new Date(b.time) - new Date(a.time)));
});

// AI Settings
app.get('/api/getAISettings', auth, async (req, res) => {
    const settings = await loadExcel('settings');
    const aiSettings = settings.find(s => s.key === 'ai');
    res.json(aiSettings?.value || { enabled: false, autoExecute: false, allowedCommands: [], restrictedCommands: [], maxTasksPerHour: 10 });
});

app.post('/api/saveAISettings', auth, async (req, res) => {
    const settings = await loadExcel('settings');
    const idx = settings.findIndex(s => s.key === 'ai');
    const newSetting = { key: 'ai', value: req.body, updated_at: new Date().toISOString() };
    
    if (idx >= 0) settings[idx] = newSetting;
    else settings.push(newSetting);
    
    await saveExcel('settings', settings);
    res.json({ success: true });
});

// AI Tasks
app.get('/api/getAITasks', auth, async (req, res) => {
    const tasks = await loadExcel('ai_tasks');
    res.json(tasks);
});

app.post('/api/addAITask', auth, async (req, res) => {
    const tasks = await loadExcel('ai_tasks');
    tasks.push({ id: Date.now(), ...req.body, status: 'pending', created_at: new Date().toISOString() });
    await saveExcel('ai_tasks', tasks);
    res.json({ success: true });
});

app.post('/api/executeAITask', auth, async (req, res) => {
    const tasks = await loadExcel('ai_tasks');
    const task = tasks.find(t => t.id == req.body.id);
    
    if (task) {
        task.status = 'active';
        task.started_at = new Date().toISOString();
        await saveExcel('ai_tasks', tasks);
        
        // Execute task
        setTimeout(async () => {
            task.status = 'completed';
            task.completed_at = new Date().toISOString();
            await saveExcel('ai_tasks', tasks);
        }, 5000);
        
        res.json({ success: true });
    } else {
        res.json({ success: false });
    }
});

app.post('/api/deleteAITask', auth, async (req, res) => {
    const tasks = await loadExcel('ai_tasks');
    const filtered = tasks.filter(t => t.id != req.body.id);
    await saveExcel('ai_tasks', filtered);
    res.json({ success: true });
});


// Neural Network
app.post('/api/neuralSend', auth, async (req, res) => {
    const settings = await loadExcel('settings');
    const neuralSettings = settings.find(s => s.key === 'neural');
    const apiKey = neuralSettings?.value?.apiKey;
    const model = neuralSettings?.value?.model || 'gpt-3.5-turbo';
    
    if (!apiKey) return res.json({ success: false, error: 'API ключ не настроен' });
    
    try {
        const response = await axios.post('https://api.openai.com/v1/chat/completions', {
            model,
            messages: [
                { role: 'system', content: neuralSettings?.value?.systemPrompt || 'Ты помощник по управлению Telegram ботами' },
                { role: 'user', content: req.body.message }
            ]
        }, {
            headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' }
        });
        
        res.json({ success: true, response: response.data.choices[0].message.content });
    } catch (e) {
        logError('ERR_AI_TASK', e.message, 'Neural');
        res.json({ success: false, error: e.message });
    }
});

app.post('/api/neuralSetApiKey', auth, async (req, res) => {
    const settings = await loadExcel('settings');
    const idx = settings.findIndex(s => s.key === 'neural');
    const current = settings.find(s => s.key === 'neural')?.value || {};
    
    const newSetting = { key: 'neural', value: { ...current, apiKey: req.body.apiKey }, updated_at: new Date().toISOString() };
    
    if (idx >= 0) settings[idx] = newSetting;
    else settings.push(newSetting);
    
    await saveExcel('settings', settings);
    res.json({ success: true });
});

app.post('/api/neuralSetModel', auth, async (req, res) => {
    const settings = await loadExcel('settings');
    const idx = settings.findIndex(s => s.key === 'neural');
    const current = settings.find(s => s.key === 'neural')?.value || {};
    
    const newSetting = { key: 'neural', value: { ...current, model: req.body.model }, updated_at: new Date().toISOString() };
    
    if (idx >= 0) settings[idx] = newSetting;
    else settings.push(newSetting);
    
    await saveExcel('settings', settings);
    res.json({ success: true });
});

app.post('/api/neuralSetSystemPrompt', auth, async (req, res) => {
    const settings = await loadExcel('settings');
    const idx = settings.findIndex(s => s.key === 'neural');
    const current = settings.find(s => s.key === 'neural')?.value || {};
    
    const newSetting = { key: 'neural', value: { ...current, systemPrompt: req.body.prompt }, updated_at: new Date().toISOString() };
    
    if (idx >= 0) settings[idx] = newSetting;
    else settings.push(newSetting);
    
    await saveExcel('settings', settings);
    res.json({ success: true });
});

app.post('/api/neuralClearHistory', auth, async (req, res) => {
    res.json({ success: true });
});

// Error Logs
app.get('/api/getErrorLogs', auth, async (req, res) => {
    let logs = await loadExcel('error_logs');
    
    const { search, source, severity, resolved } = req.body || {};
    
    if (search) {
        const s = search.toLowerCase();
        logs = logs.filter(l => l.message?.toLowerCase().includes(s));
    }
    if (source) logs = logs.filter(l => l.source === source);
    if (severity) logs = logs.filter(l => l.severity === severity);
    if (resolved !== undefined) logs = logs.filter(l => l.resolved === !!resolved);
    
    res.json(logs.sort((a, b) => new Date(b.created_at) - new Date(a.created_at)));
});

app.post('/api/resolveError', auth, async (req, res) => {
    const logs = await loadExcel('error_logs');
    const log = logs.find(l => l.id == req.body.id);
    
    if (log) {
        log.resolved = true;
        log.resolved_by = req.body.userId;
        log.resolved_at = new Date().toISOString();
        await saveExcel('error_logs', logs);
    }
    
    res.json({ success: true });
});

app.get('/api/exportExcel', auth, async (req, res) => {
    const type = req.query.type;
    const logs = await loadExcel('error_logs');
    
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename=${type}_${Date.now()}.xlsx`);
    
    const workbook = new ExcelJS.Workbook();
    const ws = workbook.addWorksheet(type);
    
    if (logs.length > 0) {
        ws.addRow(Object.keys(logs[0]));
        logs.forEach(row => ws.addRow(Object.values(row)));
    }
    
    await workbook.xlsx.write(res);
});

// Web Settings
app.get('/api/getWebSettings', auth, async (req, res) => {
    const settings = await loadExcel('settings');
    const webSettings = settings.find(s => s.key === 'web');
    res.json(webSettings?.value || { enabled: true, port: CONFIG.webPort, ip: '127.0.0.1' });
});

app.post('/api/setWebSettings', auth, async (req, res) => {
    const settings = await loadExcel('settings');
    const idx = settings.findIndex(s => s.key === 'web');
    const newSetting = { key: 'web', value: req.body, updated_at: new Date().toISOString() };
    
    if (idx >= 0) settings[idx] = newSetting;
    else settings.push(newSetting);
    
    await saveExcel('settings', settings);
    res.json({ success: true });
});

// ==================== ЛОГИРОВАНИЕ ОШИБОК ====================
async function logError(code, message, source, details = null) {
    const logs = await loadExcel('error_logs');
    logs.push({
        id: Date.now(),
        error_code: code,
        message,
        source,
        details,
        severity: code.startsWith('ERR_') ? 'error' : 'warning',
        resolved: false,
        created_at: new Date().toISOString()
    });
    await saveExcel('error_logs', logs);
}

// ==================== TELEGRAM POLLING ====================
const bots = {};
const pollingIntervals = {};

function syncPolling() {
    loadExcel('groups').then(groups => {
        groups.forEach(group => {
            if (group.bot_id && !pollingIntervals[group.id]) {
                loadExcel('bots').then(botsList => {
                    const bot = botsList.find(b => b.id == group.bot_id);
                    if (bot) {
                        startPolling(bot, group);
                    }
                });
            }
        });
    });
}

function startPolling(bot, group) {
    try {
        const telegraf = new Telegraf(decrypt(bot.token));
        
        telegraf.on('message', async (ctx) => {
            const messages = await loadExcel('messages');
            messages.push({
                id: Date.now(),
                group_id: group.id,
                text: ctx.message.text || ctx.message.caption || '[Медиа]',
                sender: ctx.from.first_name || ctx.from.username || 'Unknown',
                sent: false,
                time: new Date().toISOString()
            });
            await saveExcel('messages', messages);
        });
        
        telegraf.launch();
        bots[group.id] = telegraf;
        pollingIntervals[group.id] = true;
    } catch (e) {
        logError('ERR_BOT_TOKEN', e.message, 'Telegram', `Group: ${group.id}`);
    }
}

// ==================== РАСПИСАНИЯ ====================
const scheduleJobs = {};

function setupSchedule(schedule) {
    if (scheduleJobs[schedule.id]) {
        scheduleJobs[schedule.id].stop();
    }
    
    if (schedule.status === 'active' && cron.validate(schedule.cron)) {
        const job = cron.schedule(schedule.cron, async () => {
            await executeSchedule(schedule);
        });
        scheduleJobs[schedule.id] = job;
    }
}

async function executeSchedule(schedule) {
    const groups = await loadExcel('groups');
    const bots = await loadExcel('bots');
    const group = groups.find(g => g.id == schedule.group_id);
    const bot = bots.find(b => b.id == schedule.bot_id);
    
    if (!group || !bot) {
        logError('ERR_SCHEDULE', 'Группа или бот не найдены', 'Schedule', `Schedule: ${schedule.id}`);
        return;
    }
    
    try {
        const telegraf = new Telegraf(decrypt(bot.token));
        await telegraf.telegram.sendMessage(group.chat_id, schedule.text);
        
        const schedules = await loadExcel('schedules');
        const idx = schedules.findIndex(s => s.id == schedule.id);
        if (idx >= 0) {
            schedules[idx].last_run = new Date().toISOString();
            await saveExcel('schedules', schedules);
        }
    } catch (e) {
        logError('ERR_SCHEDULE', e.message, 'Schedule', `Schedule: ${schedule.id}`);
    }
}

// ==================== ЗАПУСК ====================
async function start() {
    initDB();
    
    // Create default admin if not exists
    const users = await loadExcel('users');
    if (users.length === 0) {
        await saveExcel('users', [{
            id: 1,
            login: CONFIG.adminLogin,
            password: CONFIG.adminPassword,
            role: 'admin',
            status: 'active',
            created_at: new Date().toISOString()
        }]);
    }
    
    // Setup schedules
    const schedules = await loadExcel('schedules');
    schedules.forEach(s => setupSchedule(s));
    
    // Start polling
    syncPolling();
    
    // Start web server
    app.listen(CONFIG.port, () => {
        console.log(`HubPro v2.3.2 запущен на http://localhost:${CONFIG.port}`);
    });
}

start().catch(console.error);