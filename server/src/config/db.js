import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import mysql from "mysql2/promise";
import { env } from "./env.js";
import { AppError } from "../lib/app-error.js";

const { Pool } = pg;

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const runtimeStatePath = path.resolve(currentDir, "../db/runtime-state.json");

const WRITE_SQL_PREFIXES = new Set([
  "insert",
  "update",
  "delete",
  "replace",
  "alter",
  "create",
  "drop",
  "truncate",
]);

const MODE_CONFIG = {
  mysql_primary: {
    primaryDb: "mysql",
    writeEnabled: true,
    mysqlEnabled: true,
    postgresEnabled: true,
  },
  postgres_primary: {
    primaryDb: "postgres",
    writeEnabled: true,
    mysqlEnabled: true,
    postgresEnabled: true,
  },
  mysql_only: {
    primaryDb: "mysql",
    writeEnabled: true,
    mysqlEnabled: true,
    postgresEnabled: false,
  },
  postgres_only: {
    primaryDb: "postgres",
    writeEnabled: true,
    mysqlEnabled: false,
    postgresEnabled: true,
  },
  maintenance: {
    primaryDb: "mysql",
    writeEnabled: false,
    mysqlEnabled: true,
    postgresEnabled: true,
  },
};

const configuredEngines = {
  mysql: Boolean(env.mysqlHost),
  postgres: Boolean(env.databaseUrl),
};

const mysqlPool = env.devMemoryMode || !configuredEngines.mysql
  ? null
  : mysql.createPool({
      host: env.mysqlHost,
      port: env.mysqlPort,
      user: env.mysqlUser,
      password: env.mysqlPassword,
      database: env.mysqlDatabase,
      multipleStatements: true,
    });

const postgresPool = env.devMemoryMode || !configuredEngines.postgres
  ? null
  : new Pool({
      connectionString: env.databaseUrl,
      ssl: env.nodeEnv === "production" ? { rejectUnauthorized: false } : false,
    });

let runtimeStateCache = null;

function stripLeadingComments(sql) {
  return String(sql || "")
    .replace(/^\s*\/\*[\s\S]*?\*\//, "")
    .trim();
}

function isWriteQuery(sql) {
  const normalized = stripLeadingComments(sql).toLowerCase();
  const prefix = normalized.split(/\s+/)[0];
  return WRITE_SQL_PREFIXES.has(prefix);
}

function getDefaultMode() {
  if (configuredEngines.mysql && configuredEngines.postgres) {
    return "mysql_primary";
  }

  if (configuredEngines.mysql) {
    return "mysql_only";
  }

  if (configuredEngines.postgres) {
    return "postgres_only";
  }

  return "maintenance";
}

function normalizeRuntimeState(rawState = {}) {
  const mode = MODE_CONFIG[rawState.mode] ? rawState.mode : getDefaultMode();
  const base = MODE_CONFIG[mode];

  const mysqlEnabled = configuredEngines.mysql
    ? rawState.mysqlEnabled ?? base.mysqlEnabled
    : false;
  const postgresEnabled = configuredEngines.postgres
    ? rawState.postgresEnabled ?? base.postgresEnabled
    : false;

  let primaryDb = rawState.primaryDb ?? base.primaryDb;
  if (primaryDb === "mysql" && !mysqlEnabled) {
    primaryDb = postgresEnabled ? "postgres" : "mysql";
  }
  if (primaryDb === "postgres" && !postgresEnabled) {
    primaryDb = mysqlEnabled ? "mysql" : "postgres";
  }

  //const postgres = health.databases.find((database) => database.engine === "postgres");

  return {
    mode,
    primaryDb,
    writeEnabled: rawState.writeEnabled ?? base.writeEnabled,
    mysqlEnabled,
    postgresEnabled,
    changedByEmployeeId: rawState.changedByEmployeeId ?? null,
    changedAt: rawState.changedAt ?? null,
    note: rawState.note ?? "",
  };
}

async function persistRuntimeState(state) {
  runtimeStateCache = state;
  await fs.writeFile(runtimeStatePath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
}

async function ensureRuntimeStateLoaded() {
  if (runtimeStateCache) {
    return runtimeStateCache;
  }

  try {
    const raw = await fs.readFile(runtimeStatePath, "utf8");
    runtimeStateCache = normalizeRuntimeState(JSON.parse(raw));
  } catch (error) {
    runtimeStateCache = normalizeRuntimeState();
    await persistRuntimeState(runtimeStateCache);
  }

  return runtimeStateCache;
}

function convertMysqlPlaceholdersToPg(sql) {
  let index = 0;
  let converted = "";
  let inSingleQuote = false;
  let inDoubleQuote = false;

  for (let i = 0; i < sql.length; i += 1) {
    const char = sql[i];
    const previous = sql[i - 1];

    if (char === "'" && !inDoubleQuote && previous !== "\\") {
      inSingleQuote = !inSingleQuote;
      converted += char;
      continue;
    }

    if (char === "\"" && !inSingleQuote && previous !== "\\") {
      inDoubleQuote = !inDoubleQuote;
      converted += char;
      continue;
    }

    if (char === "?" && !inSingleQuote && !inDoubleQuote) {
      index += 1;
      converted += `$${index}`;
      continue;
    }

    converted += char;
  }

  return converted.replace(/`([^`]+)`/g, "\"$1\"");
}

function wrapMysqlClient(connection) {
  return {
    engine: "mysql",
    async query(sql, params = []) {
      return connection.query(sql, params);
    },
    async beginTransaction() {
      await connection.beginTransaction();
    },
    async commit() {
      await connection.commit();
    },
    async rollback() {
      await connection.rollback();
    },
    release() {
      connection.release();
    },
  };
}

function wrapPostgresClient(client) {
  return {
    engine: "postgres",
    async query(sql, params = []) {
      const result = await client.query(convertMysqlPlaceholdersToPg(sql), params);
      return [result.rows, { rowCount: result.rowCount, insertId: result.rows[0]?.id ?? null }];
    },
    async beginTransaction() {
      await client.query("BEGIN");
    },
    async commit() {
      await client.query("COMMIT");
    },
    async rollback() {
      await client.query("ROLLBACK");
    },
    release() {
      client.release();
    },
  };
}

async function getWrappedConnection(engine) {
  if (engine === "mysql") {
    if (!mysqlPool) {
      throw new AppError(503, "MySQL is not configured");
    }
    return wrapMysqlClient(await mysqlPool.getConnection());
  }

  if (!postgresPool) {
    throw new AppError(503, "PostgreSQL is not configured");
  }

  return wrapPostgresClient(await postgresPool.connect());
}

function pickReadEngine(state) {
  if (state.primaryDb === "mysql" && state.mysqlEnabled) {
    return "mysql";
  }

  if (state.primaryDb === "postgres" && state.postgresEnabled) {
    return "postgres";
  }

  if (state.mysqlEnabled) {
    return "mysql";
  }

  if (state.postgresEnabled) {
    return "postgres";
  }

  throw new AppError(503, "No database engine is enabled");
}

function pickWriteEngine(state) {
  if (!state.writeEnabled) {
    throw new AppError(503, "System is in maintenance mode. Writes are temporarily disabled.");
  }

  if (state.primaryDb === "mysql" && state.mysqlEnabled) {
    return "mysql";
  }

  if (state.primaryDb === "postgres" && state.postgresEnabled) {
    return "postgres";
  }

  throw new AppError(503, "Primary database is not available for writes");
}

export async function getRuntimeState() {
  return ensureRuntimeStateLoaded();
}

export async function setRuntimeMode(mode, metadata = {}) {
  if (!MODE_CONFIG[mode]) {
    throw new AppError(400, `Unsupported runtime mode: ${mode}`);
  }

  const nextState = normalizeRuntimeState({
    ...MODE_CONFIG[mode],
    mode,
    changedByEmployeeId: metadata.changedByEmployeeId ?? null,
    changedAt: new Date().toISOString(),
    note: metadata.note ?? "",
  });

  if (nextState.mysqlEnabled && !configuredEngines.mysql) {
    throw new AppError(400, "MySQL mode selected but MySQL is not configured");
  }

  if (nextState.postgresEnabled && !configuredEngines.postgres) {
    throw new AppError(400, "PostgreSQL mode selected but PostgreSQL is not configured");
  }

  await persistRuntimeState(nextState);
  return nextState;
}

export async function setEngineEnabled(engine, enabled, metadata = {}) {
  if (!["mysql", "postgres"].includes(engine)) {
    throw new AppError(400, "Unknown database engine");
  }

  if (enabled && !configuredEngines[engine]) {
    throw new AppError(400, `${engine} is not configured`);
  }

  const current = await ensureRuntimeStateLoaded();
  const nextState = normalizeRuntimeState({
    ...current,
    mysqlEnabled: engine === "mysql" ? enabled : current.mysqlEnabled,
    postgresEnabled: engine === "postgres" ? enabled : current.postgresEnabled,
    changedByEmployeeId: metadata.changedByEmployeeId ?? null,
    changedAt: new Date().toISOString(),
    note: metadata.note ?? "",
  });

  if (!nextState.mysqlEnabled && !nextState.postgresEnabled) {
    throw new AppError(400, "At least one database engine must remain enabled");
  }

  if (current.primaryDb === engine && current.writeEnabled && !enabled) {
    throw new AppError(400, `Cannot disable the active primary database (${engine}) while writes are enabled. Switch mode first.`);
  }

  await persistRuntimeState(nextState);
  return nextState;
}

export function getConfiguredDatabaseEngines() {
  return { ...configuredEngines };
}

export async function getActiveReadEngine() {
  return pickReadEngine(await ensureRuntimeStateLoaded());
}

export async function getActiveWriteEngine() {
  return pickWriteEngine(await ensureRuntimeStateLoaded());
}

export async function queryOn(engine, sql, params = []) {
  const connection = await getWrappedConnection(engine);
  try {
    return await connection.query(sql, params);
  } finally {
    connection.release();
  }
}

export async function getDatabaseHealth() {
  const state = await ensureRuntimeStateLoaded();

  const checks = await Promise.all(
    ["mysql", "postgres"].map(async (engine) => {
      const configured = configuredEngines[engine];
      const enabled = engine === "mysql" ? state.mysqlEnabled : state.postgresEnabled;

      if (!configured) {
        return {
          engine,
          configured: false,
          enabled: false,
          connected: false,
          readable: false,
          writable: false,
          error: null,
        };
      }

      try {
        const connection = await getWrappedConnection(engine);
        try {
          await connection.query("SELECT 1 AS health_check");
        } finally {
          connection.release();
        }

        const writable = state.writeEnabled && state.primaryDb === engine && enabled;
        return {
          engine,
          configured: true,
          enabled,
          connected: true,
          readable: enabled,
          writable,
          error: null,
        };
      } catch (error) {
        return {
          engine,
          configured: true,
          enabled,
          connected: false,
          readable: false,
          writable: false,
          error: error.message,
        };
      }
    }),
  );

  return {
    mode: state.mode,
    primaryDb: state.primaryDb,
    writeEnabled: state.writeEnabled,
    databases: checks,
  };
}

const REQUIRED_MYSQL_TABLES = [
  "employees",
  "teams",
  "projects",
  "project_teams",
  "project_managers",
  "activity_types",
  "time_entries",
  "time_entry_kits",
  "kits",
  "stock_report",
  "auth_sessions",
];

const REQUIRED_MYSQL_INDEXES = [
  ["employees", "PRIMARY"],
  ["projects", "PRIMARY"],
  ["projects", "uniq_project_code_suffix"],
  ["kits", "PRIMARY"],
  ["kits", "uniq_kit_codes"],
  ["project_teams", "PRIMARY"],
  ["project_managers", "PRIMARY"],
  ["time_entries", "PRIMARY"],
  ["time_entry_kits", "PRIMARY"],
  ["auth_sessions", "PRIMARY"],
  ["auth_sessions", "token_hash"],
  ["auth_sessions", "idx_auth_sessions_employee_id"],
  ["auth_sessions", "idx_auth_sessions_last_activity_at"],
];

export async function getProductionReadiness() {
  if (env.nodeEnv !== "production") {
    return { ready: true, environment: env.nodeEnv, checks: { productionMode: false } };
  }

  const health = await getDatabaseHealth();
  const mysql = health.databases.find((database) => database.engine === "mysql");
  const postgres = health.databases.find((database) => database.engine === "postgres");
  let missingTables = [];
  let missingIndexes = [];

  if (mysql?.connected) {
    try {
      const [rows] = await queryOn(
        "mysql",
        `
          SELECT table_name
          FROM information_schema.tables
          WHERE table_schema = ?
            AND table_name IN (?)
        `,
        [env.mysqlDatabase, REQUIRED_MYSQL_TABLES],
      );
      const presentTables = new Set(rows.map((row) => String(row.table_name).toLowerCase()));
      missingTables = REQUIRED_MYSQL_TABLES.filter((table) => !presentTables.has(table));

      const [indexRows] = await queryOn(
        "mysql",
        `
          SELECT table_name, index_name
          FROM information_schema.statistics
          WHERE table_schema = ?
        `,
        [env.mysqlDatabase],
      );
      const presentIndexes = new Set(
        indexRows.map((row) => `${String(row.table_name).toLowerCase()}.${String(row.index_name)}`),
      );
      missingIndexes = REQUIRED_MYSQL_INDEXES
        .filter(([table, index]) => !presentIndexes.has(`${table}.${index}`))
        .map(([table, index]) => `${table}.${index}`);
    } catch (_error) {
      missingTables = [...REQUIRED_MYSQL_TABLES];
      missingIndexes = [...REQUIRED_MYSQL_INDEXES].map(([table, index]) => `${table}.${index}`);
    }
  } else {
    missingTables = [...REQUIRED_MYSQL_TABLES];
    missingIndexes = [...REQUIRED_MYSQL_INDEXES].map(([table, index]) => `${table}.${index}`);
  }

  const checks = {
    productionMode: true,
    mysqlConfigured: Boolean(mysql?.configured),
    mysqlConnected: Boolean(mysql?.connected),
    mysqlPrimary: health.primaryDb === "mysql",
    mysqlWritesEnabled: Boolean(mysql?.writable),
    requiredTables: missingTables.length === 0,
    requiredIndexes: missingIndexes.length === 0,
  };

  return {
    ready: Object.values(checks).every(Boolean),
    environment: env.nodeEnv,
    checks,
    missingTables,
    missingIndexes,
    postgres: postgres
      ? {
          engine: postgres.engine,
          configured: postgres.configured,
          enabled: postgres.enabled,
          connected: postgres.connected,
          readable: postgres.readable,
          writable: postgres.writable,
        }
      : null,
  };
}

export const pool = {
  async query(sql, params = []) {
    if (env.devMemoryMode) {
      return [[], { rowCount: 0, insertId: null }];
    }

    const state = await ensureRuntimeStateLoaded();
    const engine = isWriteQuery(sql) ? pickWriteEngine(state) : pickReadEngine(state);
    return queryOn(engine, sql, params);
  },
};

export async function withTransaction(callback) {
  if (env.devMemoryMode) {
    return callback(null);
  }

  const engine = await getActiveWriteEngine();
  const client = await getWrappedConnection(engine);

  try {
    await client.beginTransaction();
    const result = await callback(client);
    await client.commit();
    return result;
  } catch (error) {
    await client.rollback();
    throw error;
  } finally {
    client.release();
  }
}
