import crypto from "node:crypto";
import { getActiveWriteEngine, pool } from "../config/db.js";

const SESSION_ACTIVITY_TOUCH_INTERVAL_MS = 30 * 1000;

function nowValue() {
  return new Date();
}

export function hashSessionToken(token) {
  return crypto.createHash("sha256").update(String(token)).digest("hex");
}

export const sessionRepository = {
  async ensureTables() {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS auth_sessions (
        id VARCHAR(64) PRIMARY KEY,
        employee_id INT NOT NULL,
        token_hash VARCHAR(128) NOT NULL UNIQUE,
        created_at TIMESTAMP NOT NULL,
        last_activity_at TIMESTAMP NOT NULL,
        revoked_at TIMESTAMP NULL,
        revoke_reason VARCHAR(64) NULL
      )
    `);

    const engine = await getActiveWriteEngine();

    if (engine === "postgres") {
      await pool.query("CREATE INDEX IF NOT EXISTS idx_auth_sessions_employee_id ON auth_sessions (employee_id)");
      await pool.query("CREATE INDEX IF NOT EXISTS idx_auth_sessions_last_activity_at ON auth_sessions (last_activity_at)");
    } else {
      try {
        await pool.query("ALTER TABLE auth_sessions ADD INDEX idx_auth_sessions_employee_id (employee_id)");
      } catch (_error) {
        // MySQL throws when the index already exists.
      }

      try {
        await pool.query("ALTER TABLE auth_sessions ADD INDEX idx_auth_sessions_last_activity_at (last_activity_at)");
      } catch (_error) {
        // MySQL throws when the index already exists.
      }
    }
  },

  async create({ employeeId, tokenHash }) {
    await this.ensureTables();

    const id = crypto.randomUUID().replace(/-/g, "");
    const timestamp = nowValue();

    await pool.query(
      `
      INSERT INTO auth_sessions
        (id, employee_id, token_hash, created_at, last_activity_at, revoked_at, revoke_reason)
      VALUES (?, ?, ?, ?, ?, NULL, NULL)
      `,
      [id, employeeId, tokenHash, timestamp, timestamp],
    );

    return this.findByTokenHash(tokenHash);
  },

  async findByTokenHash(tokenHash) {
    await this.ensureTables();

    const [rows] = await pool.query(
      `
      SELECT *
      FROM auth_sessions
      WHERE token_hash = ?
      LIMIT 1
      `,
      [tokenHash],
    );

    return rows[0] ?? null;
  },

  async touchActivity(id) {
    await this.ensureTables();
    const [rows] = await pool.query(
      `
      SELECT last_activity_at
      FROM auth_sessions
      WHERE id = ?
      LIMIT 1
      `,
      [id],
    );

    const currentLastActivity = rows[0]?.last_activity_at ? new Date(rows[0].last_activity_at) : null;
    if (currentLastActivity && Date.now() - currentLastActivity.getTime() < SESSION_ACTIVITY_TOUCH_INTERVAL_MS) {
      return;
    }

    await pool.query(
      `
      UPDATE auth_sessions
      SET last_activity_at = ?
      WHERE id = ?
      `,
      [nowValue(), id],
    );
  },

  async revoke(id, reason = "signout") {
    await this.ensureTables();
    await pool.query(
      `
      UPDATE auth_sessions
      SET
        revoked_at = COALESCE(revoked_at, ?),
        revoke_reason = COALESCE(revoke_reason, ?)
      WHERE id = ?
      `,
      [nowValue(), reason, id],
    );
  },

  async revokeOtherSessions(employeeId, currentSessionId, reason = "password_changed") {
    await this.ensureTables();
    await pool.query(
      `UPDATE auth_sessions
       SET revoked_at = COALESCE(revoked_at, ?), revoke_reason = COALESCE(revoke_reason, ?)
       WHERE employee_id = ? AND id <> ? AND revoked_at IS NULL`,
      [nowValue(), reason, employeeId, currentSessionId || ""],
    );
  },

  async revokeAllForEmployee(employeeId, reason = "security_reset") {
    await this.ensureTables();
    await pool.query(
      `UPDATE auth_sessions
       SET revoked_at = COALESCE(revoked_at, ?), revoke_reason = COALESCE(revoke_reason, ?)
       WHERE employee_id = ? AND revoked_at IS NULL`,
      [nowValue(), reason, employeeId],
    );
  },
};
