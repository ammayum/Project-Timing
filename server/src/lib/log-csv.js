import { parse } from "csv-parse/sync";
import { AppError } from "./app-error.js";

export function parseLogCsv(csvContent) {
  let records;
  try {
    records = parse(csvContent, {
      columns: true,
      skip_empty_lines: true,
      trim: true,
      bom: true,
    });
  } catch (_parseError) {
    throw new AppError(400, "Invalid CSV format");
  }

  const hasNamedColumns = records.some((record) => (
    Object.prototype.hasOwnProperty.call(record, "name")
    || Object.prototype.hasOwnProperty.call(record, "Name")
  ));

  if (hasNamedColumns) {
    return records.map((record) => ({
      name: record.name ?? record.Name ?? "",
      serial_numbers: record.serial_numbers
        ?? record.serials
        ?? record.serial_list
        ?? record["serial numbers"]
        ?? "",
    }));
  }

  let rows;
  try {
    rows = parse(csvContent, {
      columns: false,
      skip_empty_lines: true,
      trim: true,
      bom: true,
    });
  } catch (_parseError) {
    throw new AppError(400, "Invalid CSV format");
  }

  return rows.map((row) => ({
    name: row[0] ?? "",
    serial_numbers: row[1] ?? "",
  }));
}
