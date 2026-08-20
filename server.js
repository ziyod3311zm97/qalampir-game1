const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const TelegramBot = require('node-telegram-bot-api');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

const PORT = process.env.PORT || 3000;
const TOKEN = '8809424395:AAFRdNm6HG168dtZzRDfrmqqM4fm1fsq708';
const APP_URL = 'https://qalampir-game.onrender.com';

const bot = new TelegramBot(TOKEN, { polling: true });

// SQLite Ma'lumotlar Bazasini sozlash
const db = new sqlite3.Database('./database.db', (err) => {
    if (err) console.error("Database ulanishda xato:", err.message);
    else console.log("SQLite Bazasiga muvaffaqiyatli ulandi.");
});

// Foydalanuvchilar va O'yinlar jadvallarini yaratish
db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY,
        username TEXT,
        stars INTEGER DEFAULT 50,
        wins INTEGER DEFAULT 0,
        losses INTEGER DEFAULT 0
    )`);
});

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

// Telegram Bot Sozlamalari
bot.onText(/\/start/, (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    const username = msg.from.username || msg.from.first_name;

    db.run(`INSERT OR IGNORE INTO users (id, username, stars) VALUES (?, ?, 50)`, [userId, username]);

    bot.sendMessage(chatId, `Salom ${msg.from.first_name}! 🌶️ "Qalampir Top" o'yiniga xush kelibsiz!`, {
        reply_markup: {
            inline_keyboard: [[
                { text: "🌶️ O'ynash (PvP Duel)", web_app: { url: `${APP_URL}?user_id=${userId}` } }
            ]]
        }
    });
});

// API: Foydalanuvchi ma'lumotlarini olish (Dashboard uchun)
app.get('/api/user/:id', (req, res) => {
    const userId = req.params.id;
    db.get(`SELECT * FROM users WHERE id = ?`, [userId], (err, row) => {
        if (err || !row) {
            res.json({ id: userId, stars: 50, wins: 0, losses: 0 });
        } else {
            res.json(row);
        }
    });
});

// Real-Time Socket.io Multiplayer Mantiqi
let waitingPlayer = null;
let activeGames = {};

io.on('connection', (socket) => {
    
    socket.on('join_game', ({ userId, pepperPos }) => {
        socket.userId = userId;
        socket.pepperPos = pepperPos;

        if (waitingPlayer && waitingPlayer.id !== socket.id) {
            // Ikkinchi o'yinchi topildi, xona tuzamiz
            const roomId = `room_${waitingPlayer.id}_${socket.id}`;
            const p1 = waitingPlayer;
            const p2 = socket;

            p1.join(roomId);
            p2.join(roomId);

            activeGames[roomId] = {
                players: {
                    [p1.id]: { userId: p1.userId, pepperPos: p1.pepperPos, score: 0 },
                    [p2.id]: { userId: p2.userId, pepperPos: p2.pepperPos, score: 0 }
                },
                turn: p1.id
            };

            io.to(roomId).emit('game_start', {
                roomId,
                turn: p1.id,
                players: {
                    p1: p1.userId,
                    p2: p2.userId
                }
            });

            waitingPlayer = null;
        } else {
            // Birinchi o'yinchi kutish zaliga qo'shiladi
            waitingPlayer = socket;
            socket.emit('waiting', "Raqib izlanmoqda...");
        }
    });

    socket.on('make_move', ({ roomId, cellIndex }) => {
        const game = activeGames[roomId];
        if (!game || game.turn !== socket.id) return;

        const opponentId = Object.keys(game.players).find(id => id !== socket.id);
        const opponent = game.players[opponentId];

        if (cellIndex === opponent.pepperPos) {
            // Qalampir topildi — G'alaba!
            io.to(roomId).emit('game_over', { winner: socket.userId, loser: opponent.userId, hitIndex: cellIndex });
            
            // Bazada balans va statistikani yangilash
            db.run(`UPDATE users SET stars = stars + 10, wins = wins + 1 WHERE id = ?`, [socket.userId]);
            db.run(`UPDATE users SET stars = MAX(0, stars - 10), losses = losses + 1 WHERE id = ?`, [opponent.userId]);

            delete activeGames[roomId];
        } else {
            // Noto'g'ri zarba, navbat raqibga o'tadi
            game.turn = opponentId;
            io.to(roomId).emit('move_result', {
                attacker: socket.userId,
                cellIndex,
                hit: false,
                nextTurn: opponentId
            });
        }
    });

    socket.on('disconnect', () => {
        if (waitingPlayer && waitingPlayer.id === socket.id) {
            waitingPlayer = null;
        }
    });
});

server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
