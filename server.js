const express = require('express');
const cors = require('cors');
const path = require('path');

const app = express();

app.use(cors());
app.use(express.json());

// Asosiy sahifaga kirganda to'g'ridan-to'g'ri index.html ni beradi
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// Statik fayllar uchun
app.use(express.static(__dirname));

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

require('./bot');
