import { getActiveReadEngine, pool } from "../config/db.js";

export const teamRepository = {
  async ensureTables() {
    const engine = await getActiveReadEngine();

    await pool.query(
      engine === "postgres"
        ? `
          CREATE TABLE IF NOT EXISTS teams (
            id BIGSERIAL PRIMARY KEY,
            name TEXT NOT NULL UNIQUE,
            description TEXT NULL,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
          )
        `
        : `
          CREATE TABLE IF NOT EXISTS teams (
            id BIGINT AUTO_INCREMENT PRIMARY KEY,
            name VARCHAR(255) NOT NULL UNIQUE,
            description TEXT NULL,
            created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
          )
        `,
    );
  },

  async listAll() {
    const [rows] = await pool.query(
      `
      SELECT *
      FROM teams
      ORDER BY name ASC
      `,
    );
    return rows;
  },

  async findById(id) {
    const [rows] = await pool.query(
      `
      SELECT *
      FROM teams
      WHERE id = ?
      LIMIT 1
      `,
      [id],
    );
    return rows[0] ?? null;
  },

  async upsert(payload) {
    await this.ensureTables();
    const engine = await getActiveReadEngine();

    if (payload.id) {
      await pool.query(
        `
        UPDATE teams
        SET
          name = ?,
          description = ?
        WHERE id = ?
        `,
        [payload.name, payload.description ?? null, payload.id],
      );
    } else if (engine === "postgres") {
      await pool.query(
        `
        INSERT INTO teams (name, description)
        VALUES (?, ?)
        ON CONFLICT (name) DO UPDATE
        SET description = EXCLUDED.description
        `,
        [payload.name, payload.description ?? null],
      );
    } else {
      await pool.query(
        `
        INSERT INTO teams (name, description)
        VALUES (?, ?)
        ON DUPLICATE KEY UPDATE
          description = VALUES(description)
        `,
        [payload.name, payload.description ?? null],
      );
    }

    const [rows] = await pool.query(
      `
      SELECT *
      FROM teams
      WHERE ${payload.id ? "id = ?" : "name = ?"}
      LIMIT 1
      `,
      [payload.id ?? payload.name],
    );

    return rows[0] ?? null;
  },
};
