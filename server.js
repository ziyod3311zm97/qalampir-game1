const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const TelegramBot = require('node-telegram-bot-api');
const { Pool } = require('pg');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const PORT = process.env.PORT || 3000;
const BOT_TOKEN = process.env.BOT_TOKEN || '8809424395:AAFRdNm6HG168dtZzRDfrmqqM4fm1fsq708';
const APP_URL = process.env.APP_URL || 'https://qalampir-top.onrender.com';
const ADMIN_TELEGRAM_ID = 867914430;

const bot = new TelegramBot(BOT_TOKEN, { polling: true });
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

const BOT_NAMES = ["Sardor_99", "Jasur_Bek", "Dilnoza_A", "Madina_K", "Shohruh_Uz", "Farrux_88", "Aziza_M", "Bekzod_T"];

// Baza initsializatsiyasi
async function initDB() {
    try {
        await pool.query(`
            CREATE TABLE IF NOT EXISTS users (
                id BIGINT PRIMARY KEY,
                username VARCHAR(255),
                wins INT DEFAULT 0,
                losses INT DEFAULT 0
            );
        `);
        console.log("PostgreSQL bazasi ulandi va tayyor!");
    } catch (err) {
        console.error("Baza xatosi:", err.message);
    }
}
initDB();

// Telegram Bot hodisalari
bot.onText(/\/start/, async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    const username = msg.from.username || msg.from.first_name;

    try {
        const userRes = await pool.query(`SELECT * FROM users WHERE id = $1`, [userId]);
        if (userRes.rows.length === 0) {
            await pool.query(`INSERT INTO users (id, username) VALUES ($1, $2)`, [userId, username]);
        }
    } catch (e) { console.error(e.message); }

    bot.sendMessage(chatId, `Salom ${msg.from.first_name}! 🌶️ Qalampir PvP o'yiniga xush kelibsiz!`, {
        reply_markup: {
            inline_keyboard: [[
                { text: "🌶️ O'ynash", web_app: { url: `${APP_URL}?user_id=${userId}&name=${encodeURIComponent(username)}` } }
            ]]
        }
    });
});

// Bot Raqib Generatsiyasi (50/50 nisbat uchun)
app.get('/api/get-bot-opponent', (req, res) => {
    const randomName = BOT_NAMES[Math.floor(Math.random() * BOT_NAMES.length)];
    const botPos = Math.floor(Math.random() * 9);
    res.json({ success: true, botName: randomName, botPos: botPos });
});

// Natijani Saqlash
app.post('/api/save-result', async (req, res) => {
    const { userId, result } = req.body;
    if (!userId) return res.json({ success: false });
    try {
        if (result === 'win') {
            await pool.query(`UPDATE users SET wins = wins + 1 WHERE id = $1`, [userId]);
        } else {
            await pool.query(`UPDATE users SET losses = losses + 1 WHERE id = $1`, [userId]);
        }
        res.json({ success: true });
    } catch (e) { res.json({ success: false, message: e.message }); }
});

// Matchmaking (Socket.IO)
let waitingPlayer = null;

io.on('connection', (socket) => {
    socket.on('find_match', (data) => {
        if (waitingPlayer && waitingPlayer.id !== socket.id) {
            const roomId = `room_${waitingPlayer.id}_${socket.id}`;
            socket.join(roomId);
            waitingPlayer.socket.join(roomId);

            io.to(roomId).emit('match_found', {
                roomId,
                players: [
                    { id: waitingPlayer.id, name: waitingPlayer.name },
                    { id: socket.id, name: data.name }
                ]
            });
            waitingPlayer = null;
        } else {
            waitingPlayer = { id: socket.id, name: data.name, socket };
        }
    });

    socket.on('send_emoji', (data) => {
        socket.to(data.roomId).emit('receive_emoji', { emoji: data.emoji });
    });

    socket.on('disconnect', () => {
        if (waitingPlayer && waitingPlayer.id === socket.id) {
            waitingPlayer = null;
        }
    });
});

// Admin Panel (ID orqali ximoyalangan)
app.get('/admin', async (req, res) => {
    if (parseInt(req.query.user_id) !== ADMIN_TELEGRAM_ID) {
        return res.status(403).send("⛔️ Kirish taqiqlangan!");
    }
    const users = (await pool.query(`SELECT * FROM users ORDER BY wins DESC`)).rows;
    let rows = users.map(u => `
        <tr>
            <td style="padding:8px; border:1px solid #333;">${u.id}</td>
            <td style="padding:8px; border:1px solid #333;">@${u.username || 'Anonim'}</td>
            <td style="padding:8px; border:1px solid #333; color:#2ed573;"><b>${u.wins}</b></td>
            <td style="padding:8px; border:1px solid #333; color:#ff4757;"><b>${u.losses}</b></td>
        </tr>
    `).join('');

    res.send(`
        <body style="background:#121212; color:#fff; font-family:sans-serif; padding:20px;">
            <h2>📊 Admin Panel - Qalampir Top</h2>
            <p>Jami foydalanuvchilar: <b>${users.length}</b></p>
            <table style="width:100%; border-collapse:collapse; background:#1e1e1e;">
                <tr style="background:#2c2c2c;">
                    <th style="padding:8px; border:1px solid #333;">ID</th>
                    <th style="padding:8px; border:1px solid #333;">O'yinchi</th>
                    <th style="padding:8px; border:1px solid #333;">G'alaba</th>
                    <th style="padding:8px; border:1px solid #333;">Mag'lubiyat</th>
                </tr>
                ${rows}
            </table>
        </body>
    `);
});

server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
                              
