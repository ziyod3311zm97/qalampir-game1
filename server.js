require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const { dbQuery } = require('./db');
const bot = require('./bot');
const BotAI = require('./botAI');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

// API: Foydalanuvchi ma'lumotlarini olish
app.get('/api/user/:id', async (req, res) => {
  try {
    const telegramId = req.params.id;
    let user = await dbQuery.getUser(telegramId);
    if (!user) {
      user = await dbQuery.createUser({ id: telegramId, username: '', first_name: 'O\'yinchi' });
    }
    res.json(user);
  } catch (error) {
    console.error('API Error:', error);
    res.status(500).json({ error: 'Server xatoligi' });
  }
});

// O'yin xonalari bazasi
const rooms = new Map();
let waitingPlayer = null;

io.on('connection', (socket) => {
  console.log('🎮 Foydalanuvchi ulandi:', socket.id);

  // Tasodifiy raqib qidirish
  socket.on('joinRandomGame', (userData) => {
    socket.userData = userData;

    if (waitingPlayer && waitingPlayer.id !== socket.id) {
      const roomId = `room_${waitingPlayer.id}_${socket.id}`;
      const roomData = {
        id: roomId,
        players: [waitingPlayer, socket],
        spots: {},
        turn: waitingPlayer.id
      };

      rooms.set(roomId, roomData);
      waitingPlayer.join(roomId);
      socket.join(roomId);

      waitingPlayer.emit('gameMatched', { roomId, opponent: socket.userData });
      socket.emit('gameMatched', { roomId, opponent: waitingPlayer.userData });

      waitingPlayer = null;
    } else {
      waitingPlayer = socket;
      socket.emit('waitingForOpponent');

      // 6 soniyadan keyin bot ulanadi
      setTimeout(() => {
        if (waitingPlayer === socket) {
          waitingPlayer = null;
          const roomId = `bot_room_${socket.id}`;
          const botId = `bot_${Date.now()}`;
          const botSpot = Math.floor(Math.random() * 6);

          const roomData = {
            id: roomId,
            isBotGame: true,
            players: [socket, { id: botId, isBot: true }],
            spots: { [botId]: botSpot },
            turn: socket.id
          };

          rooms.set(roomId, roomData);
          socket.join(roomId);
          socket.emit('gameMatched', { roomId, opponent: { first_name: '🤖 Bot' } });
        }
      }, 6000);
    }
  });

  // Do'st bilan o'ynash uchun xona yaratish
  socket.on('createPrivateRoom', (userData) => {
    socket.userData = userData;
    const roomCode = Math.floor(1000 + Math.random() * 9000).toString();
    const roomId = `private_${roomCode}`;

    rooms.set(roomId, {
      id: roomId,
      code: roomCode,
      players: [socket],
      spots: {},
      turn: socket.id
    });

    socket.join(roomId);
    socket.emit('roomCreated', { roomCode, roomId });
  });

  // Xonaga kirish
  socket.on('joinPrivateRoom', ({ roomCode, userData }) => {
    socket.userData = userData;
    const roomId = `private_${roomCode}`;
    const room = rooms.get(roomId);

    if (!room) {
      return socket.emit('errorMsg', 'Xona topilmadi!');
    }
    if (room.players.length >= 2) {
      return socket.emit('errorMsg', 'Xona to\'la!');
    }

    room.players.push(socket);
    socket.join(roomId);

    const player1 = room.players[0];
    const player2 = room.players[1];

    player1.emit('gameMatched', { roomId, opponent: player2.userData });
    player2.emit('gameMatched', { roomId, opponent: player1.userData });
  });

  // Qalampir joylash
  socket.on('setSpot', ({ roomId, spot }) => {
    const room = rooms.get(roomId);
    if (!room) return;

    room.spots[socket.id] = spot;

    const allReady = room.players.every(p => p.isBot || room.spots[p.id] !== undefined);
    if (allReady) {
      io.to(roomId).emit('battleStart', { turn: room.turn });
    }
  });

  // Hujum qilish
  socket.on('attackSpot', ({ roomId, spot }) => {
    const room = rooms.get(roomId);
    if (!room || room.turn !== socket.id) return;

    const opponent = room.players.find(p => p.id !== socket.id);
    const opponentSpot = room.spots[opponent.id];

    if (spot === opponentSpot) {
      // G'alaba!
      io.to(roomId).emit('gameOver', { winner: socket.id, hitSpot: spot });
      rooms.delete(roomId);
    } else {
      // Tegmadi, navbat almashadi
      room.turn = opponent.id;
      io.to(roomId).emit('turnChanged', { attacker: socket.id, spot, nextTurn: opponent.id });

      // Bot yurishi
      if (opponent.isBot) {
        setTimeout(() => {
          const availableMoves = [0, 1, 2, 3, 4, 5];
          const botAttack = availableMoves[Math.floor(Math.random() * availableMoves.length)];
          const mySpot = room.spots[socket.id];

          if (botAttack === mySpot) {
            io.to(roomId).emit('gameOver', { winner: opponent.id, hitSpot: botAttack });
            rooms.delete(roomId);
          } else {
            room.turn = socket.id;
            io.to(roomId).emit('turnChanged', { attacker: opponent.id, spot: botAttack, nextTurn: socket.id });
          }
        }, 1500);
      }
    }
  });

  socket.on('disconnect', () => {
    if (waitingPlayer === socket) waitingPlayer = null;
  });
});

const PORT = process.env.PORT || 10000;
server.listen(PORT, async () => {
  console.log(`🚀 Qalampir Game serveri ${PORT}-portda muvaffaqiyatli ishga tushdi!`);
  
  // Telegram Botni ishga tushirish
  try {
    await bot.launch();
    console.log('🤖 Telegram Bot muvaffaqiyatli faollashtirildi!');
  } catch (err) {
    console.error('❌ Telegram Botni ishga tushirishda xatolik:', err.message);
  }
});
