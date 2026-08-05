import mysql from "mysql2/promise";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { env } from "../config/env.js";
import { AppError } from "../lib/app-error.js";

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const mysqlSchemaPath = path.resolve(currentDir, "../db/mysql-schema.sql");

function ensureMysqlConfigured() {
  if (!env.mysqlHost) {
    throw new AppError(400, "MySQL is not configured. Set MYSQL_HOST and related env values.");
  }
}

async function openConnection({ withDatabase = false } = {}) {
  ensureMysqlConfigured();
  return mysql.createConnection({
    host: env.mysqlHost,
    port: env.mysqlPort || 3306,
    user: env.mysqlUser,
    password: env.mysqlPassword,
    database: withDatabase ? env.mysqlDatabase : undefined,
    multipleStatements: true,
  });
}

export const mysqlAdminService = {
  async status() {
    ensureMysqlConfigured();
    const rootConnection = await openConnection();
    try {
      const [databases] = await rootConnection.query("SHOW DATABASES LIKE ?", [env.mysqlDatabase]);
      const exists = Array.isArray(databases) && databases.length > 0;

      if (!exists) {
        return {
          configured: true,
          connected: true,
          database: env.mysqlDatabase,
          exists: false,
          tables: [],
        };
      }
    } finally {
      await rootConnection.end();
    }

    const connection = await openConnection({ withDatabase: true });
    try {
      const [tables] = await connection.query(
        `
          SELECT table_name as name, table_rows as \`rows\`
          FROM information_schema.tables
          WHERE table_schema = ?
          ORDER BY table_name ASC
        `,
        [env.mysqlDatabase]
      );
      return {
        configured: true,
        connected: true,
        database: env.mysqlDatabase,
        exists: true,
        tables,
      };
    } finally {
      await connection.end();
    }
  },

  async initializeDatabase() {
    ensureMysqlConfigured();
    const rootConnection = await openConnection();
    try {
      await rootConnection.query(`CREATE DATABASE IF NOT EXISTS \`${env.mysqlDatabase}\``);
    } finally {
      await rootConnection.end();
    }

    const schema = await fs.readFile(mysqlSchemaPath, "utf8");
    const connection = await openConnection({ withDatabase: true });
    try {
      await connection.query(schema);
      try {
        await connection.query("ALTER TABLE time_entries ADD COLUMN order_num varchar(255) NULL");
      } catch (err) {
        // ignore error if column already exists
      }
      return { success: true, message: "Database initialized successfully" };
    } finally {
      await connection.end();
    }
  },
};