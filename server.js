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

async function initDB() {
    try {
        await pool.query(`
            CREATE TABLE IF NOT EXISTS users (
                id BIGINT PRIMARY KEY,
                username VARCHAR(255),
                referred_by BIGINT,
                referrals_count INT DEFAULT 0,
                wins INT DEFAULT 0,
                losses INT DEFAULT 0
            );
        `);
        console.log("PostgreSQL bazasi tayyor!");
    } catch (err) {
        console.error("Baza xatosi:", err.message);
    }
}
initDB();

// 1. TELEGRAM BOT HANDLERS & REFERRAL
bot.onText(/\/start(?:\s+(.+))?/, async (msg, match) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    const username = msg.from.username || msg.from.first_name;
    const referrerId = match[1] ? parseInt(match[1]) : null;

    try {
        const userRes = await pool.query(`SELECT * FROM users WHERE id = $1`, [userId]);
        if (userRes.rows.length === 0) {
            await pool.query(
                `INSERT INTO users (id, username, referred_by) VALUES ($1, $2, $3)`,
                [userId, username, referrerId !== userId ? referrerId : null]
            );
            if (referrerId && referrerId !== userId) {
                await pool.query(`UPDATE users SET referrals_count = referrals_count + 1 WHERE id = $1`, [referrerId]);
            }
        }
    } catch (e) {
        console.error("User save error:", e.message);
    }

    const shareUrl = `https://t.me/share/url?url=https://t.me/qalampir_top_bot?start=${userId}&text=${encodeURIComponent("🌶️ Qalampir PvP o'yinida meni mag'lub eta olasanmi? Hoziroq qo'shil!")}`;

    bot.sendMessage(chatId, `Salom ${msg.from.first_name}! 🌶️ Qalampir PvP o'yiniga xush kelibsiz!`, {
        reply_markup: {
            inline_keyboard: [
                [{ text: "🌶️ O'yinni Boshlash", web_app: { url: `${APP_URL}?user_id=${userId}&name=${encodeURIComponent(username)}` } }],
                [{ text: "🚀 Do'stlarni taklif qilish", url: shareUrl }]
            ]
        }
    });
});

// API: Bot Raqib
app.get('/api/get-bot-opponent', (req, res) => {
    const randomName = BOT_NAMES[Math.floor(Math.random() * BOT_NAMES.length)];
    const botPos = Math.floor(Math.random() * 9);
    res.json({ success: true, botName: randomName, botPos: botPos });
});

// API: Natijani Saqlash
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

// 2. SOCKET.IO REAL-TIME MATCHMAKING
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

// 3. ADMIN PANEL & OMMAVIY XABAR YUBORISH
app.get('/admin', async (req, res) => {
    if (parseInt(req.query.user_id) !== ADMIN_TELEGRAM_ID) {
        return res.status(403).send("⛔️ Kirish taqiqlangan!");
    }
    try {
        const users = (await pool.query(`SELECT * FROM users ORDER BY wins DESC`)).rows;
        let rows = users.map(u => `
            <tr>
                <td style="padding:8px; border:1px solid #333;">${u.id}</td>
                <td style="padding:8px; border:1px solid #333;">@${u.username || 'Anonim'}</td>
                <td style="padding:8px; border:1px solid #333; color:#f1c40f;">${u.referrals_count || 0}</td>
                <td style="padding:8px; border:1px solid #333; color:#2ed573;"><b>${u.wins}</b></td>
                <td style="padding:8px; border:1px solid #333; color:#ff4757;"><b>${u.losses}</b></td>
            </tr>
        `).join('');

        res.send(`
            <!DOCTYPE html>
            <html>
            <head><title>Admin Panel</title></head>
            <body style="background:#121212; color:#fff; font-family:sans-serif; padding:20px;">
                <h2>📊 Admin Panel - Qalampir Top</h2>
                <p>Jami foydalanuvchilar: <b>${users.length}</b></p>
                
                <div style="background:#1e1e1e; padding:15px; border-radius:8px; margin-bottom:20px;">
                    <h3>📢 Ommaviy Xabar Yuborish</h3>
                    <form action="/admin/broadcast" method="POST">
                        <input type="hidden" name="admin_id" value="${ADMIN_TELEGRAM_ID}">
                        <textarea name="message" style="width:100%; height:80px; background:#222; color:#fff; border:1px solid #444; border-radius:5px; padding:8px;" placeholder="Xabarni kiriting..."></textarea><br><br>
                        <button type="submit" style="background:#2ed573; color:#fff; border:none; padding:10px 20px; border-radius:5px; cursor:pointer;">Yuborish</button>
                    </form>
                </div>

                <table style="width:100%; border-collapse:collapse; background:#1e1e1e;">
                    <tr style="background:#2c2c2c;">
                        <th style="padding:8px; border:1px solid #333;">ID</th>
                        <th style="padding:8px; border:1px solid #333;">O'yinchi</th>
                        <th style="padding:8px; border:1px solid #333;">Referallar</th>
                        <th style="padding:8px; border:1px solid #333;">G'alaba</th>
                        <th style="padding:8px; border:1px solid #333;">Mag'lubiyat</th>
                    </tr>
                    ${rows}
                </table>
            </body>
            </html>
        `);
    } catch (e) { res.status(500).send("Xato: " + e.message); }
});

app.post('/admin/broadcast', express.urlencoded({ extended: true }), async (req, res) => {
    const { admin_id, message } = req.body;
    if (parseInt(admin_id) !== ADMIN_TELEGRAM_ID) return res.status(403).send("Taqiqlangan");

    const users = (await pool.query(`SELECT id FROM users`)).rows;
    let sentCount = 0;

    for (let u of users) {
        try {
            await bot.sendMessage(u.id, message);
            sentCount++;
        } catch (e) { console.error(`Xabar yuborilmadi: ${u.id}`); }
    }

    res.send(`<h3>✅ Xabar ${sentCount} ta foydalanuvchiga yuborildi!</h3><a href="/admin?user_id=${ADMIN_TELEGRAM_ID}">Orqaga</a>`);
});

server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
