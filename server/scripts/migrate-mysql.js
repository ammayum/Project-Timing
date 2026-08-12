import { mysqlAdminService } from "../src/services/mysql-admin.service.js";
import { sessionRepository } from "../src/repositories/session.repository.js";
import { employeeRepository } from "../src/repositories/employee.repository.js";
import { passwordSecurityRepository } from "../src/repositories/password-security.repository.js";
import { inventoryRepository } from "../src/modules/inventory/inventory.repository.js";
import { ensureEngineerLocationSchema } from "../src/modules/inventory/inventory.location.schema.js";
import { ensurePalletSchema } from "../src/modules/inventory/inventory.pallet.schema.js";
import { closeDatabasePools } from "../src/config/db.js";

try {
  const result = await mysqlAdminService.initializeDatabase();
  await employeeRepository.ensureSchema();
  await passwordSecurityRepository.ensureSchema();
  await sessionRepository.ensureTables();
  await inventoryRepository.ensureSchema();
  await ensureEngineerLocationSchema();
  await ensurePalletSchema();
  console.log(result.message);
  console.log("Authentication security, Inventory/Warehouse and pallet schemas initialized successfully.");
} catch (error) {
  console.error("MySQL migration failed:", error.message);
  process.exitCode = 1;
} finally {
  await closeDatabasePools();
}
