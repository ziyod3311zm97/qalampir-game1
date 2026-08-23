require('dotenv').config();
const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');
const { dbQuery } = require('./db');
const bot = require('./bot');
const BotAI = require('./botAI');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

// API: Foydalanuvchi ma'lumotlarini olish
app.get('/api/user/:id', async (req, res) => {
  try {
    const telegramId = req.params.id;
    let user = await dbQuery.getUser(telegramId);
    
    if (!user) {
      // Agar foydalanuvchi bazada bo'lmasa, yaratish
      user = await dbQuery.createUser({ id: telegramId, username: '', first_name: 'O\'yinchi' });
    }
    
    res.json(user);
  } catch (error) {
    console.error('API /user Error:', error);
    res.status(500).json({ error: 'Server xatoligi' });
  }
});

// API: Kunlik bonus olish
app.post('/api/daily-bonus', async (req, res) => {
  try {
    const { telegramId } = req.body;
    const user = await dbQuery.getUser(telegramId);
    
    if (!user) {
      return res.status(404).json({ error: 'Foydalanuvchi topilmadi' });
    }

    const bonusAmount = 100;
    await dbQuery.updateBalance(telegramId, bonusAmount, 'daily_bonus', 'Kunlik bonus');
    
    const updatedUser = await dbQuery.getUser(telegramId);
    res.json({ success: true, balance: updatedUser.balance });
  } catch (error) {
    console.error('API /daily-bonus Error:', error);
    res.status(500).json({ error: 'Bonus berishda xatolik' });
  }
});

// WebSocket xonalari (Duellar va O'yinlar uchun)
const activeRooms = new Map();

wss.on('connection', (ws) => {
  let currentUser = null;

  ws.on('message', async (message) => {
    try {
      const data = JSON.parse(message);

      // Foydalanuvchini autentifikatsiya qilish
      if (data.type === 'INIT_USER') {
        currentUser = await dbQuery.getUser(data.telegramId);
        if (currentUser) {
          ws.send(JSON.stringify({ type: 'USER_DATA', user: currentUser }));
        }
      }

      // Bot bilan o'yin boshlash (Entry Fee: 100 Coin)
      if (data.type === 'START_BOT_GAME') {
        const { telegramId, difficulty } = data;
        const user = await dbQuery.getUser(telegramId);

        if (!user || user.balance < 100) {
          return ws.send(JSON.stringify({ type: 'ERROR', message: 'Mablag\' yetarli emas! Duelga kirish 100 Coin.' }));
        }

        // Kirish to'lovini yechish
        await dbQuery.updateBalance(telegramId, -100, 'game_entry', 'Bot dueliga kirish');
        
        ws.send(JSON.stringify({ 
          type: 'GAME_STARTED', 
          mode: 'bot', 
          difficulty: difficulty || 'medium',
          currentBalance: user.balance - 100 
        }));
      }

      // O'yin natijasini qayta ishlash
      if (data.type === 'GAME_FINISH') {
        const { telegramId, result } = data; // result: 'win' yoki 'lose'

        if (result === 'win') {
          // G'olibga 180 Coin mukofot (20 Coin komissiya)
          await dbQuery.updateBalance(telegramId, 180, 'game_win', 'Duelda g\'alaba');
          await dbQuery.updateStats(telegramId, true);
        } else {
          await dbQuery.updateStats(telegramId, false);
        }

        const updatedUser = await dbQuery.getUser(telegramId);
        ws.send(JSON.stringify({ type: 'GAME_RESULT_PROCESSED', user: updatedUser }));
      }

      // Bot AI harakatini so'rash
      if (data.type === 'GET_BOT_MOVE') {
        const { difficulty, availableMoves, winningMove } = data;
        const move = BotAI.getMove(difficulty, availableMoves, winningMove);
        ws.send(JSON.stringify({ type: 'BOT_MOVE_RESULT', move }));
      }

    } catch (err) {
      console.error('WS Connection Error:', err);
    }
  });

  ws.on('close', () => {
    // Foydalanuvchi uzilganda
  });
});

const PORT = process.env.PORT || 10000;
server.listen(PORT, () => {
  console.log(`🚀 Qalampir Game serveri ${PORT}-portda Render.com muvaffaqiyatli ishga tushdi!`);
});
