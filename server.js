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

// 🔒 ADMIN TELEGRAM ID RAQAMI
const ADMIN_TELEGRAM_ID = 867914430;

// Telegram Bot obyektini yaratish
const bot = new TelegramBot(BOT_TOKEN, { polling: true });

// Supabase PostgreSQL ulanishi
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
                        stars = COALESCE(stars, 0) + 5, 
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
// 2. MINING & GAME API ENDPOINTS
// ==========================================

// API: Foydalanuvchining joriy mining va balans holatini olish
app.get('/api/mining-status/:id', async (req, res) => {
    const userId = req.params.id;
    try {
        const userRes = await pool.query(`SELECT * FROM users WHERE id = $1`, [userId]);
        if (userRes.rows.length === 0) return res.json({ success: false, message: "Foydalanuvchi topilmadi" });

        const user = userRes.rows[0];
        const now = new Date();
        const lastClaim = new Date(user.last_claim || now);
        
        let hoursPassed = (now - lastClaim) / (1000 * 60 * 60);
        if (hoursPassed > 8) hoursPassed = 8;

        const currentMined = hoursPassed * (user.mining_rate || 1.0);

        res.json({
            success: true,
            stars: user.stars || 0,
            totalPoints: user.mining_points || 0,
            currentMined: currentMined.toFixed(4),
            miningRate: user.mining_rate || 1.0,
            canClaim: hoursPassed >= 0.01
        });
    } catch (e) { 
        res.json({ success: false, message: e.message }); 
    }
});

// API: Yig'ilgan tokenlarni Claim qilish
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

// API: Bot bilan o'ynash (60/40 nisbat: 60% Bot yutadi, 40% O'yinchi)
app.post('/api/play-bot', async (req, res) => {
    const { userId } = req.body;
    
    // 60% ehtimollik bilan bot yutadi
    const botWins = Math.random() < 0.60;

    try {
        const userRes = await pool.query(`SELECT stars FROM users WHERE id = $1`, [userId]);
        if (userRes.rows.length === 0 || (userRes.rows[0].stars || 0) < 10) {
            return res.json({ success: false, message: "Balans yetarli emas (kamida 10 ⭐ kerak)!" });
        }

        if (botWins) {
            await pool.query(`UPDATE users SET stars = stars - 10 WHERE id = $1`, [userId]);
            res.json({ success: true, result: "loss", message: "Bot g'olib bo'ldi!" });
        } else {
            await pool.query(`UPDATE users SET stars = stars + 18, mining_points = COALESCE(mining_points, 0) + 50 WHERE id = $1`, [userId]);
            res.json({ success: true, result: "win", message: "Siz g'olib bo'ldingiz! 🎉 +18 ⭐ va +50 Ball" });
        }
    } catch (e) {
        res.json({ success: false, message: e.message });
    }
});

// API: Story ulashganlik uchun bonus
app.post('/api/story-reward', async (req, res) => {
    const { userId } = req.body;
    try {
        await pool.query(`UPDATE users SET mining_points = COALESCE(mining_points, 0) + 50 WHERE id = $1`, [userId]);
        res.json({ success: true, message: "Story uchun +50 Active Mining Ball berildi! 🚀" });
    } catch (e) { 
        res.json({ success: false, message: e.message }); 
    }
});

// ==========================================
// 3. ADMIN PANEL INTERFEYSI (ID XAVFSIZLIGI)
// ==========================================

app.get('/admin', async (req, res) => {
    const userId = parseInt(req.query.user_id);

    // Xavfsizlik tekshiruvi: Faqat 867914430 ID'siga ruxsat beradi
    if (userId !== ADMIN_TELEGRAM_ID) {
        return res.status(403).send("<h1 style='color:red; text-align:center; margin-top:50px;'>⛔️ Kirish taqiqlangan! Siz admin emassiz.</h1>");
    }

    try {
        const usersRes = await pool.query(`SELECT id, username, stars, mining_points, referrals_count FROM users ORDER BY id DESC`);
        const users = usersRes.rows;

        let rowsHtml = users.map(u => `
            <tr>
                <td style="padding:10px; border:1px solid #333;">${u.id}</td>
                <td style="padding:10px; border:1px solid #333;">@${u.username || 'Noma\'lum'}</td>
                <td style="padding:10px; border:1px solid #333; color:#f1c40f;"><b>${u.stars || 0} ⭐</b></td>
                <td style="padding:10px; border:1px solid #333; color:#2ed573;"><b>${(u.mining_points || 0).toFixed(2)}</b></td>
                <td style="padding:10px; border:1px solid #333;">${u.referrals_count || 0} ta</td>
            </tr>
        `).join('');

        res.send(`
            <!DOCTYPE html>
            <html lang="uz">
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <title>Qalampir Top - Admin Panel</title>
            </head>
            <body style="background:#121212; color:#fff; font-family:sans-serif; padding:20px;">
                <h2>📊 Admin Panel - Qalampir Top</h2>
                <p style="color:#aaa;">Jami ro'yxatdan o'tgan o'yinchilar: <b style="color:#fff;">${users.length} ta</b></p>
                <hr style="border-color:#333; margin:15px 0;">
                <div style="overflow-x:auto;">
                    <table style="width:100%; border-collapse:collapse; background:#1e1e1e; text-align:left;">
                        <tr style="background:#2c2c2c; color:#ddd;">
                            <th style="padding:10px; border:1px solid #333;">Telegram ID</th>
                            <th style="padding:10px; border:1px solid #333;">Nikneym</th>
                            <th style="padding:10px; border:1px solid #333;">Yulduzlar</th>
                            <th style="padding:10px; border:1px solid #333;">$QALAMPIR</th>
                            <th style="padding:10px; border:1px solid #333;">Referallar</th>
                        </tr>
                        ${rowsHtml}
                    </table>
                </div>
            </body>
            </html>
        `);
    } catch (e) {
        res.status(500).send("Admin panel xatosi: " + e.message);
    }
});

// ==========================================
// 4. SERVER & KEEP-ALIVE MECHANISM
// ==========================================

app.listen(PORT, () => {
    console.log(`Server ${PORT}-portda muvaffaqiyatli ishga tushdi`);
});

// Render serverini 24/7 uyg'oq ushlash uchun har 10 daqiqada ping yuborish
setInterval(() => {
    https.get(APP_URL, (res) => {
        console.log(`Keep-alive ping yuborildi: Status ${res.statusCode}`);
    }).on('error', (err) => {
        console.error('Ping xatosi:', err.message);
    });
}, 10 * 60 * 1000);

process.on('uncaughtException', (err) => {
    console.error('Kutilmagan xatolik (Uncaught Exception):', err);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('Tutib olinmagan Rejection (Unhandled Rejection):', reason);
});
