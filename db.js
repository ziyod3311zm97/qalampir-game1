require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL && !process.env.DATABASE_URL.includes('localhost') 
    ? { rejectUnauthorized: false } 
    : false
});

const initDB = async () => {
  const client = await pool.connect();
  try {
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
  } catch (err) {
    console.error('❌ Baza yaratishda xatolik:', err);
  } finally {
    client.release();
  }
};

initDB();

const dbQuery = {
  getUser: async (id) => {
    const res = await pool.query('SELECT * FROM users WHERE telegram_id = $1', [id]);
    return res.rows[0];
  },
  createUser: async (user, referredBy = null) => {
    const res = await pool.query(
      'INSERT INTO users (telegram_id, username, first_name, referred_by) VALUES ($1, $2, $3, $4) RETURNING *',
      [user.id, user.username || '', user.first_name || '', referredBy]
    );
    return res.rows[0];
  },
  updateBalance: async (id, amount, type, desc) => {
    await pool.query('UPDATE users SET balance = balance + $1 WHERE telegram_id = $2', [amount, id]);
    await pool.query(
      'INSERT INTO transactions (telegram_id, amount, type, description) VALUES ($1, $2, $3, $4)',
      [id, amount, type, desc]
    );
    return true;
  },
  updateStats: async (id, isWin) => {
    if (isWin) {
      await pool.query('UPDATE users SET wins = wins + 1, streak = streak + 1 WHERE telegram_id = $1', [id]);
    } else {
      await pool.query('UPDATE users SET losses = losses + 1, streak = 0 WHERE telegram_id = $1', [id]);
    }
  }
};

module.exports = { pool, dbQuery };
