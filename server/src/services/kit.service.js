import { AppError } from "../lib/app-error.js";
import { kitRepository } from "../repositories/kit.repository.js";

function normalizeIdentifier(value) {
  const normalized = String(value || "").trim();
  return normalized ? normalized.toLowerCase() : "";
}

export const kitService = {
  async resolveKits(identifiers) {
    const resolved = await kitRepository.resolveMany(identifiers);
    const map = new Map();

    for (const row of resolved) {
      if (row.serial_number) {
        map.set(row.serial_number, row);
      }
      if (row.part_code) {
        map.set(row.part_code, row);
      }
    }

    const missing = identifiers.filter((item) => !map.has(item.trim()));
    if (missing.length) {
      throw new AppError(400, "Some kits could not be resolved", { missing });
    }

    return identifiers.map((item) => map.get(item.trim()));
  },

  async stockReportComparison() {
    const [stockRows, usedRows] = await Promise.all([
      kitRepository.listStockReportRows(),
      kitRepository.listUsedKitUsage(),
    ]);

    const usedBySerial = new Map();
    const usedByPartCode = new Map();
    const matchedUsedKeys = new Set();

    for (const row of usedRows) {
      const serialKey = normalizeIdentifier(row.serial_number);
      const partKey = normalizeIdentifier(row.part_code);
      const usage = {
        part_code: row.part_code || "",
        serial_number: row.serial_number || "",
        device_type: row.device_type || "",
        brand: row.brand || "",
        model: row.model || "",
        used_count: Number(row.used_count || 0),
        last_used_date: row.last_used_date || null,
        project_codes: String(row.project_codes || "")
          .split(",")
          .map((item) => item.trim())
          .filter(Boolean),
      };

      if (serialKey && !usedBySerial.has(serialKey)) {
        usedBySerial.set(serialKey, usage);
      }

      if (partKey && !usedByPartCode.has(partKey)) {
        usedByPartCode.set(partKey, usage);
      }
    }

    const stock = stockRows.map((row, index) => {
      const serialKey = normalizeIdentifier(row.serial_number);
      const partKey = normalizeIdentifier(row.part_code);
      const matchedUsage = (serialKey && usedBySerial.get(serialKey)) || (partKey && usedByPartCode.get(partKey)) || null;

      if (matchedUsage) {
        matchedUsedKeys.add(`${normalizeIdentifier(matchedUsage.serial_number)}|${normalizeIdentifier(matchedUsage.part_code)}`);
      }

      return {
        id: `${serialKey || partKey || "stock"}-${index}`,
        part_code: row.part_code || "",
        serial_number: row.serial_number || "",
        product_name: row.product_name || "",
        part_description: row.part_description || "",
        user_group: row.user_group || "",
        make: row.make || "",
        model: row.model || "",
        used_count: matchedUsage?.used_count || 0,
        last_used_date: matchedUsage?.last_used_date || null,
        project_codes: matchedUsage?.project_codes || [],
        status: matchedUsage ? "used_in_timesheets" : "in_stock_not_used",
        matched_by: matchedUsage ? (serialKey ? "serial_number" : "part_code") : null,
      };
    });

    const usedWithoutStock = usedRows
      .filter((row) => {
        const key = `${normalizeIdentifier(row.serial_number)}|${normalizeIdentifier(row.part_code)}`;
        return !matchedUsedKeys.has(key);
      })
      .map((row, index) => ({
        id: `used-${normalizeIdentifier(row.serial_number) || normalizeIdentifier(row.part_code) || index}`,
        part_code: row.part_code || "",
        serial_number: row.serial_number || "",
        device_type: row.device_type || "",
        brand: row.brand || "",
        model: row.model || "",
        used_count: Number(row.used_count || 0),
        last_used_date: row.last_used_date || null,
        project_codes: String(row.project_codes || "")
          .split(",")
          .map((item) => item.trim())
          .filter(Boolean),
        status: "used_not_in_stock_report",
      }));

    return {
      summary: {
        stock_rows: stock.length,
        used_in_timesheets: stock.filter((row) => row.status === "used_in_timesheets").length,
        in_stock_not_used: stock.filter((row) => row.status === "in_stock_not_used").length,
        used_not_in_stock_report: usedWithoutStock.length,
      },
      stock,
      usedWithoutStock,
    };
  },
};
