import { parse } from "csv-parse/sync";
import { AppError } from "../lib/app-error.js";
import { timeEntryService } from "./time-entry.service.js";
import { projectRepository } from "../repositories/project.repository.js";
import { kitRepository } from "../repositories/kit.repository.js";

const TIME_CSV_REQUIRED_COLUMNS = [
  "date",
  "activity",
  "project",
  "from_time",
  "to_time",
  "overtime",
  "kits",
];

const KIT_CSV_REQUIRED_COLUMNS = [
  "project_ja_code",
  "part_code",
  "serial_number",
  "device_type",
  "brand",
  "model",
];

function assertRequiredColumns(records, requiredColumns, label) {
  const firstRow = records[0] || {};
  const columns = Object.keys(firstRow);
  const missing = requiredColumns.filter((column) => !columns.includes(column));

  if (missing.length) {
    throw new AppError(
      400,
      `${label} CSV is missing required columns: ${missing.join(", ")}`
    );
  }
}

export const csvService = {
  async parseAndValidate(csvContent, employee) {
    const records = parse(csvContent, {
      columns: true,
      skip_empty_lines: true,
      trim: true,
    });

    if (!records.length) {
      throw new AppError(400, "CSV contains no data");
    }

    assertRequiredColumns(records, TIME_CSV_REQUIRED_COLUMNS, "Time entry");

    const normalized = records.map((row, index) => {
      const kitsValue = String(row.kits ?? "").trim();

      if (kitsValue.includes(",") || kitsValue.includes("|")) {
        throw new AppError(
          400,
          `Time entry CSV row ${index + 1}: kits must be space-separated only`
        );
      }

      return {
        date: row.date,
        activity: row.activity,
        order_num: row.order_num ?? "",
        project: row.project ?? "",
        from_time: row.from_time,
        to_time: row.to_time,
        overtime: String(row.overtime).toLowerCase() === "true",
        kits: kitsValue
          .split(/\s+/)
          .filter(Boolean)
          .join(" "),
      };
    });

    const { entries, totalHours } = await timeEntryService.validateEntries(employee, normalized);

    return {
      preview: entries,
      totalHours,
    };
  },

  async parseKitCsv(csvContent) {
    const records = parse(csvContent, {
      columns: true,
      skip_empty_lines: true,
      trim: true,
    });

    if (!records.length) {
      throw new AppError(400, "CSV contains no kit data");
    }

    assertRequiredColumns(records, KIT_CSV_REQUIRED_COLUMNS, "Kit");

    const normalized = [];
    for (const [index, row] of records.entries()) {
      const projectJaCode = row.project_ja_code?.trim() 
                         || row.project?.trim() 
                         || row.ja_code?.trim() 
                         || null;

      if (projectJaCode) {
        const project = await projectRepository.findByCode(projectJaCode);
        if (!project) {
          throw new AppError(400, `Invalid project reference in kit CSV: ${projectJaCode}`);
        }
      }

      normalized.push({
        project_ja_code: projectJaCode,
        part_code: row.part_code?.trim() || "",
        serial_number: row.serial_number?.trim() || "",
        device_type: row.device_type?.trim() || "",
        brand: row.brand?.trim() || "",
        model: row.model?.trim() || "",
      });

      if (!row.part_code?.trim() && !row.serial_number?.trim()) {
        throw new AppError(
          400,
          `Kit CSV row ${index + 1}: each row needs at least part_code or serial_number`
        );
      }
    }

    return normalized;
  },

  async importKitCsv(csvContent) {
    const preview = await this.parseKitCsv(csvContent);
    const saved = [];
    for (const row of preview) {
      saved.push(await kitRepository.upsert(row));
    }
    return {
      count: saved.length,
      kits: saved,
    };
  },
};
