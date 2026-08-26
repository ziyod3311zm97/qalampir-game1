const { Pool } = require("pg");

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false
  }
});

pool.on("error", (err) => {
  console.error("PostgreSQL pool error:", err);
});

async function query(text, params = []) {
  const result = await pool.query(text, params);
  return result;
}

async function initDatabase() {
  await query(`
    CREATE TABLE IF NOT EXISTS users (
      id BIGSERIAL PRIMARY KEY,
      telegram_id BIGINT UNIQUE NOT NULL,
      username TEXT,
      first_name TEXT,
      coins BIGINT NOT NULL DEFAULT 100,
      wins INTEGER NOT NULL DEFAULT 0,
      losses INTEGER NOT NULL DEFAULT 0,
      streak INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS transactions (
      id BIGSERIAL PRIMARY KEY,
      telegram_id BIGINT NOT NULL,
      amount BIGINT NOT NULL,
      type TEXT NOT NULL,
      description TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await query(`
    CREATE INDEX IF NOT EXISTS idx_transactions_telegram_id
    ON transactions(telegram_id);
  `);

  console.log("PostgreSQL database tayyor.");
}

async function getUser(telegramId) {
  const result = await query(
    `SELECT * FROM users WHERE telegram_id = $1`,
    [telegramId]
  );

  return result.rows[0] || null;
}

async function createUser({
  telegramId,
  username = null,
  firstName = null
}) {
  const result = await query(
    `
    INSERT INTO users (
      telegram_id,
      username,
      first_name
    )
    VALUES ($1, $2, $3)
    ON CONFLICT (telegram_id)
    DO UPDATE SET
      username = EXCLUDED.username,
      first_name = EXCLUDED.first_name,
      updated_at = NOW()
    RETURNING *
    `,
    [telegramId, username, firstName]
  );

  return result.rows[0];
}

async function getOrCreateUser(userData) {
  const existing = await getUser(userData.telegramId);

  if (existing) {
    return existing;
  }

  return createUser(userData);
}

async function updateBalance(telegramId, amount, type, description = null) {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const userResult = await client.query(
      `
      UPDATE users
      SET
        coins = coins + $1,
        updated_at = NOW()
      WHERE telegram_id = $2
      RETURNING *
      `,
      [amount, telegramId]
    );

    if (userResult.rows.length === 0) {
      throw new Error("User topilmadi");
    }

    await client.query(
      `
      INSERT INTO transactions (
        telegram_id,
        amount,
        type,
        description
      )
      VALUES ($1, $2, $3, $4)
      `,
      [telegramId, amount, type, description]
    );

    await client.query("COMMIT");

    return userResult.rows[0];
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function updateGameStats(
  telegramId,
  won,
  reward = 0
) {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const result = await client.query(
      `
      UPDATE users
      SET
        coins = coins + $1,
        wins = wins + $2,
        losses = losses + $3,
        streak = CASE
          WHEN $2 = 1 THEN streak + 1
          ELSE 0
        END,
        updated_at = NOW()
      WHERE telegram_id = $4
      RETURNING *
      `,
      [
        reward,
        won ? 1 : 0,
        won ? 0 : 1,
        telegramId
      ]
    );

    if (result.rows.length === 0) {
      throw new Error("User topilmadi");
    }

    if (reward !== 0) {
      await client.query(
        `
        INSERT INTO transactions (
          telegram_id,
          amount,
          type,
          description
        )
        VALUES ($1, $2, $3, $4)
        `,
        [
          telegramId,
          reward,
          won ? "game_win" : "game_loss",
          won ? "O'yinda g'alaba" : "O'yinda mag'lubiyat"
        ]
      );
    }

    await client.query("COMMIT");

    return result.rows[0];
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function getLeaderboard(limit = 10) {
  const result = await query(
    `
    SELECT
      telegram_id,
      username,
      first_name,
      coins,
      wins,
      losses,
      streak
    FROM users
    ORDER BY coins DESC
    LIMIT $1
    `,
    [limit]
  );

  return result.rows;
}

module.exports = {
  pool,
  query,
  initDatabase,
  getUser,
  createUser,
  getOrCreateUser,
  updateBalance,
  updateGameStats,
  getLeaderboard
};
