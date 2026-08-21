const express = require('express');
const TelegramBot = require('node-telegram-bot-api');
const { Pool } = require('pg');
const https = require('https');
const path = require('path');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const PORT = process.env.PORT || 3000;
const BOT_TOKEN = process.env.BOT_TOKEN;
const APP_URL = process.env.APP_URL || 'https://qalampir-top.onrender.com';

// Telegram Bot obyektini yaratish
const bot = new TelegramBot(BOT_TOKEN, { polling: true });

// Supabase PostgreSQL bilan ulanish
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

// ==========================================
// 1. TELEGRAM BOT COMMANDS & REFERRAL SYSTEM
// ==========================================

bot.onText(/\/start(?:\s+(.+))?/, async (msg, match) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    const username = msg.from.username || msg.from.first_name;
    const refId = match[1] ? parseInt(match[1]) : null;

    try {
        const userRes = await pool.query(`SELECT * FROM users WHERE id = $1`, [userId]);
        
        if (userRes.rows.length === 0) {
            // Yangi foydalanuvchini bazaga qo'shish
            await pool.query(
                `INSERT INTO users (id, username, stars, referrer_id) VALUES ($1, $2, 20, $3)`,
                [userId, username, (refId && refId !== userId) ? refId : null]
            );
            
            // Referral taklif qilgan shaxsga Speed Boost (+15%) va Yulduz berish
            if (refId && refId !== userId) {
                await pool.query(
                    `UPDATE users SET 
                        stars = stars + 5, 
                        mining_rate = COALESCE(mining_rate, 1.0) * 1.15, 
                        referrals_count = COALESCE(referrals_count, 0) + 1 
                     WHERE id = $1`, 
                    [refId]
                );
                
                bot.sendMessage(refId, `🎉 Do'stingiz (${username}) o'yinga qo'shildi!\n⚡️ Mining tezligingiz **+15% ga oshdi**!`);
            }
        }
    } catch (e) { 
        console.error("Start buyrug'i xatosi:", e.message); 
    }

    bot.sendMessage(chatId, `Salom ${msg.from.first_name}! ⛏️ $QALAMPIR Token Mining ekotizimiga xush kelibsiz!`, {
        reply_markup: {
            inline_keyboard: [[
                { text: "🌶️ Mining & O'yinni Boshlash", web_app: { url: `${APP_URL}?user_id=${userId}` } }
            ]]
        }
    });
});

// ==========================================
// 2. MINING & VIRAL API ENDPOINTS
// ==========================================

// API: Foydalanuvchining joriy mining holatini olish
app.get('/api/mining-status/:id', async (req, res) => {
    const userId = req.params.id;
    try {
        const userRes = await pool.query(`SELECT * FROM users WHERE id = $1`, [userId]);
        if (userRes.rows.length === 0) return res.json({ success: false, message: "Foydalanuvchi topilmadi" });

        const user = userRes.rows[0];
        const now = new Date();
        const lastClaim = new Date(user.last_claim || now);
        
        // O'tgan vaqt (soatlarda), maksimal 8 soat yig'iladi
        let hoursPassed = (now - lastClaim) / (1000 * 60 * 60);
        if (hoursPassed > 8) hoursPassed = 8;

        const currentMined = hoursPassed * (user.mining_rate || 1.0);

        res.json({
            success: true,
            totalPoints: user.mining_points || 0,
            currentMined: currentMined.toFixed(2),
            miningRate: user.mining_rate || 1.0,
            canClaim: hoursPassed >= 0.01
        });
    } catch (e) { 
        res.json({ success: false, message: e.message }); 
    }
});

// API: Yig'ilgan tokenlarni Claim qilish (Balansga o'tkazish)
app.post('/api/claim-mining', async (req, res) => {
    const { userId } = req.body;
    try {
        const userRes = await pool.query(`SELECT * FROM users WHERE id = $1`, [userId]);
        if (userRes.rows.length === 0) return res.json({ success: false, message: "Foydalanuvchi topilmadi" });

        const user = userRes.rows[0];
        const now = new Date();
        const lastClaim = new Date(user.last_claim || now);
        
        let hoursPassed = (now - lastClaim) / (1000 * 60 * 60);
        if (hoursPassed > 8) hoursPassed = 8;

        const minedAmount = hoursPassed * (user.mining_rate || 1.0);

        if (minedAmount <= 0) {
            return res.json({ success: false, message: "Hali yig'ilgan token yo'q!" });
        }

        await pool.query(
            `UPDATE users SET mining_points = COALESCE(mining_points, 0) + $1, last_claim = NOW() WHERE id = $2`,
            [minedAmount, userId]
        );

        res.json({ 
            success: true, 
            message: `${minedAmount.toFixed(2)} $QALAMPIR balansga qo'shildi! 🚀` 
        });
    } catch (e) { 
        res.json({ success: false, message: e.message }); 
    }
});

// API: Story ulashganlik uchun bonus berish
app.post('/api/story-reward', async (req, res) => {
    const { userId } = req.body;
    try {
        await pool.query(`UPDATE users SET mining_points = COALESCE(mining_points, 0) + 50 WHERE id = $1`, [userId]);
        res.json({ success: true, message: "Story uchun +50 Active Mining Ball berildi! 🚀" });
    } catch (e) { 
        res.json({ success: false, message: e.message }); 
    }
});

// API: Duel g'olibiga active mining balli qo'shish (O'yin mantig'i oxirida ishlatiladi)
async function rewardDuelWinner(winnerId) {
    try {
        await pool.query(`UPDATE users SET mining_points = COALESCE(mining_points, 0) + 50 WHERE id = $1`, [winnerId]);
    } catch (e) {
        console.error("Duel reward xatosi:", e.message);
    }
}

// ==========================================
// 3. SERVER & KEEP-ALIVE MECHANISM
// ==========================================

app.listen(PORT, () => {
    console.log(`Server ${PORT}-portda muvaffaqiyatli ishga tushdi`);
});

// Render serverini 24/7 uyg'oq ushlash uchun o'z-o'ziga ping yuborish
setInterval(() => {
    https.get(APP_URL, (res) => {
        console.log(`Keep-alive ping yuborildi: Status ${res.statusCode}`);
    }).on('error', (err) => {
        console.error('Ping xatosi:', err.message);
    });
}, 10 * 60 * 1000); // Har 10 daqiqada bir marta

// Server kutilmagan xatolik sababli to'xtab (crash) qolmasligi uchun tutqichlar
process.on('uncaughtException', (err) => {
    console.error('Kutilmagan xatolik (Uncaught Exception):', err);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('Tutib olinmagan Rejection (Unhandled Rejection):', reason);
});
