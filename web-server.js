const express = require('express');
const path = require('path');
const app = express();
const PORT = 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'renderer')));

let data = {
  users: [{ id: 1, login: 'NeuralAP', password: 'a665a45920422f9d417e4867efdc4fb8a04a1f3fff1fbe19b6f1a4a7c2e9c3e', role: 'admin', delete_request: 0 }],
  bots: [], groups: [], messages: [], schedules: [], schedule_logs: []
};

const VERSION = '1.2.0';
const UPDATE_INFO = [{ version: '1.2.0', date: '2026-04-15', changes: ['Экспорт/импорт', 'Topics', 'Веб-режим'] }];

function hashPassword(p) { return require('crypto').createHash('sha256').update(p).digest('hex'); }

app.get('/api/version', (req, res) => res.json({ version: VERSION, updates: UPDATE_INFO }));
app.post('/api/auth/login', (req, res) => { const { login, password } = req.body; const u = data.users.find(x => x.login === login); if (!u) return res.json({ success: false, error: 'Не найден' }); if (u.password !== hashPassword(password)) return res.json({ success: false, error: 'Неверный пароль' }); res.json({ success: true, user: { id: u.id, login: u.login, role: u.role } }); });
app.get('/api/bots', (req, res) => res.json(data.bots));
app.post('/api/bots', (req, res) => { const b = { id: Date.now(), ...req.body, online: 0 }; data.bots.push(b); res.json({ success: true, id: b.id }); });
app.delete('/api/bots/:id', (req, res) => { data.bots = data.bots.filter(b => b.id != req.params.id); res.json({ success: true }); });
app.get('/api/groups', (req, res) => res.json(data.groups.map(g => ({ ...g, bot_name: data.bots.find(b => b.id === g.bot_id)?.name }))));
app.post('/api/groups', (req, res) => { const g = { id: Date.now(), ...req.body }; data.groups.push(g); res.json({ success: true, id: g.id }); });
app.delete('/api/groups/:id', (req, res) => { data.groups = data.groups.filter(g => g.id != req.params.id); res.json({ success: true }); });
app.get('/api/messages/:groupId', (req, res) => res.json(data.messages.filter(m => m.group_id == req.params.groupId)));
app.post('/api/messages', (req, res) => { const m = { id: Date.now(), time: new Date().toISOString(), ...req.body }; data.messages.push(m); res.json({ success: true, id: m.id }); });
app.get('/api/schedules', (req, res) => res.json(data.schedules));
app.post('/api/schedules', (req, res) => { const s = { id: Date.now(), status: 'active', ...req.body }; data.schedules.push(s); res.json({ success: true, id: s.id }); });
app.delete('/api/schedules/:id', (req, res) => { data.schedules = data.schedules.filter(s => s.id != req.params.id); res.json({ success: true }); });
app.get('/api/stats', (req, res) => res.json({ botCount: data.bots.length, groupCount: data.groups.length, messageCount: data.messages.length, scheduleCount: data.schedules.length, userCount: data.users.length, deleteRequests: 0 }));
app.post('/api/telegram/send', async (req, res) => { const { token, chatId, text, topicIds } = req.body; try { if (topicIds) for (const t of topicIds) await fetch(`https://api.telegram.org/bot${token}/sendMessage`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ chat_id: chatId, text, message_thread_id: t }) }); else await fetch(`https://api.telegram.org/bot${token}/sendMessage`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ chat_id: chatId, text }) }); res.json({ ok: true }); } catch(e) { res.json({ ok: false, description: e.message }); } });
app.post('/api/telegram/check', async (req, res) => { try { res.json(await (await fetch(`https://api.telegram.org/bot${req.body.token}/getMe`)).json()); } catch(e) { res.json({ ok: false, error: e.message }); } });
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'renderer', 'index.html')));

app.listen(PORT, () => console.log(`HubPro Web: http://localhost:${PORT}`));