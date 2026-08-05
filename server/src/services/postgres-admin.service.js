import pg from "pg";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { env } from "../config/env.js";

const { Client } = pg;

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const postgresSchemaPath = path.resolve(currentDir, "../db/schema.sql");

function isConfigured() {
  return Boolean(env.databaseUrl);
}

async function openConnection() {
  const client = new Client({
    connectionString: env.databaseUrl,
    ssl: env.nodeEnv === "production" ? { rejectUnauthorized: false } : false,
  });
  await client.connect();
  return client;
}

export const postgresAdminService = {
  async status() {
    if (!isConfigured()) {
      return {
        configured: false,
        connected: false,
        database: null,
        exists: false,
        tables: [],
        error: null,
      };
    }

    let client;

    try {
      client = await openConnection();
      const databaseResult = await client.query("SELECT current_database() AS database_name");
      const tablesResult = await client.query(`
        SELECT
          tablename AS name,
          0::bigint AS rows
        FROM pg_tables
        WHERE schemaname = 'public'
        ORDER BY tablename ASC
      `);

      return {
        configured: true,
        connected: true,
        database: databaseResult.rows[0]?.database_name ?? null,
        exists: true,
        tables: tablesResult.rows,
        error: null,
      };
    } catch (error) {
      return {
        configured: true,
        connected: false,
        database: null,
        exists: false,
        tables: [],
        error: error.message,
      };
    } finally {
      if (client) {
        await client.end().catch(() => {});
      }
    }
  },

  async initializeDatabase() {
    if (!isConfigured()) {
      return { success: false, message: "PostgreSQL is not configured. Set DATABASE_URL first." };
    }

    const schema = await fs.readFile(postgresSchemaPath, "utf8");
    const client = await openConnection();
    try {
      await client.query(schema);
      return { success: true, message: "PostgreSQL schema initialized successfully" };
    } finally {
      await client.end();
    }
  },
};
