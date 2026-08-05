import bcrypt from "bcrypt";
import { randomInt } from "node:crypto";
import {
  getActiveReadEngine,
  getConfiguredDatabaseEngines,
  getDatabaseHealth,
  getRuntimeState,
  pool,
  queryOn,
  setEngineEnabled,
  setRuntimeMode,
} from "../config/db.js";
import { env } from "../config/env.js";
import { activityRepository } from "../repositories/activity.repository.js";
import { employeeRepository } from "../repositories/employee.repository.js";
import { kitRepository } from "../repositories/kit.repository.js";
import { projectRepository } from "../repositories/project.repository.js";
import { settingsRepository } from "../repositories/settings.repository.js";
import { teamRepository } from "../repositories/team.repository.js";
import { timeEntryAdminRepository } from "../repositories/time-entry-admin.repository.js";
import { csvService } from "./csv.service.js";
import { mysqlAdminService } from "./mysql-admin.service.js";
import { postgresAdminService } from "./postgres-admin.service.js";

const TEMP_PASSWORD_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
const TEMP_PASSWORD_SYMBOLS = "!@#$%^&*";

function pickRandomChar(source) {
  return source[randomInt(0, source.length)];
}

function shuffleChars(chars) {
  const output = [...chars];

  for (let index = output.length - 1; index > 0; index -= 1) {
    const swapIndex = randomInt(0, index + 1);
    [output[index], output[swapIndex]] = [output[swapIndex], output[index]];
  }

  return output.join("");
}

function generateTemporaryPassword(length = 14) {
  const requiredChars = [
    pickRandomChar("ABCDEFGHJKLMNPQRSTUVWXYZ"),
    pickRandomChar("abcdefghijkmnopqrstuvwxyz"),
    pickRandomChar("23456789"),
    pickRandomChar(TEMP_PASSWORD_SYMBOLS),
  ];

  while (requiredChars.length < length) {
    requiredChars.push(pickRandomChar(TEMP_PASSWORD_ALPHABET));
  }

  return shuffleChars(requiredChars);
}

async function getTableCount(tableName, engine) {
  const [rows] = await queryOn(engine, `SELECT COUNT(*) AS row_count FROM ${tableName}`);
  return Number(rows[0]?.row_count ?? rows[0]?.count ?? 0);
}

function sanitizeEmployeeRecord(employee) {
  if (!employee) {
    return employee;
  }

  const { password_hash, ...safeEmployee } = employee;
  return safeEmployee;
}

export const adminService = {
  async dashboardData() {
    const [employees, projects, projectsWithKits, kits, activities, syncSetting, teams, managers] = await Promise.all([
      employeeRepository.listAll(),
      projectRepository.listActive({ is_admin: true }),
      projectRepository.listAllWithKits({ is_admin: true }),
      kitRepository.listAll(),
      activityRepository.listAll(),
      settingsRepository.getSyncSettings(),
      teamRepository.listAll(),
      employeeRepository.listManagers(),
    ]);

    return {
      employees: employees.map(sanitizeEmployeeRecord),
      projects,
      projectsWithKits,
      kits,
      activities,
      teams,
      managers: managers.map(sanitizeEmployeeRecord),
      syncEnabled: syncSetting.value === "true",
    };
  },

  async updateEmployee(id, payload) {
    return employeeRepository.update(id, payload);
  },

  async upsertProject(payload) {
    return projectRepository.upsert(payload);
  },

  async upsertKit(payload) {
    return kitRepository.upsert(payload);
  },

  async setSyncEnabled(enabled) {
    return settingsRepository.setSyncEnabled(enabled);
  },

  async projectKitIndex(user) {
    return projectRepository.listAllWithKits(user);
  },

  async importKitsCsv(csvContent) {
    return csvService.importKitCsv(csvContent);
  },

  async listSharePointFiles() {
    return {
      provider: "none",
      writable: false,
      files: [],
    };
  },

  async createSharePointFile() {
    return { message: "SharePoint service disabled. running database-local mode only." };
  },

  async updateSharePointFile() {
    return { message: "SharePoint service disabled. running database-local mode only." };
  },

  async databaseDetails() {
    const runtime = await getRuntimeState();
    const readEngine = await getActiveReadEngine();
    const health = await getDatabaseHealth();

    let databaseName = readEngine === "mysql" ? env.mysqlDatabase : null;
    if (readEngine === "mysql") {
      const [dbResult] = await queryOn("mysql", "SELECT DATABASE() AS database_name");
      databaseName = dbResult[0]?.database_name || env.mysqlDatabase;
    } else {
      const [dbResult] = await queryOn("postgres", "SELECT current_database() AS database_name");
      databaseName = dbResult[0]?.database_name || null;
    }

    return {
      mode: runtime.mode,
      primaryDb: runtime.primaryDb,
      connected: true,
      databaseName,
      tables: [
        { name: "employees", rows: await getTableCount("employees", readEngine) },
        { name: "projects", rows: await getTableCount("projects", readEngine) },
        { name: "kits", rows: await getTableCount("kits", readEngine) },
        { name: "time_entries", rows: await getTableCount("time_entries", readEngine) },
        { name: "time_entry_kits", rows: await getTableCount("time_entry_kits", readEngine) },
      ],
      runtime,
      health,
      configured: getConfiguredDatabaseEngines(),
    };
  },

  async upsertUser(payload) {
    const temporaryPassword = payload.set_default_password
      ? generateTemporaryPassword()
      : null;
    const passwordHash = payload.set_default_password
      ? await bcrypt.hash(temporaryPassword, 12)
      : null;

    const user = await employeeRepository.upsertManaged({
      sso_id: payload.sso_id,
      name: payload.name,
      email: payload.email,
      ein: payload.ein,
      role: payload.role,
      overtime_allowed: payload.overtime_allowed,
      working_hours_per_day: payload.working_hours_per_day,
      is_admin: payload.is_admin,
      team_id: payload.team_id ?? null,
      password_hash: passwordHash,
      must_change_password: Boolean(payload.set_default_password),
    });

    return {
      user,
      temporaryPassword,
    };
  },

  async resetUserPassword(id) {
    const employee = await employeeRepository.findById(id);

    if (!employee) {
      throw new Error("User not found");
    }

    const temporaryPassword = generateTemporaryPassword();
    const passwordHash = await bcrypt.hash(temporaryPassword, 12);
    const user = await employeeRepository.updatePasswordState(id, {
      password_hash: passwordHash,
      must_change_password: true,
    });

    return {
      user,
      temporaryPassword,
    };
  },

  async upsertTeam(payload) {
    return teamRepository.upsert(payload);
  },

  async mysqlStatus() {
    return mysqlAdminService.status();
  },

  async postgresStatus() {
    return postgresAdminService.status();
  },

  async initializeMysql() {
    return mysqlAdminService.initializeDatabase();
  },

  async initializePostgres() {
    return postgresAdminService.initializeDatabase();
  },

  async runtimeStatus() {
    const runtime = await getRuntimeState();
    const health = await getDatabaseHealth();

    return {
      ...runtime,
      configured: getConfiguredDatabaseEngines(),
      health,
      replicationImplemented: false,
    };
  },

  async switchRuntimeMode({ mode, note, changedByEmployeeId }) {
    return setRuntimeMode(mode, { note, changedByEmployeeId });
  },

  async setDatabaseEnabled({ engine, enabled, note, changedByEmployeeId }) {
    return setEngineEnabled(engine, enabled, { note, changedByEmployeeId });
  },

  async syncStatus() {
    return {
      provider: "none",
      enabled: false,
      workbookRows: 0,
      replicationImplemented: false,
    };
  },

  async syncDatabaseToSharePoint() {
    return { message: "SharePoint synchronization feature disabled." };
  },

  async previewSharePointSync() {
    return [];
  },

  async importSharePointToDatabase() {
    return { message: "SharePoint integration disabled." };
  },

  async syncProjectsFromSharePoint() {
    return { synced: 0, results: [] };
  },

  async syncKitsFromSharePoint() {
    return { synced: 0, results: [] };
  },

  async employeePerformance({ startDate, endDate }) {
    const rows = await timeEntryAdminRepository.listDetailed({
      startDate,
      endDate,
    });

    const byEmployee = new Map();

    for (const row of rows) {
      const key = row.employee_email || row.employee_name;

      if (!byEmployee.has(key)) {
        byEmployee.set(key, {
          employee_name: row.employee_name,
          employee_email: row.employee_email,
          employee_ein: row.employee_ein,
          total_hours: 0,
          total_entries: 0,
          total_kits: 0,
          active_dates: new Set(),
          activities: [],
        });
      }

      const emp = byEmployee.get(key);
      const kits = Array.isArray(row.kit_identifiers) ? row.kit_identifiers : [];

      emp.total_hours += Number(row.hours || 0);
      emp.total_entries += 1;
      emp.total_kits += kits.length;
      emp.active_dates.add(String(row.entry_date));
      emp.activities.push({
        id: row.id,
        date: row.entry_date,
        activity: row.activity_name,
        project: row.project_code,
        order_num: row.order_num,
        from_time: row.from_time,
        to_time: row.to_time,
        hours: Number(row.hours || 0),
        overtime: Boolean(row.overtime),
        kits,
      });
    }

    const employees = [...byEmployee.values()]
      .map((emp) => {
        const activeDays = emp.active_dates.size;
        const totalHours = Number(emp.total_hours.toFixed(2));
        const quantity = emp.total_entries + emp.total_kits;

        return {
          employee_name: emp.employee_name,
          employee_email: emp.employee_email,
          employee_ein: emp.employee_ein,
          total_hours: totalHours,
          total_entries: emp.total_entries,
          total_kits: emp.total_kits,
          active_days: activeDays,
          quantity,
          speed_per_hour: totalHours > 0 ? Number((quantity / totalHours).toFixed(2)) : 0,
          entries_per_day: activeDays > 0 ? Number((emp.total_entries / activeDays).toFixed(2)) : 0,
          kits_per_day: activeDays > 0 ? Number((emp.total_kits / activeDays).toFixed(2)) : 0,
          activities: emp.activities,
        };
      })
      .sort((a, b) => b.quantity - a.quantity);

    return {
      startDate,
      endDate,
      employees,
      summary: {
        employees: employees.length,
        total_hours: Number(employees.reduce((sum, employee) => sum + employee.total_hours, 0).toFixed(2)),
        total_quantity: employees.reduce((sum, employee) => sum + employee.quantity, 0),
      },
    };
  },
};
