require("dotenv").config();

const { Telegraf, Markup } = require("telegraf");

const {
    getOrCreateUser
} = require("./db");

const bot = new Telegraf(
    process.env.BOT_TOKEN
);

const WEB_APP_URL =
    process.env.WEB_APP_URL ||
    "https://qalampir-game.onrender.com";

// =========================================================
// START
// =========================================================

bot.start(async (ctx) => {
    try {
        const user = ctx.from;

        await getOrCreateUser({
            telegramId: user.id,
            username: user.username || null,
            firstName:
                user.first_name || "Player"
        });

        await ctx.reply(
            `Xush kelibsiz, ${user.first_name}! 🌶️\n\n` +
            `Qalampir Topish o'yiniga tayyormisiz?\n\n` +
            `Pastdagi tugmani bosib o'yinni boshlang:`,
            Markup.keyboard([
                [
                    Markup.button.webApp(
                        "🎮 O'yinni Boshlash",
                        WEB_APP_URL
                    )
                ]
            ]).resize()
        );

    } catch (error) {

        console.error(
            "Bot start xatosi:",
            error
        );

        await ctx.reply(
            "❌ Xatolik yuz berdi. Iltimos, keyinroq qayta urinib ko'ring."
        );
    }
});

// =========================================================
// HELP
// =========================================================

bot.help(async (ctx) => {
    await ctx.reply(
        "🌶️ Qalampir Topish\n\n" +
        "🎮 O'yinni boshlash uchun /start buyrug'ini bosing.\n\n" +
        "Siz o'yinda coin yig'ishingiz va reytingda yuqorilashingiz mumkin."
    );
});

// =========================================================
// BOT ERROR
// =========================================================

bot.catch((error, ctx) => {
    console.error(
        `Telegram bot xatosi [${ctx.updateType}]:`,
        error
    );
});

module.exports = bot;
