import { getActiveReadEngine, pool } from "../config/db.js";

export const kitRepository = {
  async ensureStockReportTable() {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS stock_report (
        part_code VARCHAR(50) NULL,
        serial_number VARCHAR(50) NULL,
        product_name VARCHAR(50) NULL,
        part_description VARCHAR(50) NULL,
        user_group VARCHAR(50) NULL,
        make VARCHAR(50) NULL,
        model VARCHAR(50) NULL
      )
    `);
  },

  async resolveMany(identifiers) {
    if (!identifiers || identifiers.length === 0) {
      return [];
    }

    const placeholders = identifiers.map(() => "?").join(",");
    const params = [...identifiers, ...identifiers];

    const [rows] = await pool.query(
      `
      SELECT
        k.*,
        p.\`Ja_Code\` AS project_code,
        p.\`Project_Name\` AS project_name
      FROM kits k
      LEFT JOIN projects p
        ON p.\`Ja_Code\` = k.project_ja_code
      WHERE
        k.serial_number IN (${placeholders})
        OR k.part_code IN (${placeholders})
      ORDER BY
        COALESCE(k.serial_number, k.part_code)
      `,
      params,
    );

    return rows;
  },

  async listAll() {
    const [rows] = await pool.query(
      `
      SELECT
        k.*,
        p.\`Ja_Code\` AS project_code,
        p.\`Project_Name\` AS project_name
      FROM kits k
      LEFT JOIN projects p
        ON p.\`Ja_Code\` = k.project_ja_code
      ORDER BY COALESCE(k.serial_number, k.part_code)
      `,
    );
    return rows || [];
  },

  async listStockReportRows() {
    await this.ensureStockReportTable();

    const [rows] = await pool.query(
      `
      SELECT
        part_code,
        serial_number,
        product_name,
        part_description,
        user_group,
        make,
        model
      FROM stock_report
      ORDER BY COALESCE(serial_number, part_code), part_code
      `,
    );

    return rows || [];
  },

  async listUsedKitUsage() {
    const engine = await getActiveReadEngine();
    const projectAggregate = engine === "postgres"
      ? "STRING_AGG(DISTINCT COALESCE(p.`Ja_Code`, ''), ',')"
      : "GROUP_CONCAT(DISTINCT COALESCE(p.`Ja_Code`, '') ORDER BY p.`Ja_Code` SEPARATOR ',')";

    const [rows] = await pool.query(
      `
      SELECT
        k.part_code,
        k.serial_number,
        k.device_type,
        k.brand,
        k.model,
        COUNT(tek.time_entry_id) AS used_count,
        MAX(te.entry_date) AS last_used_date,
        ${projectAggregate} AS project_codes
      FROM time_entry_kits tek
      INNER JOIN kits k
        ON k.id = tek.kit_id
      INNER JOIN time_entries te
        ON te.id = tek.time_entry_id
      LEFT JOIN projects p
        ON p.\`Ja_Code\` = k.project_ja_code
      GROUP BY
        k.part_code,
        k.serial_number,
        k.device_type,
        k.brand,
        k.model
      ORDER BY COALESCE(k.serial_number, k.part_code)
      `,
    );

    return rows || [];
  },

  async upsert(payload) {
    const engine = await getActiveReadEngine();
    const params = [
      null,
      payload.project_ja_code,
      payload.part_code,
      payload.serial_number,
      payload.device_type,
      payload.brand,
      payload.model,
    ];

    if (engine === "postgres") {
      await pool.query(
        `
        INSERT INTO kits
        (
          project_id,
          project_ja_code,
          part_code,
          serial_number,
          device_type,
          brand,
          model
        )
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT (part_code, serial_number) DO UPDATE
        SET
          project_id = EXCLUDED.project_id,
          project_ja_code = EXCLUDED.project_ja_code,
          device_type = EXCLUDED.device_type,
          brand = EXCLUDED.brand,
          model = EXCLUDED.model
        `,
        params,
      );
    } else {
      await pool.query(
        `
        INSERT INTO kits
        (
          project_id,
          project_ja_code,
          part_code,
          serial_number,
          device_type,
          brand,
          model
        )
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE
          project_id = VALUES(project_id),
          project_ja_code = VALUES(project_ja_code),
          device_type = VALUES(device_type),
          brand = VALUES(brand),
          model = VALUES(model)
        `,
        params,
      );
    }

    const [rows] = await pool.query(
      `
      SELECT
        k.*,
        p.\`Ja_Code\` AS project_code,
        p.\`Project_Name\` AS project_name
      FROM kits k
      LEFT JOIN projects p
        ON p.\`Ja_Code\` = k.project_ja_code
      WHERE k.part_code = ?
        AND k.serial_number = ?
      LIMIT 1
      `,
      [payload.part_code, payload.serial_number],
    );

    return rows[0] || null;
  },
};
