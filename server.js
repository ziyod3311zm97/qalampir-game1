const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const { Telegraf, Markup } = require('telegraf');

const app = express();

app.use(cors());
app.use(express.json());

// 1. WebApp sahifasi yo'nalishi
app.get('/', (req, res) => {
    const rootIndex = path.join(__dirname, 'index.html');
    const publicIndex = path.join(__dirname, 'public', 'index.html');

    if (fs.existsSync(rootIndex)) {
        return res.sendFile(rootIndex);
    } else if (fs.existsSync(publicIndex)) {
        return res.sendFile(publicIndex);
    } else {
        return res.status(404).send('index.html topilmadi!');
    }
});

app.use(express.static(__dirname));
app.use(express.static(path.join(__dirname, 'public')));

// 2. Balans API
const usersDB = {};

app.post('/game_result', (req, res) => {
    const { user_id, result } = req.body;

    if (!user_id) {
        return res.status(400).json({ status: 'error', message: 'user_id yo\'q' });
    }

    if (!usersDB[user_id]) {
        usersDB[user_id] = 10;
    }

    if (result === 'win') {
        usersDB[user_id] += 8;
    } else if (result === 'loss') {
        usersDB[user_id] -= 10;
    }

    return res.json({
        status: 'success',
        new_balance: usersDB[user_id]
    });
});

// 3. Portni ishga tushirish
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server ${PORT}-portda muvaffaqiyatli ishlayapti`);
});

// 4. Telegram Bot (Xatosiz variant)
const BOT_TOKEN = '8809424395:AAFRdNm6HG168dtZzRDfrmqqM4fm1fsq708';
const GAME_URL = 'https://qalampir-game.onrender.com';

const bot = new Telegraf(BOT_TOKEN);

bot.start((ctx) => {
    ctx.reply(
        `Xush kelibsiz, ${ctx.from.first_name}! 🌶️ Qalampir Topish o'yiniga tayyormisiz?`,
        Markup.inlineKeyboard([
            [Markup.button.webApp("🎮 O'yinni Boshlash", GAME_URL)]
        ])
    );
});

// Bot xatolik tufayli serverni o'chirib qo'ymasligi uchun safe launch
bot.launch().catch(err => {
    console.log("Botni ishga tushirishda xatolik (lekin server ishlashda davom etadi):", err.message);
});

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
