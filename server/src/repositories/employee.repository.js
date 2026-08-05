import { getActiveReadEngine, pool } from "../config/db.js";
import { teamRepository } from "./team.repository.js";

function normalizeEin(value) {
  if (value === undefined || value === null) {
    return null;
  }

  const normalized = String(value).trim();
  return normalized === "" ? null : normalized;
}

export const employeeRepository = {
  async ensureSchema() {
    await teamRepository.ensureTables();
    const engine = await getActiveReadEngine();

    await pool.query("ALTER TABLE employees ADD COLUMN IF NOT EXISTS password_hash varchar(512) NULL");
    await pool.query("ALTER TABLE employees ADD COLUMN IF NOT EXISTS must_change_password boolean NOT NULL DEFAULT false");
    await pool.query("ALTER TABLE employees ADD COLUMN IF NOT EXISTS team_id BIGINT NULL");
    await pool.query("ALTER TABLE employees ADD COLUMN IF NOT EXISTS working_hours_per_day DECIMAL(4,2) NOT NULL DEFAULT 7.50");

    if (engine === "postgres") {
      await pool.query("CREATE INDEX IF NOT EXISTS idx_employees_team_id ON employees (team_id)");
    } else {
      try {
        await pool.query("ALTER TABLE employees ADD INDEX idx_employees_team_id (team_id)");
      } catch (_error) {
        // MySQL throws when the index already exists.
      }
    }
  },

  async hydrateEmployee(row) {
    if (!row) {
      return null;
    }

    if (!("team_name" in row)) {
      const [rows] = await pool.query(
        `
        SELECT
          e.*,
          t.name AS team_name
        FROM employees e
        LEFT JOIN teams t
          ON t.id = e.team_id
        WHERE e.id = ?
        LIMIT 1
        `,
        [row.id],
      );

      return rows[0] ?? null;
    }

    return row;
  },

  async upsertManaged(payload) {
    await this.ensureSchema();
    const engine = await getActiveReadEngine();
    const params = [
      payload.sso_id,
      payload.name,
      payload.email,
      normalizeEin(payload.ein),
      payload.role,
      payload.overtime_allowed,
      payload.working_hours_per_day ?? 7.5,
      payload.is_admin,
      payload.password_hash ?? null,
      Boolean(payload.must_change_password),
      payload.team_id ?? null,
    ];

    if (engine === "postgres") {
      await pool.query(
        `
        INSERT INTO employees
          (sso_id, name, email, ein, role, overtime_allowed, working_hours_per_day, is_admin, password_hash, must_change_password, team_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT (sso_id) DO UPDATE
        SET
          name = EXCLUDED.name,
          email = EXCLUDED.email,
          ein = EXCLUDED.ein,
          role = EXCLUDED.role,
          overtime_allowed = EXCLUDED.overtime_allowed,
          working_hours_per_day = EXCLUDED.working_hours_per_day,
          is_admin = EXCLUDED.is_admin,
          password_hash = COALESCE(EXCLUDED.password_hash, employees.password_hash),
          must_change_password = EXCLUDED.must_change_password,
          team_id = EXCLUDED.team_id
        `,
        params,
      );
    } else {
      await pool.query(
        `
        INSERT INTO employees
          (sso_id, name, email, ein, role, overtime_allowed, working_hours_per_day, is_admin, password_hash, must_change_password, team_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE
          name = VALUES(name),
          email = VALUES(email),
          ein = VALUES(ein),
          role = VALUES(role),
          overtime_allowed = VALUES(overtime_allowed),
          working_hours_per_day = VALUES(working_hours_per_day),
          is_admin = VALUES(is_admin),
          password_hash = COALESCE(VALUES(password_hash), employees.password_hash),
          must_change_password = VALUES(must_change_password),
          team_id = VALUES(team_id)
        `,
        params,
      );
    }

    const [rows] = await pool.query(
      `
      SELECT
        e.*,
        t.name AS team_name
      FROM employees e
      LEFT JOIN teams t
        ON t.id = e.team_id
      WHERE e.sso_id = ?
      `,
      [payload.sso_id],
    );

    return rows[0] ?? null;
  },

  async upsertFromSso({ ssoId, name, email, ein }) {
    await this.ensureSchema();
    const engine = await getActiveReadEngine();

    if (engine === "postgres") {
      await pool.query(
        `
        INSERT INTO employees
          (sso_id, name, email, ein)
        VALUES (?, ?, ?, ?)
        ON CONFLICT (sso_id) DO UPDATE
        SET
          name = EXCLUDED.name,
          email = EXCLUDED.email,
          ein = COALESCE(EXCLUDED.ein, employees.ein)
        `,
        [ssoId, name, email, normalizeEin(ein)],
      );
    } else {
      await pool.query(
        `
        INSERT INTO employees
          (sso_id, name, email, ein)
        VALUES (?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE
          name = VALUES(name),
          email = VALUES(email),
          ein = COALESCE(VALUES(ein), employees.ein)
        `,
        [ssoId, name, email, normalizeEin(ein)],
      );
    }

    const [rows] = await pool.query(
      `
      SELECT
        e.*,
        t.name AS team_name
      FROM employees e
      LEFT JOIN teams t
        ON t.id = e.team_id
      WHERE e.sso_id = ?
      `,
      [ssoId],
    );

    return rows[0] ?? null;
  },

  async findById(id) {
    const [rows] = await pool.query(
      `
      SELECT
        e.*,
        t.name AS team_name
      FROM employees e
      LEFT JOIN teams t
        ON t.id = e.team_id
      WHERE e.id = ?
      `,
      [id],
    );

    return rows[0] ?? null;
  },

  async listAll() {
    const [rows] = await pool.query(
      `
      SELECT
        e.*,
        t.name AS team_name
      FROM employees e
      LEFT JOIN teams t
        ON t.id = e.team_id
      ORDER BY e.name ASC
      `,
    );

    return rows;
  },

  async findByIdentity(identity) {
    const [rows] = await pool.query(
      `
      SELECT
        e.*,
        t.name AS team_name
      FROM employees e
      LEFT JOIN teams t
        ON t.id = e.team_id
      WHERE LOWER(e.email) = LOWER(?)
         OR LOWER(e.sso_id) = LOWER(?)
      LIMIT 1
      `,
      [identity, identity],
    );

    return rows[0] ?? null;
  },

  async update(id, payload) {
    await this.ensureSchema();
    await pool.query(
      `
      UPDATE employees
      SET
        name = ?,
        email = ?,
        ein = ?,
        overtime_allowed = ?,
        working_hours_per_day = ?,
        is_admin = ?,
        role = ?,
        team_id = ?
      WHERE id = ?
      `,
      [
        payload.name,
        payload.email,
        normalizeEin(payload.ein),
        payload.overtime_allowed,
        payload.working_hours_per_day ?? 7.5,
        payload.is_admin,
        payload.role,
        payload.team_id ?? null,
        id,
      ],
    );

    const [rows] = await pool.query(
      `
      SELECT
        e.*,
        t.name AS team_name
      FROM employees e
      LEFT JOIN teams t
        ON t.id = e.team_id
      WHERE e.id = ?
      `,
      [id],
    );

    return rows[0] ?? null;
  },

  async updatePasswordHash(id, password_hash) {
    await this.ensureSchema();
    await pool.query(
      `
      UPDATE employees
      SET password_hash = ?
      WHERE id = ?
      `,
      [password_hash, id],
    );

    const [rows] = await pool.query(
      `
      SELECT
        e.*,
        t.name AS team_name
      FROM employees e
      LEFT JOIN teams t
        ON t.id = e.team_id
      WHERE e.id = ?
      `,
      [id],
    );

    return rows[0] ?? null;
  },

  async updatePasswordState(id, { password_hash, must_change_password }) {
    await this.ensureSchema();
    await pool.query(
      `
      UPDATE employees
      SET
        password_hash = ?,
        must_change_password = ?
      WHERE id = ?
      `,
      [password_hash, Boolean(must_change_password), id],
    );

    const [rows] = await pool.query(
      `
      SELECT
        e.*,
        t.name AS team_name
      FROM employees e
      LEFT JOIN teams t
        ON t.id = e.team_id
      WHERE e.id = ?
      `,
      [id],
    );

    return rows[0] ?? null;
  },

  async findBySsoId(ssoId) {
    const [rows] = await pool.query(
      `
      SELECT
        e.*,
        t.name AS team_name
      FROM employees e
      LEFT JOIN teams t
        ON t.id = e.team_id
      WHERE e.sso_id = ?
      `,
      [ssoId],
    );

    return rows[0] ?? null;
  },

  async findByEmail(email) {
    const [rows] = await pool.query(
      `
      SELECT
        e.*,
        t.name AS team_name
      FROM employees e
      LEFT JOIN teams t
        ON t.id = e.team_id
      WHERE LOWER(e.email) = LOWER(?)
      `,
      [email],
    );

    return rows[0] ?? null;
  },

  async listManagers() {
    const [rows] = await pool.query(
      `
      SELECT
        e.*,
        t.name AS team_name
      FROM employees e
      LEFT JOIN teams t
        ON t.id = e.team_id
      WHERE e.role = 'manager' OR e.is_admin = true
      ORDER BY e.name ASC
      `,
    );

    return rows;
  },
};
