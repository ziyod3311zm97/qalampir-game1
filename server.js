const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");

const {
    initDatabase,
    getOrCreateUser,
    updateGameStats,
    getLeaderboard
} = require("./db");

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// =========================================================
// DATABASE
// =========================================================

let databaseReady = false;

initDatabase()
    .then(() => {
        databaseReady = true;
        console.log("PostgreSQL database tayyor.");
    })
    .catch((error) => {
        console.error("PostgreSQL ulanish xatosi:", error);
    });

// =========================================================
// HEALTH
// =========================================================

app.get("/health", (req, res) => {
    res.json({
        status: "ok",
        database: databaseReady ? "connected" : "connecting",
        rooms: Object.keys(rooms).length
    });
});

// =========================================================
// LEADERBOARD API
// =========================================================

app.get("/api/leaderboard", async (req, res) => {
    try {
        const limit = Math.min(
            Math.max(parseInt(req.query.limit) || 10, 1),
            100
        );

        const leaderboard = await getLeaderboard(limit);

        res.json({
            success: true,
            leaderboard
        });
    } catch (error) {
        console.error("Leaderboard xatosi:", error);

        res.status(500).json({
            success: false,
            message: "Leaderboardni olishda xatolik"
        });
    }
});

// =========================================================
// USER API
// =========================================================

app.post("/api/user", async (req, res) => {
    try {
        const {
            id,
            username,
            first_name
        } = req.body || {};

        if (!id) {
            return res.status(400).json({
                success: false,
                message: "Telegram user ID kerak"
            });
        }

        const user = await getOrCreateUser({
            telegramId: id,
            username: username || null,
            firstName: first_name || "Player"
        });

        res.json({
            success: true,
            user
        });
    } catch (error) {
        console.error("User API xatosi:", error);

        res.status(500).json({
            success: false,
            message: "Userni saqlashda xatolik"
        });
    }
});

// =========================================================
// O'YIN HOLATI
// =========================================================

// rooms[roomId] = {
//   id,
//   code,
//   isPrivate,
//   phase: 'waiting'|'placing'|'battle'|'ended',
//   players: [
//      {
//        socketId,
//        userId,
//        name,
//        spot,
//        isBot
//      }
//   ],
//   turn
// }

const rooms = {};

// Tasodifiy o'yin uchun navbat
let waitingQueue = null;
let waitingTimeout = null;

const GRID_SIZE = 6;

// =========================================================
// YORDAMCHI FUNKSIYALAR
// =========================================================

function generateRoomId() {
    return "r_" + Math.random().toString(36).slice(2, 10);
}

function generateRoomCode() {
    let code;

    do {
        code = String(
            Math.floor(1000 + Math.random() * 9000)
        );
    } while (
        Object.values(rooms).some(
            room => room.code === code
        )
    );

    return code;
}

function randomSpot() {
    return Math.floor(
        Math.random() * GRID_SIZE
    );
}

function getOpponent(room, socketId) {
    return room.players.find(
        player => player.socketId !== socketId
    );
}

function getPlayer(room, socketId) {
    return room.players.find(
        player => player.socketId === socketId
    );
}

function publicUser(player) {
    return {
        id: player.userId,
        first_name: player.name
    };
}

function bothPlayersReady(room) {
    return (
        room.players.length === 2 &&
        room.players.every(
            player =>
                player.spot !== undefined &&
                player.spot !== -1
        )
    );
}

// =========================================================
// DATABASE USER
// =========================================================

async function loadUser(userData = {}) {
    if (!userData.id) {
        throw new Error(
            "Telegram user ID topilmadi"
        );
    }

    const user = await getOrCreateUser({
        telegramId: userData.id,
        username: userData.username || null,
        firstName:
            userData.first_name || "Player"
    });

    return user;
}

// =========================================================
// O'YINNI BOSHLASH
// =========================================================

function startBattle(room) {
    room.phase = "battle";

    const first =
        room.players[
            Math.floor(
                Math.random() * 2
            )
        ];

    room.turn = first.socketId;

    room.players.forEach(player => {
        if (!player.isBot) {
            io.to(player.socketId).emit(
                "battleStart",
                {
                    turn: first.socketId
                }
            );
        }
    });

    // Birinchi navbat botga tegsa
    if (first.isBot) {
        scheduleBotAttack(room);
    }
}

// =========================================================
// BOT HUJUMI
// =========================================================

function scheduleBotAttack(room) {
    setTimeout(() => {
        if (
            !rooms[room.id] ||
            room.phase !== "battle"
        ) {
            return;
        }

        const bot = room.players.find(
            player => player.isBot
        );

        const human = room.players.find(
            player => !player.isBot
        );

        if (!bot || !human) {
            return;
        }

        const usedSpots =
            room._botUsedSpots ||
            (room._botUsedSpots = new Set());

        let spot;

        do {
            spot = randomSpot();
        } while (
            usedSpots.has(spot) &&
            usedSpots.size < GRID_SIZE
        );

        usedSpots.add(spot);

        handleAttack(
            room,
            bot.socketId,
            spot
        );
    }, 900 + Math.random() * 900);
}

// =========================================================
// XONANI YOPISH
// =========================================================

function endRoom(roomId) {
    delete rooms[roomId];
}

// =========================================================
// G'ALABA / MAG'LUBIYATNI DATABASE'GA SAQLASH
// =========================================================

async function saveGameResult(
    room,
    winner
) {
    try {
        for (const player of room.players) {
            if (player.isBot) {
                continue;
            }

            const won =
                player.socketId ===
                winner.socketId;

            // Botga qarshi o'yinda:
            // g'alaba +20 coin
            // mag'lubiyat 0 coin
            const reward = won ? 20 : 0;

            await updateGameStats(
                player.userId,
                won,
                reward
            );
        }

        console.log(
            "Game natijasi database'ga saqlandi."
        );
    } catch (error) {
        console.error(
            "Game natijasini saqlash xatosi:",
            error
        );
    }
}

// =========================================================
// HUJUM MANTIG'I
// =========================================================

function handleAttack(
    room,
    attackerSocketId,
    spot
) {
    if (room.phase !== "battle") {
        return;
    }

    if (room.turn !== attackerSocketId) {
        return;
    }

    const attacker = getPlayer(
        room,
        attackerSocketId
    );

    const defender = getOpponent(
        room,
        attackerSocketId
    );

    if (!attacker || !defender) {
        return;
    }

    const isHit =
        defender.spot === spot;

    // =====================================================
    // URILDI
    // =====================================================

    if (isHit) {
        room.phase = "ended";

        room.players.forEach(player => {
            if (!player.isBot) {
                io.to(player.socketId).emit(
                    "gameOver",
                    {
                        winner:
                            attacker.socketId,
                        hitSpot: spot
                    }
                );
            }
        });

        // Database'ga saqlash
        saveGameResult(
            room,
            attacker
        );

        setTimeout(() => {
            endRoom(room.id);
        }, 5000);

        return;
    }

    // =====================================================
    // MISS
    // =====================================================

    const nextPlayer = defender;

    room.turn =
        nextPlayer.socketId;

    room.players.forEach(player => {
        if (!player.isBot) {
            io.to(player.socketId).emit(
                "turnChanged",
                {
                    attacker:
                        attacker.socketId,
                    spot,
                    nextTurn:
                        nextPlayer.socketId
                }
            );
        }
    });

    if (nextPlayer.isBot) {
        scheduleBotAttack(room);
    }
}

// =========================================================
// SOCKET.IO
// =========================================================

io.on("connection", socket => {

    console.log(
        "Player connected:",
        socket.id
    );

    // =====================================================
    // TASODIFIY O'YIN
    // =====================================================

    socket.on(
        "joinRandomGame",
        async userData => {

            try {

                const user =
                    await loadUser(
                        userData
                    );

                socket.user = user;

                // Navbatda player bor
                if (
                    waitingQueue &&
                    waitingQueue.socket.connected
                ) {

                    clearTimeout(
                        waitingTimeout
                    );

                    const p1 =
                        waitingQueue;

                    waitingQueue = null;

                    const roomId =
                        generateRoomId();

                    const room = {
                        id: roomId,
                        code: null,
                        isPrivate: false,
                        phase: "placing",

                        players: [
                            {
                                socketId:
                                    p1.socket.id,
                                userId:
                                    p1.user.id,
                                name:
                                    p1.user.first_name,
                                spot: -1,
                                isBot: false
                            },

                            {
                                socketId:
                                    socket.id,
                                userId:
                                    user.telegram_id,
                                name:
                                    user.first_name,
                                spot: -1,
                                isBot: false
                            }
                        ],

                        turn: null
                    };

                    rooms[roomId] =
                        room;

                    p1.socket.join(
                        roomId
                    );

                    socket.join(
                        roomId
                    );

                    io.to(
                        p1.socket.id
                    ).emit(
                        "gameMatched",
                        {
                            roomId,
                            opponent:
                                publicUser(
                                    room
                                        .players[1]
                                )
                        }
                    );

                    io.to(
                        socket.id
                    ).emit(
                        "gameMatched",
                        {
                            roomId,
                            opponent:
                                publicUser(
                                    room
                                        .players[0]
                                )
                        }
                    );

                    return;
                }

                // Birinchi player navbatga tushadi
                waitingQueue = {
                    socket,
                    user
                };

                socket.emit(
                    "waitingForOpponent"
                );

                waitingTimeout =
                    setTimeout(() => {

                        if (
                            !waitingQueue ||
                            waitingQueue.socket.id !==
                                socket.id
                        ) {
                            return;
                        }

                        waitingQueue =
                            null;

                        const roomId =
                            generateRoomId();

                        const room = {
                            id: roomId,
                            code: null,
                            isPrivate: false,
                            phase: "placing",

                            players: [
                                {
                                    socketId:
                                        socket.id,
                                    userId:
                                        user.telegram_id,
                                    name:
                                        user.first_name,
                                    spot: -1,
                                    isBot: false
                                },

                                {
                                    socketId:
                                        "bot_" +
                                        roomId,
                                    userId:
                                        "bot",
                                    name:
                                        "Bot 🤖",
                                    spot:
                                        randomSpot(),
                                    isBot: true
                                }
                            ],

                            turn: null
                        };

                        rooms[roomId] =
                            room;

                        socket.join(
                            roomId
                        );

                        io.to(
                            socket.id
                        ).emit(
                            "gameMatched",
                            {
                                roomId,
                                opponent:
                                    publicUser(
                                        room
                                            .players[1]
                                    )
                            }
                        );

                    }, 6000);

            } catch (error) {

                console.error(
                    "Random game error:",
                    error
                );

                socket.emit(
                    "errorMsg",
                    "Userni yuklashda xatolik."
                );
            }
        }
    );

    // =====================================================
    // XUSUSIY XONA YARATISH
    // =====================================================

    socket.on(
        "createPrivateRoom",
        async userData => {

            try {

                const user =
                    await loadUser(
                        userData
                    );

                socket.user = user;

                const roomId =
                    generateRoomId();

                const code =
                    generateRoomCode();

                const room = {
                    id: roomId,
                    code,
                    isPrivate: true,
                    phase: "waiting",

                    players: [
                        {
                            socketId:
                                socket.id,
                            userId:
                                user.telegram_id,
                            name:
                                user.first_name,
                            spot: -1,
                            isBot: false
                        }
                    ],

                    turn: null
                };

                rooms[roomId] =
                    room;

                socket.join(
                    roomId
                );

                socket.emit(
                    "roomCreated",
                    {
                        roomId,
                        roomCode: code
                    }
                );

            } catch (error) {

                console.error(
                    "Private room error:",
                    error
                );

                socket.emit(
                    "errorMsg",
                    "Xona yaratishda xatolik."
                );
            }
        }
    );

    // =====================================================
    // XUSUSIY XONAGA QO'SHILISH
    // =====================================================

    socket.on(
        "joinPrivateRoom",
        async ({
            roomCode,
            userData
        } = {}) => {

            try {

                const user =
                    await loadUser(
                        userData
                    );

                socket.user = user;

                const room =
                    Object.values(
                        rooms
                    ).find(
                        r =>
                            r.isPrivate &&
                            r.code ===
                                String(
                                    roomCode
                                )
                    );

                if (!room) {
                    socket.emit(
                        "errorMsg",
                        "Bunday kodli xona topilmadi!"
                    );

                    return;
                }

                if (
                    room.players.length >=
                    2
                ) {

                    socket.emit(
                        "errorMsg",
                        "Xona allaqachon to'ldirilgan!"
                    );

                    return;
                }

                room.players.push({
                    socketId:
                        socket.id,
                    userId:
                        user.telegram_id,
                    name:
                        user.first_name,
                    spot: -1,
                    isBot: false
                });

                room.phase =
                    "placing";

                socket.join(
                    room.id
                );

                io.to(
                    room.players[0]
                        .socketId
                ).emit(
                    "gameMatched",
                    {
                        roomId:
                            room.id,
                        opponent:
                            publicUser(
                                room
                                    .players[1]
                            )
                    }
                );

                io.to(
                    room.players[1]
                        .socketId
                ).emit(
                    "gameMatched",
                    {
                        roomId:
                            room.id,
                        opponent:
                            publicUser(
                                room
                                    .players[0]
                            )
                    }
                );

            } catch (error) {

                console.error(
                    "Join private room error:",
                    error
                );

                socket.emit(
                    "errorMsg",
                    "Xonaga qo'shilishda xatolik."
                );
            }
        }
    );

    // =====================================================
    // QALAMPIRNI YASHIRISH
    // =====================================================

    socket.on(
        "setSpot",
        ({
            roomId,
            spot
        } = {}) => {

            const room =
                rooms[roomId];

            if (
                !room ||
                room.phase !==
                    "placing"
            ) {
                return;
            }

            const player =
                getPlayer(
                    room,
                    socket.id
                );

            if (!player) {
                return;
            }

            if (
                typeof spot !==
                    "number" ||
                spot < 0 ||
                spot >= GRID_SIZE
            ) {
                return;
            }

            player.spot =
                spot;

            if (
                bothPlayersReady(
                    room
                )
            ) {
                startBattle(
                    room
                );
            }
        }
    );

    // =====================================================
    // HUJUM
    // =====================================================

    socket.on(
        "attackSpot",
        ({
            roomId,
            spot
        } = {}) => {

            const room =
                rooms[roomId];

            if (!room) {
                return;
            }

            if (
                typeof spot !==
                    "number" ||
                spot < 0 ||
                spot >= GRID_SIZE
            ) {
                return;
            }

            handleAttack(
                room,
                socket.id,
                spot
            );
        }
    );

    // =====================================================
    // DISCONNECT
    // =====================================================

    socket.on(
        "disconnect",
        () => {

            console.log(
                "Player disconnected:",
                socket.id
            );

            // Navbatdan chiqarish
            if (
                waitingQueue &&
                waitingQueue.socket.id ===
                    socket.id
            ) {

                clearTimeout(
                    waitingTimeout
                );

                waitingQueue =
                    null;
            }

            // Faol xonani topish
            const room =
                Object.values(
                    rooms
                ).find(
                    room =>
                        room.players.some(
                            player =>
                                player.socketId ===
                                socket.id
                        )
                );

            if (!room) {
                return;
            }

            const opponent =
                getOpponent(
                    room,
                    socket.id
                );

            if (
                opponent &&
                !opponent.isBot &&
                room.phase !==
                    "ended"
            ) {

                io.to(
                    opponent.socketId
                ).emit(
                    "errorMsg",
                    "Raqib o'yindan chiqib ketdi."
                );
            }

            endRoom(
                room.id
            );
        }
    );
});

// =========================================================
// SERVER
// =========================================================

server.listen(
    PORT,
    "0.0.0.0",
    () => {
        console.log(
            `Qalampir server ${PORT}-portda ishga tushdi`
        );
    }
);
