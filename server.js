const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const { Telegraf, Markup } = require('telegraf');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

app.use(cors());
app.use(express.json());

// Asosiy faylni topib berish
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

// Eski balans va API tizimi
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

// REAL-TIME MULTIPLAYER (Xonalar va o'yin mantiqi)
let waitingPlayer = null;
const rooms = {};

io.on('connection', (socket) => {
    console.log('O\'yinchi ulandi:', socket.id);

    socket.on('joinGame', (userData) => {
        if (waitingPlayer && waitingPlayer.id !== socket.id) {
            const roomId = `room_${waitingPlayer.id}_${socket.id}`;
            const p1 = waitingPlayer;
            const p2 = { socket, userData };

            rooms[roomId] = {
                players: {
                    [p1.socket.id]: { id: p1.socket.id, user: p1.userData, spot: -1, ready: false },
                    [p2.socket.id]: { id: p2.socket.id, user: p2.userData, spot: -1, ready: false }
                },
                turn: p1.socket.id
            };

            p1.socket.join(roomId);
            p2.socket.join(roomId);

            p1.socket.emit('gameMatched', { roomId, opponent: p2.userData, myId: p1.socket.id });
            p2.socket.emit('gameMatched', { roomId, opponent: p1.userData, myId: p2.socket.id });

            waitingPlayer = null;
        } else {
            waitingPlayer = { socket, userData };
            socket.emit('waitingForOpponent');
        }
    });

    socket.on('setSpot', ({ roomId, spot }) => {
        const room = rooms[roomId];
        if (!room) return;

        room.players[socket.id].spot = spot;
        room.players[socket.id].ready = true;

        const playerIds = Object.keys(room.players);
        const p1Ready = room.players[playerIds[0]].ready;
        const p2Ready = room.players[playerIds[1]].ready;

        if (p1Ready && p2Ready) {
            io.to(roomId).emit('battleStart', { turn: room.turn });
        }
    });

    socket.on('attackSpot', ({ roomId, spot }) => {
        const room = rooms[roomId];
        if (!room || room.turn !== socket.id) return;

        const playerIds = Object.keys(room.players);
        const enemyId = playerIds.find(id => id !== socket.id);
        const enemySpot = room.players[enemyId].spot;

        if (spot === enemySpot) {
            io.to(roomId).emit('gameOver', { winner: socket.id, hitSpot: spot });
            delete rooms[roomId];
        } else {
            room.turn = enemyId;
            io.to(roomId).emit('turnChanged', { attacker: socket.id, spot, nextTurn: enemyId });
        }
    });

    socket.on('disconnect', () => {
        if (waitingPlayer && waitingPlayer.socket.id === socket.id) {
            waitingPlayer = null;
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server ${PORT}-portda ishlayapti`);
});

// Telegram Bot
const BOT_TOKEN = '8809424395:AAFRdNm6HG168dtZzRDfrmqqM4fm1fsq708';
const GAME_URL = 'https://qalampir-game.onrender.com';
const bot = new Telegraf(BOT_TOKEN);

bot.start((ctx) => {
    ctx.reply(
        `Xush kelibsiz, ${ctx.from.first_name}! 🌶️ Jonli raqib topish o'yiniga tayyormisiz?`,
        Markup.inlineKeyboard([
            [Markup.button.webApp("🎮 O'yinni Boshlash", GAME_URL)]
        ])
    );
});

bot.launch().catch(err => {
    console.log("Bot xatosi:", err.message);
});
