const express = require('express');
const TelegramBot = require('node-telegram-bot-api');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Bot Tokens va Sozlamalar
const TOKEN = '8809424395:AAFRdNm6HG168dtZzRDfrmqqM4fm1fsq708';
const APP_URL = 'https://qalampir-game.onrender.com';

const bot = new TelegramBot(TOKEN, { polling: true });

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Bot /start komandasi
bot.onText(/\/start/, (msg) => {
    const chatId = msg.chat.id;
    const firstName = msg.from.first_name || 'Do\'st';

    bot.sendMessage(chatId, `Salom ${firstName}! 🌶️\n\n"Qalampir Top" o'yiniga xush kelibsiz!`, {
        reply_markup: {
            inline_keyboard: [
                [{ text: "🌶️ O'yinni boshlash", web_app: { url: APP_URL } }],
                [{ text: "⭐ Balansni to'ldirish (10 Stars)", callback_data: "buy_stars" }]
            ]
        }
    });
});

// Telegram Stars To'lov Sozlamalari (Invoice)
bot.on('callback_query', (query) => {
    if (query.data === 'buy_stars') {
        const chatId = query.message.chat.id;

        bot.sendInvoice(
            chatId,
            "10 ta Yulduz (Stars)",
            "Qalampir Top o'yini balansi uchun",
            "payload_qalampir_stars",
            "", // Stars to'lovi uchun provider_token bo'sh qoladi
            "XTR",
            [{ label: "10 Stars", amount: 10 }]
        );
    }
});

// To'lovdan oldingi tasdiqlash
bot.on('pre_checkout_query', (query) => {
    bot.answerPreCheckoutQuery(query.id, true);
});

// To'lov muvaffaqiyatli amalga oshganda
bot.on('successful_payment', (msg) => {
    bot.sendMessage(msg.chat.id, "🎉 To'lov muvaffaqiyatli amalga oshirildi! Balansingizga 10 Yulduz qo'shildi.");
});

// Serverni ishga tushirish
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
