require('dotenv').config();
const { Telegraf, Markup } = require('telegraf');
const { dbQuery } = require('./db');

const bot = new Telegraf(process.env.BOT_TOKEN);
const WEB_APP_URL = process.env.WEB_APP_URL || 'https://qalampir-game1.onrender.com';

bot.start(async (ctx) => {
  try {
    const user = ctx.from;
    let dbUser = await dbQuery.getUser(user.id);
    if (!dbUser) {
      dbUser = await dbQuery.createUser(user);
    }

    ctx.reply(
      `Xush kelibsiz, ${user.first_name}! 🌶️\n\nQalampir Topish o'yiniga tayyormisiz? Pastdagi tugmani bosing:`,
      Markup.keyboard([
        [Markup.button.webApp("🎮 O'yinni Boshlash", WEB_APP_URL)]
      ]).resize()
    );
  } catch (err) {
    console.error('Bot start xatosi:', err.message);
  }
});

module.exports = bot;
