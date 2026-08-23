require('dotenv').config();
const { Pool } = require('pg');

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  console.error("❌ XATOLIK: DATABASE_URL topilmadi!");
}

const pool = new Pool({
  connectionString: connectionString
});

const initDB = async () => {
  try {
    const client = await pool.connect();
    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        telegram_id BIGINT PRIMARY KEY,
        username VARCHAR(255),
        first_name VARCHAR(255),
        balance INT DEFAULT 1000,
        energy INT DEFAULT 5,
        last_energy_update BIGINT DEFAULT EXTRACT(EPOCH FROM NOW()),
        wins INT DEFAULT 0,
        losses INT DEFAULT 0,
        streak INT DEFAULT 0,
        referred_by BIGINT,
        created_at BIGINT DEFAULT EXTRACT(EPOCH FROM NOW())
      );

      CREATE TABLE IF NOT EXISTS transactions (
        id SERIAL PRIMARY KEY,
        telegram_id BIGINT,
        amount INT,
        type VARCHAR(50),
        description TEXT,
        created_at BIGINT DEFAULT EXTRACT(EPOCH FROM NOW())
      );
    `);
    console.log('✅ PostgreSQL bazasi tayyor va jadvallar yaratildi');
    client.release();
  } catch (err) {
    console.error('❌ Baza ulanishida xatolik:', err.message);
  }
};

initDB();

const dbQuery = {
  getUser: async (id) => {
    try {
      const res = await pool.query('SELECT * FROM users WHERE telegram_id = $1', [id]);
      return res.rows[0];
    } catch (err) {
      console.error('getUser xatosi:', err.message);
      return null;
    }
  },
  createUser: async (user, referredBy = null) => {
    try {
      const res = await pool.query(
        'INSERT INTO users (telegram_id, username, first_name, referred_by) VALUES ($1, $2, $3, $4) RETURNING *',
        [user.id, user.username || '', user.first_name || '', referredBy]
      );
      return res.rows[0];
    } catch (err) {
      console.error('createUser xatosi:', err.message);
      return null;
    }
  },
  updateBalance: async (id, amount, type, desc) => {
    try {
      await pool.query('UPDATE users SET balance = balance + $1 WHERE telegram_id = $2', [amount, id]);
      await pool.query(
        'INSERT INTO transactions (telegram_id, amount, type, description) VALUES ($1, $2, $3, $4)',
        [id, amount, type, desc]
      );
      return true;
    } catch (err) {
      console.error('updateBalance xatosi:', err.message);
      return false;
    }
  },
  updateStats: async (id, isWin) => {
    try {
      if (isWin) {
        await pool.query('UPDATE users SET wins = wins + 1, streak = streak + 1 WHERE telegram_id = $1', [id]);
      } else {
        await pool.query('UPDATE users SET losses = losses + 1, streak = 0 WHERE telegram_id = $1', [id]);
      }
    } catch (err) {
      console.error('updateStats xatosi:', err.message);
    }
  }
};

module.exports = { pool, dbQuery };
