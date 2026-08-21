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
const ADMIN_ID = 867914430; // <-- BU YERGA O'ZINGIZNING TELEGRAM USER_ID NINGIZNI YOZING

const bot = new TelegramBot(TOKEN, { polling: true });

// SQLite Ma'lumotlar Bazasi
const db = new sqlite3.Database('./database.db', (err) => {
    if (err) console.error("Database ulanishda xato:", err.message);
    else console.log("SQLite Bazasiga muvaffaqiyatli ulandi.");
});

// Baza jadvallarini yaratish
db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY,
        username TEXT,
        stars INTEGER DEFAULT 20,
        wins INTEGER DEFAULT 0,
        losses INTEGER DEFAULT 0,
        referrer_id INTEGER,
        last_login TEXT,
        streak INTEGER DEFAULT 0,
        played_today INTEGER DEFAULT 0
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS admin_stats (
        id INTEGER PRIMARY KEY DEFAULT 1,
        total_commission REAL DEFAULT 0,
        bot_profit REAL DEFAULT 0
    )`);
    db.run(`INSERT OR IGNORE INTO admin_stats (id, total_commission, bot_profit) VALUES (1, 0, 0)`);
});

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

// Soxta Bot (Robot) foydalanuvchilar ismlari ro'yxati
const BOT_NAMES = [
    "Jasur_Uz", "Sardor_99", "Otabek_Real", "Malika_Toshkent", "Feruzbek_01",
    "Shoxruh_King", "Ziyod_777", "Azamat_Pro", "Dilshod_Alimov", "Anvar_Gamer",
    "Madina_Tohirova", "Nodirbek_2026", "Rustam_Chil"
];

// Telegram Bot Sozlamalari & Referral
bot.onText(/\/start(?:\s+(.+))?/, (msg, match) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    const username = msg.from.username || msg.from.first_name;
    const refId = match[1] ? parseInt(match[1]) : null;

    db.get(`SELECT * FROM users WHERE id = ?`, [userId], (err, row) => {
        if (!row) {
            db.run(`INSERT INTO users (id, username, stars, referrer_id) VALUES (?, ?, 20, ?)`, 
                [userId, username, (refId && refId !== userId) ? refId : null], (err) => {
                    if (!err && refId && refId !== userId) {
                        db.run(`UPDATE users SET stars = stars + 5 WHERE id = ?`, [refId]);
                        bot.sendMessage(refId, `🎉 Taklif qilgan do'stingiz (${username}) ro'yxatdan o'tdi! Sizga +5 ⭐️ bonus berildi!`);
                    }
                });
        }
    });

    bot.sendMessage(chatId, `Salom ${msg.from.first_name}! 🌶️ "Qalampir Top" o'yiniga xush kelibsiz!`, {
        reply_markup: {
            inline_keyboard: [[
                { text: "🌶️ O'ynash (Telegram Stars)", web_app: { url: `${APP_URL}?user_id=${userId}` } }
            ]]
        }
    });
});

// Admin Panel Buyrug'i
bot.onText(/\/admin/, (msg) => {
    if (msg.from.id !== ADMIN_ID) return;

    db.get(`SELECT COUNT(*) as total_users FROM users`, [], (err, uRow) => {
        db.get(`SELECT * FROM admin_stats WHERE id = 1`, [], (err, sRow) => {
            const onlineCount = io.engine.clientsCount;
            const text = `📊 **ADMIN PANEL STATISTIKASI**\n\n` +
                         `👥 Jami foydalanuvchilar: **${uRow ? uRow.total_users : 0}** ta\n` +
                         `🟢 Hozir o'ynamoqda (Online): **${onlineCount}** kishi\n` +
                         `💰 O'yinlardan olingan 2% komissiya: **${sRow ? sRow.total_commission.toFixed(1) : 0}** ⭐️\n` +
                         `🤖 Botlar orqali ishlangan sof foyda (70%): **${sRow ? sRow.bot_profit.toFixed(1) : 0}** ⭐️\n\n` +
                         `🤝 Hamkorlik uchun murojaat: Admin ID: ${ADMIN_ID}`;
            bot.sendMessage(msg.chat.id, text, { parse_mode: 'Markdown' });
        });
    });
});

// API: User ma'lumotlari va Kunlik Bonus
app.get('/api/user/:id', (req, res) => {
    const userId = req.params.id;
    const today = new Date().toISOString().split('T')[0];

    db.get(`SELECT * FROM users WHERE id = ?`, [userId], (err, row) => {
        if (err || !row) {
            res.json({ id: userId, stars: 20, wins: 0, losses: 0, streak: 0, bonusClaimed: false });
        } else {
            let streak = row.streak || 0;
            let bonusClaimed = (row.last_login === today && row.played_today >= 1);
            res.json({ ...row, bonusClaimed });
        }
    });
});

// API: Kunlik bonusni olish
app.post('/api/claim-daily-bonus', (req, res) => {
    const { userId } = req.body;
    const today = new Date().toISOString().split('T')[0];

    db.get(`SELECT * FROM users WHERE id = ?`, [userId], (err, row) => {
        if (!row || row.played_today < 1 || row.last_login === today) {
            return res.json({ success: false, message: "Kunlik bonus olish uchun bugun kamida 1 ta o'yin o'ynashingiz kerak!" });
        }

        let newStreak = (row.streak || 0) + 1;
        if (newStreak > 7) newStreak = 1; // 7 kundan so'ng qayta boshlanadi

        db.run(`UPDATE users SET stars = stars + 1, streak = ?, last_login = ? WHERE id = ?`, [newStreak, today, userId], (err) => {
            res.json({ success: true, message: `1 ⭐️ kunlik bonus berildi! Ketma-ketlik: ${newStreak}-kun.` });
        });
    });
});

// API: TOP-10 Leaderboard
app.get('/api/leaderboard', (req, res) => {
    db.all(`SELECT username, wins, stars FROM users ORDER BY wins DESC, stars DESC LIMIT 10`, [], (err, rows) => {
        res.json(rows || []);
    });
});

// API: Telegram Stars Invoices (Sotib olish)
app.post('/api/buy-stars', async (req, res) => {
    const { userId, starAmount, xtrCost } = req.body;
    try {
        const link = await bot.createInvoiceLink(
            `${starAmount} ta O'yin Yulduzi ⭐️`,
            "Qalampir Top balansini to'ldirish",
            JSON.stringify({ userId, starAmount }),
            "",
            "XTR",
            [{ label: `${starAmount} Stars`, amount: xtrCost }]
        );
        res.json({ success: true, invoiceLink: link });
    } catch (e) {
        res.json({ success: false, message: e.message });
    }
});

bot.on('pre_checkout_query', (q) => bot.answerPreCheckoutQuery(q.id, true));
bot.on('successful_payment', (msg) => {
    const payload = JSON.parse(msg.successful_payment.invoice_payload);
    db.run(`UPDATE users SET stars = stars + ? WHERE id = ?`, [payload.starAmount, payload.userId]);
});

// Socket.io va Xonalar (Rooms) Mantiqi
let rooms = { 10: [], 20: [], 50: [], 100: [], 200: [] };
let activeGames = {};

function startTurnTimer(roomId) {
    const game = activeGames[roomId];
    if (!game) return;
    if (game.timer) clearInterval(game.timer);

    game.timeLeft = 15;
    io.to(roomId).emit('timer_update', { timeLeft: game.timeLeft, turn: game.turn });

    game.timer = setInterval(() => {
        game.timeLeft -= 1;
        io.to(roomId).emit('timer_update', { timeLeft: game.timeLeft, turn: game.turn });

        if (game.timeLeft <= 0) {
            clearInterval(game.timer);
            if (game.isBotGame && game.turn === 'BOT') {
                makeBotMove(roomId);
            } else {
                const playerIds = Object.keys(game.players);
                const nextTurn = playerIds.find(id => id !== game.turn);
                game.turn = nextTurn;
                io.to(roomId).emit('turn_timeout', { nextTurn: game.turn });
                startTurnTimer(roomId);
            }
        }
    }, 1000);
}

function makeBotMove(roomId) {
    const game = activeGames[roomId];
    if (!game || !game.isBotGame) return;

    setTimeout(() => {
        let availableMoves = [];
        for (let i = 0; i < 6; i++) {
            if (!game.botMoves.includes(i)) availableMoves.push(i);
        }
        if (availableMoves.length === 0) return;

        // 70% foyda algoritmi: Bot 70% ehtimollik bilan g'alaba qozonish uchun to'g'ri uradi
        let chosenMove;
        const shouldWin = Math.random() < 0.70;

        if (shouldWin && availableMoves.includes(game.players[game.userSocketId].pepperPos)) {
            chosenMove = game.players[game.userSocketId].pepperPos;
        } else {
            chosenMove = availableMoves[Math.floor(Math.random() * availableMoves.length)];
        }

        game.botMoves.push(chosenMove);

        if (chosenMove === game.players[game.userSocketId].pepperPos) {
            // Bot yutdi
            clearInterval(game.timer);
            io.to(roomId).emit('game_over', { winnerName: game.botName, loserId: game.userId, hitIndex: chosenMove });
            
            db.run(`UPDATE users SET stars = MAX(0, stars - ?), losses = losses + 1 WHERE id = ?`, [game.bet, game.userId]);
            db.run(`UPDATE admin_stats SET bot_profit = bot_profit + ? WHERE id = 1`, [game.bet * 0.7]);
            
            delete activeGames[roomId];
        } else {
            game.turn = game.userSocketId;
            io.to(roomId).emit('move_result', { attackerName: game.botName, cellIndex: chosenMove, hit: false, nextTurn: game.userSocketId });
            startTurnTimer(roomId);
        }
    }, 1500);
}

io.on('connection', (socket) => {

    socket.on('join_room', ({ userId, username, bet, pepperPos }) => {
        socket.userId = userId;
        socket.username = username || `User_${userId}`;
        socket.pepperPos = pepperPos;
        socket.bet = bet;

        db.get(`SELECT stars FROM users WHERE id = ?`, [userId], (err, row) => {
            if (!row || row.stars < bet) {
                return socket.emit('error_msg', "Mablag' yetarli emas! Telegram Stars orqali hisobni to'ldiring.");
            }

            // O'yinlar sonini oshirish (Kunlik bonus uchun)
            db.run(`UPDATE users SET played_today = played_today + 1 WHERE id = ?`, [userId]);

            if (rooms[bet] && rooms[bet].length > 0) {
                // Real odam bilan o'yin
                const opponentSocket = rooms[bet].pop();
                const roomId = `room_${opponentSocket.id}_${socket.id}`;

                socket.join(roomId);
                opponentSocket.join(roomId);

                const totalBet = bet * 2;
                const commission = totalBet * 0.02; // 2% Admin komissiyasi
                const winAmount = totalBet - commission;

                activeGames[roomId] = {
                    bet, winAmount, commission, isBotGame: false,
                    players: {
                        [opponentSocket.id]: { userId: opponentSocket.userId, username: opponentSocket.username, pepperPos: opponentSocket.pepperPos },
                        [socket.id]: { userId: socket.userId, username: socket.username, pepperPos: socket.pepperPos }
                    },
                    turn: opponentSocket.id
                };

                io.to(roomId).emit('game_start', {
                    roomId, turn: opponentSocket.id,
                    p1: { id: opponentSocket.userId, name: opponentSocket.username },
                    p2: { id: socket.userId, name: socket.username }
                });

                startTurnTimer(roomId);
            } else {
                // Navbatga qo'yish va 4 soniyadan so'ng odam topilmasa Bot ulash
                rooms[bet].push(socket);
                socket.emit('waiting', "Raqib izlanmoqda...");

                setTimeout(() => {
                    const index = rooms[bet].indexOf(socket);
                    if (index !== -1) {
                        rooms[bet].splice(index, 1);
                        
                        // Bot o'yinini boshlash
                        const roomId = `room_bot_${socket.id}`;
                        const botName = BOT_NAMES[Math.floor(Math.random() * BOT_NAMES.length)];
                        const botPepperPos = Math.floor(Math.random() * 6);

                        socket.join(roomId);

                        activeGames[roomId] = {
                            bet, winAmount: bet, isBotGame: true,
                            botName, botPepperPos, botMoves: [],
                            userSocketId: socket.id, userId: socket.userId, username: socket.username,
                            players: { [socket.id]: { userId: socket.userId, username: socket.username, pepperPos: socket.pepperPos } },
                            turn: socket.id
                        };

                        socket.emit('game_start', {
                            roomId, turn: socket.id,
                            p1: { id: socket.userId, name: socket.username },
                            p2: { id: 'BOT', name: botName }
                        });

                        startTurnTimer(roomId);
                    }
                }, 4000);
            }
        });
    });

    socket.on('make_move', ({ roomId, cellIndex }) => {
        const game = activeGames[roomId];
        if (!game || game.turn !== socket.id) return;

        clearInterval(game.timer);

        if (game.isBotGame) {
            // Botga qarshi o'yindagi zarba
            if (cellIndex === game.botPepperPos) {
                io.to(roomId).emit('game_over', { winnerName: socket.username, loserId: 'BOT', hitIndex: cellIndex });
                db.run(`UPDATE users SET stars = stars + ?, wins = wins + 1 WHERE id = ?`, [game.bet, socket.userId]);
                delete activeGames[roomId];
            } else {
                game.turn = 'BOT';
                io.to(roomId).emit('move_result', { attackerName: socket.username, cellIndex, hit: false, nextTurn: 'BOT' });
                startTurnTimer(roomId);
                makeBotMove(roomId);
            }
        } else {
            // Real insonga qarshi zarba
            const opponentId = Object.keys(game.players).find(id => id !== socket.id);
            const opponent = game.players[opponentId];

            if (cellIndex === opponent.pepperPos) {
                io.to(roomId).emit('game_over', { winnerName: socket.username, loserId: opponent.userId, hitIndex: cellIndex });

                db.run(`UPDATE users SET stars = stars + ?, wins = wins + 1 WHERE id = ?`, [game.winAmount - game.bet, socket.userId]);
                db.run(`UPDATE users SET stars = MAX(0, stars - ?), losses = losses + 1 WHERE id = ?`, [game.bet, opponent.userId]);
                db.run(`UPDATE admin_stats SET total_commission = total_commission + ? WHERE id = 1`, [game.commission]);

                delete activeGames[roomId];
            } else {
                game.turn = opponentId;
                io.to(roomId).emit('move_result', { attackerName: socket.username, cellIndex, hit: false, nextTurn: opponentId });
                startTurnTimer(roomId);
            }
        }
    });

    socket.on('disconnect', () => {
        for (let bet in rooms) {
            rooms[bet] = rooms[bet].filter(s => s.id !== socket.id);
        }
    });
});

server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
const https = require('https');

// Server o'zini-o'zi uxlashdan saqlaydi
setInterval(() => {
    // APP_URL o'rniga Render'dagi rasmiy domain havolangizni qo'ying
    const url = process.env.APP_URL || 'https://qalampir-bot.onrender.com';
    
    https.get(url, (res) => {
        console.log(`Keep-alive ping yuborildi: Status ${res.statusCode}`);
    }).on('error', (err) => {
        console.error('Ping xatosi:', err.message);
    });
}, 10 * 60 * 1000); // Har 10 daqiqada bir marta

    
