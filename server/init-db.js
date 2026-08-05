import { mysqlAdminService } from "./src/services/mysql-admin.service.js";
import dotenv from "dotenv";

dotenv.config();

async function init() {
  try {
    const result = await mysqlAdminService.initializeDatabase();
    console.log("Database initialized:", result);
  } catch (error) {
    console.error("Error initializing database:", error);
  }
}

init();