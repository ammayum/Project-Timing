import { pool } from "../config/db.js";

export const activityRepository = {
  async listAll() {
    const [rows] = await pool.query(
      "SELECT * FROM activity_types ORDER BY name ASC"
    );

    return rows;
  },

  async findByName(name) {
    const [rows] = await pool.query(
      "SELECT * FROM activity_types WHERE LOWER(name) = LOWER(?)",
      [name]
    );

    return rows[0] ?? null;
  },
};