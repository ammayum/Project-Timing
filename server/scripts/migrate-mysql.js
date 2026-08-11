import { mysqlAdminService } from "../src/services/mysql-admin.service.js";
import { sessionRepository } from "../src/repositories/session.repository.js";
import { employeeRepository } from "../src/repositories/employee.repository.js";
import { passwordSecurityRepository } from "../src/repositories/password-security.repository.js";
import { inventoryRepository } from "../src/modules/inventory/inventory.repository.js";

try {
  const result = await mysqlAdminService.initializeDatabase();
  await employeeRepository.ensureSchema();
  await passwordSecurityRepository.ensureSchema();
  await sessionRepository.ensureTables();
  await inventoryRepository.ensureSchema();
  console.log(result.message);
  console.log("Authentication security and Inventory/Warehouse schemas initialized successfully.");
} catch (error) {
  console.error("MySQL migration failed:", error.message);
  process.exitCode = 1;
}
