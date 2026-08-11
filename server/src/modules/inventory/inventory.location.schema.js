import { getActiveWriteEngine, pool } from "../../config/db.js";

export async function ensureEngineerLocationSchema() {
  const engine = await getActiveWriteEngine();

  if (engine !== "mysql") {
    return {
      available: false,
      reason: "Engineer-assigned inventory locations require MySQL as the active write database.",
    };
  }

  await pool.query(
    `INSERT IGNORE INTO inventory_warehouses (code, name, description)
     VALUES ('SHEF', 'Sheffield', 'Default warehouse')`,
  );

  await pool.query(
    "ALTER TABLE inventory_locations ADD COLUMN IF NOT EXISTS assigned_employee_id INT NULL",
  );

  try {
    await pool.query(
      "ALTER TABLE inventory_locations ADD INDEX idx_inventory_locations_assigned_employee (assigned_employee_id)",
    );
  } catch (error) {
    if (!/duplicate key name|already exists/i.test(String(error?.message || ""))) {
      throw error;
    }
  }

  const [constraintRows] = await pool.query(
    `SELECT CONSTRAINT_NAME
     FROM information_schema.TABLE_CONSTRAINTS
     WHERE CONSTRAINT_SCHEMA = DATABASE()
       AND TABLE_NAME = 'inventory_locations'
       AND CONSTRAINT_NAME = 'fk_inventory_locations_assigned_employee'
     LIMIT 1`,
  );

  if (!constraintRows[0]) {
    await pool.query(
      `ALTER TABLE inventory_locations
       ADD CONSTRAINT fk_inventory_locations_assigned_employee
       FOREIGN KEY (assigned_employee_id) REFERENCES employees(id) ON DELETE SET NULL`,
    );
  }

  return { available: true, engine };
}
