import { getActiveReadEngine, pool } from "../config/db.js";

export const timeEntryRepository = {
  async findByEmployeeAndDate(employeeId, date) {
    const engine = await getActiveReadEngine();
    const kitsAggregate = engine === "postgres"
      ? "STRING_AGG(COALESCE(k.serial_number, k.part_code), ',' ORDER BY COALESCE(k.serial_number, k.part_code))"
      : "GROUP_CONCAT(COALESCE(k.serial_number, k.part_code) SEPARATOR ',')";

    const [rows] = await pool.query(
      `
      SELECT
          te.*,
          at.name AS activity_name,
          p.\`Ja_Code\` AS ja_code,
          p.\`Project_Name\` AS project_name,
          ${kitsAggregate} AS kits
      FROM time_entries te
      JOIN activity_types at
          ON at.id = te.activity_type_id
      LEFT JOIN projects p
          ON p.id = te.project_id
      LEFT JOIN time_entry_kits tek
          ON tek.time_entry_id = te.id
      LEFT JOIN kits k
          ON k.id = tek.kit_id
      WHERE te.employee_id = ?
        AND te.entry_date = ?
      GROUP BY
          te.id,
          at.name,
          p.\`Ja_Code\`,
          p.\`Project_Name\`
      ORDER BY te.from_time ASC
      `,
      [employeeId, date],
    );

    return rows.map((row) => ({
      ...row,
      kits: row.kits ? String(row.kits).split(",").filter(Boolean) : [],
    }));
  },

  async insertMany(connection, employeeId, entries) {
    const inserted = [];
    const isPostgres = connection?.engine === "postgres";

    for (const entry of entries) {
      if (isPostgres) {
        const [rows] = await connection.query(
          `
          INSERT INTO time_entries
          (
            employee_id,
            activity_type_id,
            project_id,
            order_num,
            entry_date,
            from_time,
            to_time,
            hours,
            overtime
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
          RETURNING *
          `,
          [
            employeeId,
            entry.activity_type_id,
            entry.project_id,
            entry.order_num,
            entry.entry_date,
            entry.from_time,
            entry.to_time,
            entry.hours,
            entry.overtime,
          ],
        );

        inserted.push(rows[0]);
      } else {
        const [result] = await connection.query(
          `
          INSERT INTO time_entries
          (
            employee_id,
            activity_type_id,
            project_id,
            order_num,
            entry_date,
            from_time,
            to_time,
            hours,
            overtime
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
          `,
          [
            employeeId,
            entry.activity_type_id,
            entry.project_id,
            entry.order_num,
            entry.entry_date,
            entry.from_time,
            entry.to_time,
            entry.hours,
            entry.overtime,
          ],
        );

        const [rows] = await connection.query(
          "SELECT * FROM time_entries WHERE id = ?",
          [result.insertId],
        );

        inserted.push(rows[0]);
      }
    }

    return inserted;
  },
};
