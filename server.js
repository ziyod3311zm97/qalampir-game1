const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

const app = express();

app.use(cors());
app.use(express.json());

// 1. Asosiy sahifaga So'rov kelganda (/) index.html ni topib berish
app.get('/', (req, res) => {
    const rootIndex = path.join(__dirname, 'index.html');
    const publicIndex = path.join(__dirname, 'public', 'index.html');

    if (fs.existsSync(rootIndex)) {
        return res.sendFile(rootIndex);
    } else if (fs.existsSync(publicIndex)) {
        return res.sendFile(publicIndex);
    } else {
        return res.status(404).send('<h2>index.html fayli topilmadi! GitHub-da fayl nomini tekshiring.</h2>');
    }
});

// Statik papkalarni ulash
app.use(express.static(__dirname));
app.use(express.static(path.join(__dirname, 'public')));

// 2. O'yin natijasini saqlash API
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

// 3. Port sozlamasi
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server ${PORT}-portda ishlamoqda`);
});

// Telegram botni ishga tushirish
try {
    require('./bot');
} catch (e) {
    console.log("Botni yuklashda xato:", e.message);
}
