require('dotenv').config();
const { Telegraf, Markup } = require('telegraf');
const { dbQuery } = require('./db');

const bot = new Telegraf(process.env.BOT_TOKEN);
const WEB_APP_URL = process.env.WEB_APP_URL || 'https://qalampir-game.onrender.com';

// /start komandasi va referal tizimi
bot.start(async (ctx) => {
  try {
    const telegramId = ctx.from.id;
    const startPayload = ctx.payload; // Deep-link parametri (masalan: ref_123456)
    
    let user = await dbQuery.getUser(telegramId);
    let referredBy = null;

    if (startPayload && startPayload.startsWith('ref_')) {
      const refId = parseInt(startPayload.replace('ref_', ''), 10);
      if (!isNaN(refId) && refId !== telegramId) {
        referredBy = refId;
      }
    }

    // Yangi foydalanuvchini bazaga qo'shish
    if (!user) {
      await dbQuery.createUser(ctx.from, referredBy);
      
      // Agar referal orqali kirgan bo'lsa, ikkala tomonga bonus
      if (referredBy) {
        await dbQuery.updateBalance(referredBy, 500, 'referral', `Do'st taklif qilindi: ${telegramId}`);
        await dbQuery.updateBalance(telegramId, 200, 'welcome_ref', `Referal bonus`);
      }
    }

    const shareUrl = `https://t.me/share/url?url=https://t.me/QalampirBot?start=ref_${telegramId}&text=🌶️%20Qalampir%20o'yinida%20meni%20yuta%20olasanmi?%20Kirib%20o'yna!`;

    await ctx.reply(
      `🌶️ *Qalampir O'yiniga Xush Kelibsiz!*\n\nDo'stlaringiz bilan duel o'ynang, ochkolar yig'ing va sovrinlarni yutib oling!`,
      {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([
          [Markup.button.webApp("🔥 O'yinni Boshlash", WEB_APP_URL)],
          [Markup.button.url("👥 Do'stlarni taklif qilish (+500 Coin)", shareUrl)]
        ])
      }
    );
  } catch (error) {
    console.error("Bot start xatosi:", error);
  }
});

// Admin uchun maxsus buyruq
bot.command('admin', async (ctx) => {
  const adminId = process.env.ADMIN_ID || '867914430';
  if (ctx.from.id.toString() !== adminId.toString()) {
    return ctx.reply("❌ Siz admin emassiz.");
  }
  ctx.reply("👑 Admin Panel:\n\nSiz loyiha adminisiz. Tizim va baza faol ishlamoqda.");
});

bot.launch().then(() => console.log("🤖 Telegram Bot muvaffaqiyatli ishga tushdi"));

module.exports = bot;
