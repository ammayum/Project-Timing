import { createApp } from "./app.js";
import { env } from "./config/env.js";
import { employeeRepository } from "./repositories/employee.repository.js";
import { passwordSecurityRepository } from "./repositories/password-security.repository.js";
import { inventoryRepository } from "./modules/inventory/inventory.repository.js";
import { getProductionReadiness } from "./config/db.js";

const app = createApp();

async function start() {
  await employeeRepository.ensureSchema();
  await passwordSecurityRepository.ensureSchema();
  await inventoryRepository.ensureSchema();

  if (env.nodeEnv === "production") {
    const readiness = await getProductionReadiness();
    if (!readiness.ready) {
      throw new Error(`Production readiness failed: ${JSON.stringify(readiness.checks)}`);
    }
  }

  app.listen(env.port, "0.0.0.0", () => {
    console.log(`Project Billing System API listening on port ${env.port}`);
  });
}

start().catch((error) => {
  console.error("Unable to initialize server schema:", error);
  process.exitCode = 1;
});
