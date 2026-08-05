import { mysqlAdminService } from "../src/services/mysql-admin.service.js";
import { sessionRepository } from "../src/repositories/session.repository.js";

try {
  const result = await mysqlAdminService.initializeDatabase();
  await sessionRepository.ensureTables();
  console.log(result.message);
} catch (error) {
  console.error("MySQL migration failed:", error.message);
  process.exitCode = 1;
}
