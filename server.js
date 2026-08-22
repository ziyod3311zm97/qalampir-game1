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

// HTML tayyorlash
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

// Balans tizimi
const usersDB = {};

app.post('/game_result', (req, res) => {
    const { user_id, result } = req.body;
    if (!user_id) return res.status(400).json({ status: 'error', message: 'user_id yo\'q' });

    if (!usersDB[user_id]) usersDB[user_id] = 10;

    if (result === 'win') usersDB[user_id] += 8;
    else if (result === 'loss') usersDB[user_id] -= 10;

    return res.json({ status: 'success', new_balance: usersDB[user_id] });
});

// MULTIPLAYER VA BOT MANTIQLARI
let waitingPlayer = null;
const rooms = {};
const privateRooms = {};

io.on('connection', (socket) => {
    console.log('O\'yinchi ulandi:', socket.id);

    // 1. TASODIFIY RAQIB YOKI BOT
    socket.on('joinRandomGame', (userData) => {
        if (waitingPlayer && waitingPlayer.socket.id !== socket.id) {
            // Real odam topildi
            clearTimeout(waitingPlayer.botTimer);
            const roomId = `room_${waitingPlayer.socket.id}_${socket.id}`;
            const p1 = waitingPlayer;
            const p2 = { socket, userData };

            rooms[roomId] = {
                players: {
                    [p1.socket.id]: { id: p1.socket.id, user: p1.userData, spot: -1, ready: false, isBot: false },
                    [p2.socket.id]: { id: p2.socket.id, user: p2.userData, spot: -1, ready: false, isBot: false }
                },
                turn: p1.socket.id,
                isBotGame: false
            };

            p1.socket.join(roomId);
            p2.socket.join(roomId);

            p1.socket.emit('gameMatched', { roomId, opponent: p2.userData, myId: p1.socket.id });
            p2.socket.emit('gameMatched', { roomId, opponent: p1.userData, myId: p2.socket.id });

            waitingPlayer = null;
        } else {
            // Kutish va Bot taymerini yoqish (6 soniya)
            const botTimer = setTimeout(() => {
                if (waitingPlayer && waitingPlayer.socket.id === socket.id) {
                    startBotGame(socket, userData);
                    waitingPlayer = null;
                }
            }, 6000);

            waitingPlayer = { socket, userData, botTimer };
            socket.emit('waitingForOpponent');
        }
    });

    // BOT GAME YARATISH
    function startBotGame(playerSocket, userData) {
        const roomId = `bot_room_${playerSocket.id}`;
        const botId = `bot_${Date.now()}`;
        const botSpot = Math.floor(Math.random() * 6);

        rooms[roomId] = {
            players: {
                [playerSocket.id]: { id: playerSocket.id, user: userData, spot: -1, ready: false, isBot: false },
                [botId]: { id: botId, user: { first_name: "Smart Bot 🤖" }, spot: botSpot, ready: true, isBot: true }
            },
            turn: playerSocket.id,
            isBotGame: true,
            botId: botId,
            botSpot: botSpot,
            botAttackedSpots: []
        };

        playerSocket.join(roomId);
        playerSocket.emit('gameMatched', { roomId, opponent: { first_name: "Smart Bot 🤖" }, myId: playerSocket.id });
    }

    // 2. DO'ST BILAN O'YNASH (PRIVATE ROOM)
    socket.on('createPrivateRoom', (userData) => {
        const roomCode = Math.floor(1000 + Math.random() * 9000).toString(); // 4 xonali kod
        privateRooms[roomCode] = {
            p1: { socket, userData },
            p2: null
        };
        socket.emit('roomCreated', { roomCode });
    });

    socket.on('joinPrivateRoom', ({ roomCode, userData }) => {
        const pRoom = privateRooms[roomCode];
        if (pRoom && !pRoom.p2) {
            const roomId = `private_${roomCode}`;
            const p1 = pRoom.p1;
            const p2 = { socket, userData };

            rooms[roomId] = {
                players: {
                    [p1.socket.id]: { id: p1.socket.id, user: p1.userData, spot: -1, ready: false, isBot: false },
                    [p2.socket.id]: { id: p2.socket.id, user: p2.userData, spot: -1, ready: false, isBot: false }
                },
                turn: p1.socket.id,
                isBotGame: false
            };

            p1.socket.join(roomId);
            p2.socket.join(roomId);

            p1.socket.emit('gameMatched', { roomId, opponent: p2.userData, myId: p1.socket.id });
            p2.socket.emit('gameMatched', { roomId, opponent: p1.userData, myId: p2.socket.id });

            delete privateRooms[roomCode];
        } else {
            socket.emit('errorMsg', "Xona kodi noto'g'ri yoki xona to'la!");
        }
    });

    // QALAMPIRNI YASHIRISH
    socket.on('setSpot', ({ roomId, spot }) => {
        const room = rooms[roomId];
        if (!room) return;

        room.players[socket.id].spot = spot;
        room.players[socket.id].ready = true;

        if (room.isBotGame) {
            // Bot o'yini bo'lsa darhol jangni boshlash
            io.to(roomId).emit('battleStart', { turn: room.turn });
        } else {
            const playerIds = Object.keys(room.players);
            if (room.players[playerIds[0]].ready && room.players[playerIds[1]].ready) {
                io.to(roomId).emit('battleStart', { turn: room.turn });
            }
        }
    });

    // HUJUM QILISH
    socket.on('attackSpot', ({ roomId, spot }) => {
        const room = rooms[roomId];
        if (!room || room.turn !== socket.id) return;

        const playerIds = Object.keys(room.players);
        const enemyId = playerIds.find(id => id !== socket.id);
        const enemySpot = room.players[enemyId].spot;

        if (spot === enemySpot) {
            // Yutdi
            io.to(roomId).emit('gameOver', { winner: socket.id, hitSpot: spot });
            delete rooms[roomId];
        } else {
            // O'tkazib yubordi, navbat almashadi
            room.turn = enemyId;
            io.to(roomId).emit('turnChanged', { attacker: socket.id, spot, nextTurn: enemyId });

            // Agar navbat BOTga o'tsa
            if (room.isBotGame && enemyId === room.botId) {
                setTimeout(() => { handleBotTurn(roomId, socket.id); }, 1500);
            }
        }
    });

    // BOTNING ZAKOVATLI NAVBATI (50/50 MANTIQ)
    function handleBotTurn(roomId, humanId) {
        const room = rooms[roomId];
        if (!room) return;

        const humanSpot = room.players[humanId].spot;
        const available = [0, 1, 2, 3, 4, 5].filter(s => !room.botAttackedSpots.includes(s));

        // 50% imkoniyat bilan aniq urish yoki tasodifiy tanlash
        const isSmartAttack = Math.random() < 0.5;
        let chosenSpot;

        if (isSmartAttack && available.includes(humanSpot)) {
            chosenSpot = humanSpot; // Aniq topdi
        } else {
            const wrongSpots = available.filter(s => s !== humanSpot);
            chosenSpot = wrongSpots.length > 0 ? wrongSpots[Math.floor(Math.random() * wrongSpots.length)] : humanSpot;
        }

        room.botAttackedSpots.push(chosenSpot);

        if (chosenSpot === humanSpot) {
            // Bot yutdi
            io.to(roomId).emit('gameOver', { winner: room.botId, hitSpot: chosenSpot });
            delete rooms[roomId];
        } else {
            // Bot xato qildi
            room.turn = humanId;
            io.to(roomId).emit('turnChanged', { attacker: room.botId, spot: chosenSpot, nextTurn: humanId });
        }
    }

    socket.on('disconnect', () => {
        if (waitingPlayer && waitingPlayer.socket.id === socket.id) {
            clearTimeout(waitingPlayer.botTimer);
            waitingPlayer = null;
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server ${PORT}-portda ishlamoqda`));

// Telegram Bot
const BOT_TOKEN = '8809424395:AAFRdNm6HG168dtZzRDfrmqqM4fm1fsq708';
const GAME_URL = 'https://qalampir-game.onrender.com';
const bot = new Telegraf(BOT_TOKEN);

bot.start((ctx) => {
    ctx.reply(
        `Xush kelibsiz, ${ctx.from.first_name}! 🌶️ Qalampir Topish o'yiniga tayyormisiz?`,
        Markup.inlineKeyboard([[Markup.button.webApp("🎮 O'yinni Boshlash", GAME_URL)]])
    );
});
bot.launch().catch(() => {});
