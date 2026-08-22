const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

const app = express();

app.use(cors());
app.use(express.json());

// index.html joylashuvini tekshirish (ildizda yoki public papkasida)
app.get('/', (req, res) => {
    const rootPath = path.join(__dirname, 'index.html');
    const publicPath = path.join(__dirname, 'public', 'index.html');

    if (fs.existsSync(rootPath)) {
        res.sendFile(rootPath);
    } else if (fs.existsSync(publicPath)) {
        res.sendFile(publicPath);
    } else {
        res.status(404).send('index.html fayli topilmadi!');
    }
});

// Statik fayllarni ulash
app.use(express.static(__dirname));
app.use(express.static(path.join(__dirname, 'public')));

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

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server ${PORT}-portda ishlayapti`);
});

// Telegram Botni parallel ravishda yurgizish
require('./bot');
