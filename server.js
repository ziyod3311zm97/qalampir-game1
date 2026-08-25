const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

const PORT = process.env.PORT || 3000;

// Agar frontend (index.html) shu repo ichida /public papkasida bo'lsa, shu orqali serve qilinadi.
app.use(express.static(path.join(__dirname, "public")));

app.get("/health", (req, res) => {
    res.json({ status: "ok", rooms: Object.keys(rooms).length });
});

/* =========================================================
   O'YIN HOLATI (IN-MEMORY)
========================================================= */

// rooms[roomId] = {
//   id, code, isPrivate, phase: 'waiting'|'placing'|'battle'|'ended',
//   players: [ { socketId, userId, name, spot, isBot } ],
//   turn: socketId
// }
const rooms = {};

// Tasodifiy o'yin uchun navbat: { socket, user }
let waitingQueue = null;
let waitingTimeout = null;

const GRID_SIZE = 6;

/* =========================================================
   YORDAMCHI FUNKSIYALAR
========================================================= */

function generateRoomId() {
    return "r_" + Math.random().toString(36).slice(2, 10);
}

function generateRoomCode() {
    let code;
    do {
        code = String(Math.floor(1000 + Math.random() * 9000));
    } while (Object.values(rooms).some(r => r.code === code));
    return code;
}

function randomSpot() {
    return Math.floor(Math.random() * GRID_SIZE);
}

function getOpponent(room, socketId) {
    return room.players.find(p => p.socketId !== socketId);
}

function getPlayer(room, socketId) {
    return room.players.find(p => p.socketId === socketId);
}

function publicUser(p) {
    return { id: p.userId, first_name: p.name };
}

function bothPlayersReady(room) {
    return room.players.length === 2 && room.players.every(p => p.spot !== undefined && p.spot !== -1);
}

// O'yinni jangga o'tkazish (ikkala tomon ham joy tanlagandan keyin)
function startBattle(room) {
    room.phase = "battle";

    const first = room.players[Math.floor(Math.random() * 2)];
    room.turn = first.socketId;

    room.players.forEach(p => {
        if (!p.isBot) {
            io.to(p.socketId).emit("battleStart", { turn: first.socketId });
        }
    });

    // Agar birinchi navbat botga tegsa, bot avtomatik hujum qiladi
    if (first.isBot) {
        scheduleBotAttack(room);
    }
}

// Bot uchun random joy va random hujum
function scheduleBotAttack(room) {
    setTimeout(() => {
        if (!rooms[room.id] || room.phase !== "battle") return;
        const bot = room.players.find(p => p.isBot);
        const human = room.players.find(p => !p.isBot);
        if (!bot || !human) return;

        const usedSpots = room._botUsedSpots || (room._botUsedSpots = new Set());
        let spot;
        do {
            spot = randomSpot();
        } while (usedSpots.has(spot) && usedSpots.size < GRID_SIZE);
        usedSpots.add(spot);

        handleAttack(room, bot.socketId, spot);
    }, 900 + Math.random() * 900);
}

function endRoom(roomId) {
    delete rooms[roomId];
}

/* =========================================================
   HUJUM MANTIG'I (umumiy: odam ham, bot ham ishlatadi)
========================================================= */

function handleAttack(room, attackerSocketId, spot) {
    if (room.phase !== "battle") return;
    if (room.turn !== attackerSocketId) return;

    const attacker = getPlayer(room, attackerSocketId);
    const defender = getOpponent(room, attackerSocketId);
    if (!attacker || !defender) return;

    const isHit = defender.spot === spot;

    if (isHit) {
        room.phase = "ended";

        // G'olib va mag'lub bo'lgan odamlarga alohida xabar (winner har doim bitta socketId)
        room.players.forEach(p => {
            if (!p.isBot) {
                io.to(p.socketId).emit("gameOver", {
                    winner: attacker.socketId,
                    hitSpot: spot
                });
            }
        });

        setTimeout(() => endRoom(room.id), 5000);
        return;
    }

    // Miss — navbat almashadi
    const nextPlayer = defender;
    room.turn = nextPlayer.socketId;

    room.players.forEach(p => {
        if (!p.isBot) {
            io.to(p.socketId).emit("turnChanged", {
                attacker: attacker.socketId,
                spot,
                nextTurn: nextPlayer.socketId
            });
        }
    });

    if (nextPlayer.isBot) {
        scheduleBotAttack(room);
    }
}

/* =========================================================
   SOCKET.IO ULANISHLARI
========================================================= */

io.on("connection", socket => {

    /* ---------- TASODIFIY O'YIN ---------- */

    socket.on("joinRandomGame", userData => {
        const user = userData || {};

        // Navbatda kimdir kutayotgan bo'lsa — moslashtiramiz
        if (waitingQueue && waitingQueue.socket.connected) {
            clearTimeout(waitingTimeout);

            const p1 = waitingQueue;
            waitingQueue = null;

            const roomId = generateRoomId();
            const room = {
                id: roomId,
                code: null,
                isPrivate: false,
                phase: "placing",
                players: [
                    { socketId: p1.socket.id, userId: p1.user.id, name: p1.user.first_name, spot: -1, isBot: false },
                    { socketId: socket.id, userId: user.id, name: user.first_name, spot: -1, isBot: false }
                ],
                turn: null
            };

            rooms[roomId] = room;

            p1.socket.join(roomId);
            socket.join(roomId);

            io.to(p1.socket.id).emit("gameMatched", { roomId, opponent: publicUser(room.players[1]) });
            io.to(socket.id).emit("gameMatched", { roomId, opponent: publicUser(room.players[0]) });

            return;
        }

        // Bo'sh — navbatga qo'yamiz va 6 soniya botni kutamiz
        waitingQueue = { socket, user };
        socket.emit("waitingForOpponent");

        waitingTimeout = setTimeout(() => {
            if (!waitingQueue || waitingQueue.socket.id !== socket.id) return;

            waitingQueue = null;

            const roomId = generateRoomId();
            const room = {
                id: roomId,
                code: null,
                isPrivate: false,
                phase: "placing",
                players: [
                    { socketId: socket.id, userId: user.id, name: user.first_name, spot: -1, isBot: false },
                    { socketId: "bot_" + roomId, userId: "bot", name: "Bot 🤖", spot: randomSpot(), isBot: true }
                ],
                turn: null
            };

            rooms[roomId] = room;
            socket.join(roomId);

            io.to(socket.id).emit("gameMatched", {
                roomId,
                opponent: publicUser(room.players[1])
            });
        }, 6000);
    });

    /* ---------- XUSUSIY XONA YARATISH ---------- */

    socket.on("createPrivateRoom", userData => {
        const user = userData || {};
        const roomId = generateRoomId();
        const code = generateRoomCode();

        const room = {
            id: roomId,
            code,
            isPrivate: true,
            phase: "waiting",
            players: [
                { socketId: socket.id, userId: user.id, name: user.first_name, spot: -1, isBot: false }
            ],
            turn: null
        };

        rooms[roomId] = room;
        socket.join(roomId);

        socket.emit("roomCreated", { roomId, roomCode: code });
    });

    /* ---------- XUSUSIY XONAGA QO'SHILISH ---------- */

    socket.on("joinPrivateRoom", ({ roomCode, userData } = {}) => {
        const user = userData || {};
        const room = Object.values(rooms).find(r => r.isPrivate && r.code === roomCode);

        if (!room) {
            socket.emit("errorMsg", "Bunday kodli xona topilmadi!");
            return;
        }

        if (room.players.length >= 2) {
            socket.emit("errorMsg", "Xona allaqachon to'ldirilgan!");
            return;
        }

        room.players.push({
            socketId: socket.id,
            userId: user.id,
            name: user.first_name,
            spot: -1,
            isBot: false
        });

        room.phase = "placing";
        socket.join(room.id);

        io.to(room.players[0].socketId).emit("gameMatched", {
            roomId: room.id,
            opponent: publicUser(room.players[1])
        });

        io.to(room.players[1].socketId).emit("gameMatched", {
            roomId: room.id,
            opponent: publicUser(room.players[0])
        });
    });

    /* ---------- QALAMPIRNI YASHIRISH ---------- */

    socket.on("setSpot", ({ roomId, spot } = {}) => {
        const room = rooms[roomId];
        if (!room || room.phase !== "placing") return;

        const player = getPlayer(room, socket.id);
        if (!player) return;

        if (typeof spot !== "number" || spot < 0 || spot >= GRID_SIZE) return;

        player.spot = spot;

        if (bothPlayersReady(room)) {
            startBattle(room);
        }
    });

    /* ---------- HUJUM ---------- */

    socket.on("attackSpot", ({ roomId, spot } = {}) => {
        const room = rooms[roomId];
        if (!room) return;
        if (typeof spot !== "number" || spot < 0 || spot >= GRID_SIZE) return;

        handleAttack(room, socket.id, spot);
    });

    /* ---------- ULANISH UZILGANDA ---------- */

    socket.on("disconnect", () => {
        // Navbatdan chiqarish
        if (waitingQueue && waitingQueue.socket.id === socket.id) {
            clearTimeout(waitingTimeout);
            waitingQueue = null;
        }

        // Agar biror faol xonada bo'lsa — raqibiga xabar beramiz va xonani tugatamiz
        const room = Object.values(rooms).find(r => r.players.some(p => p.socketId === socket.id));
        if (!room) return;

        const opponent = getOpponent(room, socket.id);

        if (opponent && !opponent.isBot && room.phase !== "ended") {
            io.to(opponent.socketId).emit("errorMsg", "Raqib o'yindan chiqib ketdi.");
        }

        endRoom(room.id);
    });
});

/* =========================================================
   SERVERNI ISHGA TUSHIRISH
========================================================= */

server.listen(PORT, () => {
    console.log(`Qalampir server ${PORT}-portda ishga tushdi`);
});
