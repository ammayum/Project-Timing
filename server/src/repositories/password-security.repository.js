import { getActiveReadEngine, pool } from "../config/db.js";
import { env } from "../config/env.js";

function expiresAtFromNow(days = env.passwordExpiryDays) {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000);
}

async function ensureEmployeeColumn(engine, columnName, definition) {
  if (engine === "postgres") {
    await pool.query(`ALTER TABLE employees ADD COLUMN IF NOT EXISTS ${columnName} ${definition}`);
    return;
  }

  const [rows] = await pool.query(
    `SELECT COLUMN_NAME
     FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = 'employees'
       AND COLUMN_NAME = ?
     LIMIT 1`,
    [columnName],
  );

  if (!rows[0]) {
    await pool.query(`ALTER TABLE employees ADD COLUMN ${columnName} ${definition}`);
  }
}

export const passwordSecurityRepository = {
  async ensureSchema() {
    const engine = await getActiveReadEngine();
    await ensureEmployeeColumn(engine, "password_changed_at", "TIMESTAMP NULL");
    await ensureEmployeeColumn(engine, "password_expires_at", "TIMESTAMP NULL");
    await ensureEmployeeColumn(engine, "failed_login_count", "INT NOT NULL DEFAULT 0");
    await ensureEmployeeColumn(engine, "locked_until", "TIMESTAMP NULL");
    await ensureEmployeeColumn(engine, "last_login_at", "TIMESTAMP NULL");
    await ensureEmployeeColumn(engine, "active", "BOOLEAN NOT NULL DEFAULT TRUE");

    if (engine === "postgres") {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS password_history (
          id BIGSERIAL PRIMARY KEY,
          employee_id INT NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
          password_hash VARCHAR(512) NOT NULL,
          created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
      `);
      await pool.query("CREATE INDEX IF NOT EXISTS idx_password_history_employee ON password_history (employee_id, created_at)");
    } else {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS password_history (
          id BIGINT AUTO_INCREMENT PRIMARY KEY,
          employee_id INT NOT NULL,
          password_hash VARCHAR(512) NOT NULL,
          created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
          INDEX idx_password_history_employee (employee_id, created_at),
          CONSTRAINT fk_password_history_employee FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE
        )
      `);
    }
  },

  async recordFailedLogin(employeeId) {
    await this.ensureSchema();
    const [rows] = await pool.query("SELECT failed_login_count FROM employees WHERE id = ? LIMIT 1", [employeeId]);
    const failedCount = Number(rows[0]?.failed_login_count || 0) + 1;
    const lockedUntil = failedCount >= env.passwordMaxFailedLogins
      ? new Date(Date.now() + env.passwordLockoutMinutes * 60 * 1000)
      : null;
    await pool.query(
      `UPDATE employees SET failed_login_count = ?, locked_until = COALESCE(?, locked_until) WHERE id = ?`,
      [failedCount, lockedUntil, employeeId],
    );
    return { failedCount, lockedUntil };
  },

  async recordSuccessfulLogin(employeeId) {
    await this.ensureSchema();
    await pool.query(
      `UPDATE employees SET failed_login_count = 0, locked_until = NULL, last_login_at = CURRENT_TIMESTAMP WHERE id = ?`,
      [employeeId],
    );
  },

  async markPasswordChangeRequired(employeeId) {
    await this.ensureSchema();
    await pool.query("UPDATE employees SET must_change_password = TRUE WHERE id = ?", [employeeId]);
  },

  async setPassword(employeeId, passwordHash, { mustChangePassword = false, expiryDays = env.passwordExpiryDays } = {}) {
    await this.ensureSchema();
    const changedAt = new Date();
    const expiresAt = expiresAtFromNow(expiryDays);
    await pool.query(
      `UPDATE employees
       SET password_hash = ?, must_change_password = ?, password_changed_at = ?, password_expires_at = ?,
           failed_login_count = 0, locked_until = NULL
       WHERE id = ?`,
      [passwordHash, Boolean(mustChangePassword), changedAt, expiresAt, employeeId],
    );
    await pool.query(
      `INSERT INTO password_history (employee_id, password_hash, created_at) VALUES (?, ?, ?)`,
      [employeeId, passwordHash, changedAt],
    );
  },

  async initializeExistingPassword(employeeId, passwordHash, { mustChangePassword = false } = {}) {
    await this.ensureSchema();
    const [rows] = await pool.query(
      `SELECT password_changed_at, password_expires_at FROM employees WHERE id = ? LIMIT 1`,
      [employeeId],
    );
    if (!rows[0]?.password_changed_at || !rows[0]?.password_expires_at) {
      await this.setPassword(employeeId, passwordHash, { mustChangePassword });
    }
  },

  async recentPasswordHashes(employeeId, limit = env.passwordHistoryCount) {
    await this.ensureSchema();
    const safeLimit = Math.min(Math.max(Number(limit) || env.passwordHistoryCount, 1), 24);
    const [rows] = await pool.query(
      `SELECT password_hash FROM password_history WHERE employee_id = ? ORDER BY created_at DESC LIMIT ?`,
      [employeeId, safeLimit],
    );
    return rows.map((row) => row.password_hash);
  },

  isLocked(employee) {
    if (!employee?.locked_until) return false;
    return new Date(employee.locked_until).getTime() > Date.now();
  },

  isExpired(employee) {
    if (!employee?.password_expires_at) return false;
    return new Date(employee.password_expires_at).getTime() <= Date.now();
  },

  passwordAgeMs(employee) {
    if (!employee?.password_changed_at) return Number.POSITIVE_INFINITY;
    return Date.now() - new Date(employee.password_changed_at).getTime();
  },

  policy() {
    return {
      minimumLength: env.passwordMinLength,
      expiryDays: env.passwordExpiryDays,
      historyCount: env.passwordHistoryCount,
      minimumAgeDays: env.passwordMinAgeDays,
      maxFailedLogins: env.passwordMaxFailedLogins,
      lockoutMinutes: env.passwordLockoutMinutes,
    };
  },
};
