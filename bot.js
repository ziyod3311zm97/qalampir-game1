const { Telegraf, Markup } = require('telegraf');

const BOT_TOKEN = process.env.BOT_TOKEN || '8809424395:AAFRdNm6HG168dtZzRDfrmqqM4fm1fsq708';
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

bot.launch().then(() => console.log('Telegram Bot muvaffaqiyatli ishga tushdi!'));

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
