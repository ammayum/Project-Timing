import { getActiveReadEngine, pool } from "../config/db.js";

function parseKitIdentifiers(value) {
  if (Array.isArray(value)) {
    return value.filter(Boolean);
  }

  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed.filter(Boolean) : [];
    } catch (_error) {
      return [];
    }
  }

  return [];
}

export const timeEntryAdminRepository = {
  async listDetailed(filters = {}) {
    const {
      date = null,
      startDate = null,
      endDate = null,
    } = filters;

    const params = [];
    const where = [];

    if (date) {
      params.push(date);
      where.push("te.entry_date = ?");
    }

    if (startDate) {
      params.push(startDate);
      where.push("te.entry_date >= ?");
    }

    if (endDate) {
      params.push(endDate);
      where.push("te.entry_date <= ?");
    }

    const engine = await getActiveReadEngine();
    const kitAggregate = engine === "postgres"
      ? `
        COALESCE(
          json_agg(COALESCE(k.serial_number, k.part_code))
          FILTER (WHERE k.id IS NOT NULL),
          '[]'::json
        ) AS kit_identifiers
      `
      : `
        COALESCE(
          JSON_ARRAYAGG(
            CASE
              WHEN k.id IS NOT NULL
              THEN COALESCE(k.serial_number, k.part_code)
              ELSE NULL
            END
          ),
          JSON_ARRAY()
        ) AS kit_identifiers
      `;

    const query = `
      SELECT
        te.*,
        e.name AS employee_name,
        e.email AS employee_email,
        e.ein AS employee_ein,
        at.name AS activity_name,
        p.\`Ja_Code\` AS project_code,
        p.\`Project_Name\` AS project_name,
        ${kitAggregate}
      FROM time_entries te
      INNER JOIN employees e
        ON e.id = te.employee_id
      INNER JOIN activity_types at
        ON at.id = te.activity_type_id
      LEFT JOIN projects p
        ON p.id = te.project_id
      LEFT JOIN time_entry_kits tek
        ON tek.time_entry_id = te.id
      LEFT JOIN kits k
        ON k.id = tek.kit_id
      ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
      GROUP BY
        te.id,
        e.id,
        at.id,
        p.id
      ORDER BY
        te.entry_date ASC,
        te.from_time ASC
    `;

    const [rows] = await pool.query(query, params);

    return rows.map((row) => ({
      ...row,
      kit_identifiers: parseKitIdentifiers(row.kit_identifiers),
    }));
  },
};
