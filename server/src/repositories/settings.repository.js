import { getActiveReadEngine, pool } from "../config/db.js";

export const settingsRepository = {
  async getSyncSettings() {
    const engine = await getActiveReadEngine();
    const keyColumn = engine === "postgres" ? "\"key\"" : "`key`";
    const [rows] = await pool.query(
      `SELECT * FROM app_settings WHERE ${keyColumn} = 'sharepoint_sync_enabled' LIMIT 1`
    );

    return rows && rows.length > 0 ? rows[0] : { key: "sharepoint_sync_enabled", value: "false" };
  },

  async setSyncEnabled(enabled) {
    const stringValue = String(enabled);
    const engine = await getActiveReadEngine();

    if (engine === "postgres") {
      await pool.query(
        `
          INSERT INTO app_settings ("key", "value")
          VALUES ('sharepoint_sync_enabled', ?)
          ON CONFLICT ("key") DO UPDATE SET "value" = EXCLUDED."value"
        `,
        [stringValue],
      );
    } else {
      await pool.query(
        `
          INSERT INTO app_settings (\`key\`, \`value\`)
          VALUES ('sharepoint_sync_enabled', ?)
          ON DUPLICATE KEY UPDATE \`value\` = VALUES(\`value\`)
        `,
        [stringValue],
      );
    }

    return { key: "sharepoint_sync_enabled", value: stringValue };
  },
};
