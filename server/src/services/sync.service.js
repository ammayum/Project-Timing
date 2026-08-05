import { settingsRepository } from "../repositories/settings.repository.js";
import { graphService } from "./graph.service.js";
import { timeEntryAdminRepository } from "../repositories/time-entry-admin.repository.js";
import { employeeRepository } from "../repositories/employee.repository.js";
import { timeEntryService } from "./time-entry.service.js";
import { AppError } from "../lib/app-error.js";

export const syncService = {
  async isEnabled() {
    const setting = await settingsRepository.getSyncSettings();
    return setting.value === "true";
  },

  async syncTimeEntries(entries, employee) {
    const enabled = await this.isEnabled();
    if (!enabled) {
      return { synced: false, reason: "SharePoint sync disabled" };
    }

    await graphService.appendRows(
      entries.map((entry) => ({
        date: entry.entry_date,
        employee: employee.name,
        ein: employee.ein,
        activity: entry.activity_name,
        project: entry.project_code ?? "",
        from: entry.from_time,
        to: entry.to_time,
        hours: entry.hours,
        kits: entry.kit_identifiers.join(", "),
      })),
    );

    return { synced: true };
  },

  async exportDatabaseToSharePoint({ date = null } = {}) {
    const entries = await timeEntryAdminRepository.listDetailed({ date });
    await graphService.appendRows(
      entries.map((entry) => ({
        date: entry.entry_date,
        employee: entry.employee_name,
        ein: entry.employee_ein,
        activity: entry.activity_name,
        project: entry.project_code ?? "",
        from: entry.from_time,
        to: entry.to_time,
        hours: entry.hours,
        kits: (entry.kit_identifiers || []).join(", "),
      })),
    );

    return {
      direction: "db_to_sharepoint",
      count: entries.length,
    };
  },

  async previewSharePointRows() {
    const rows = await graphService.readWorkbookRows();
    return {
      direction: "sharepoint_preview",
      count: rows.length,
      rows,
    };
  },

  async importSharePointRowsToDatabase() {
    const rows = await graphService.readWorkbookRows();
    const grouped = new Map();

    for (const row of rows) {
      const employeeEmail = row.employee_email || row.employee || row.email;
      const date = row.date;
      const activity = row.activity;
      const project = row.project || "";
      const fromTime = row.from || row.from_time;
      const toTime = row.to || row.to_time;
      const kits = row.kits || "";

      if (!employeeEmail || !date || !activity || !fromTime || !toTime) {
        throw new AppError(400, "SharePoint row is missing required fields for import");
      }

      const groupKey = `${employeeEmail}::${date}`;
      if (!grouped.has(groupKey)) {
        grouped.set(groupKey, []);
      }
      grouped.get(groupKey).push({
        date,
        activity,
        project,
        from_time: fromTime,
        to_time: toTime,
        overtime: false,
        kits,
      });
    }

    let importedGroups = 0;
    for (const [groupKey, entries] of grouped.entries()) {
      const [employeeEmail] = groupKey.split("::");
      const employee = await employeeRepository.findByEmail(employeeEmail);
      if (!employee) {
        throw new AppError(400, `Could not find employee for SharePoint row import: ${employeeEmail}`);
      }
      await timeEntryService.createEntries(employee, entries, { sync: false });
      importedGroups += 1;
    }

    return {
      direction: "sharepoint_to_db",
      groupsImported: importedGroups,
      rowsImported: rows.length,
    };
  },
};
