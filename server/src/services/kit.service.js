import { AppError } from "../lib/app-error.js";
import { withTransaction } from "../config/db.js";
import { kitRepository } from "../repositories/kit.repository.js";

function normalizeIdentifier(value) {
  const normalized = String(value || "").trim();
  return normalized ? normalized.toLowerCase() : "";
}

function splitSerialList(value) {
  return [...new Set(
    String(value || "")
      .split(/\s+/)
      .map((item) => item.trim())
      .filter(Boolean),
  )];
}

const STOCK_FIELD_MAP = [
  ["device_type", "product_name"],
  ["brand", "make"],
  ["model", "model"],
];

function isReplaceableValue(value) {
  const normalized = String(value || "").trim().toLowerCase();
  return !normalized || normalized === "unknown" || normalized === "auto-created";
}

function buildProposedChanges(kit, stockRow) {
  return Object.fromEntries(
    STOCK_FIELD_MAP.flatMap(([kitField, stockField]) => {
      const currentValue = String(kit?.[kitField] || "").trim();
      const stockValue = String(stockRow?.[stockField] || "").trim();

      if (!stockValue || !isReplaceableValue(currentValue) || currentValue.toLowerCase() === stockValue.toLowerCase()) {
        return [];
      }

      return [[kitField, { from: currentValue, to: stockValue }]];
    }),
  );
}

function addToIdentifierMap(map, value, kit) {
  const key = normalizeIdentifier(value);
  if (!key) {
    return;
  }

  const entries = map.get(key) || [];
  if (!entries.some((entry) => entry.id === kit.id)) {
    entries.push(kit);
  }
  map.set(key, entries);
}

function findStockKitMatch(stockRow, kitsByIdentifier) {
  const serialKey = normalizeIdentifier(stockRow.serial_number);
  const partKey = normalizeIdentifier(stockRow.part_code);
  const serialMatches = serialKey ? kitsByIdentifier.get(serialKey) || [] : [];
  const partMatches = partKey ? kitsByIdentifier.get(partKey) || [] : [];

  if (!serialKey && !partKey) {
    return { status: "ignored", reason: "missing_identifier", kit: null, matchedBy: null };
  }

  if (serialMatches.length > 1 || partMatches.length > 1) {
    return { status: "conflict", reason: "duplicate_kit_identifier", kit: null, matchedBy: null };
  }

  if (serialMatches[0] && partMatches[0] && serialMatches[0].id !== partMatches[0].id) {
    return { status: "conflict", reason: "serial_and_part_code_match_different_kits", kit: null, matchedBy: null };
  }

  if (serialMatches[0]) {
    return { status: "matched", reason: null, kit: serialMatches[0], matchedBy: "serial_number" };
  }

  if (partMatches[0]) {
    return { status: "matched", reason: null, kit: partMatches[0], matchedBy: "part_code" };
  }

  return { status: "unmatched", reason: "kit_not_found", kit: null, matchedBy: null };
}

function buildStockKitMatches(stockRows, kits) {
  const kitsByIdentifier = new Map();
  const stockSerialCounts = new Map();
  const stockPartCounts = new Map();

  for (const stockRow of stockRows) {
    const serialKey = normalizeIdentifier(stockRow.serial_number);
    const partKey = normalizeIdentifier(stockRow.part_code);
    if (serialKey) {
      stockSerialCounts.set(serialKey, (stockSerialCounts.get(serialKey) || 0) + 1);
    }
    if (partKey) {
      stockPartCounts.set(partKey, (stockPartCounts.get(partKey) || 0) + 1);
    }
  }

  for (const kit of kits) {
    // Legacy kit rows may store either a serial number or a part code in serial_number.
    addToIdentifierMap(kitsByIdentifier, kit.serial_number, kit);
    addToIdentifierMap(kitsByIdentifier, kit.part_code, kit);
  }

  return stockRows.map((stockRow, index) => {
    const serialKey = normalizeIdentifier(stockRow.serial_number);
    const partKey = normalizeIdentifier(stockRow.part_code);
    const duplicateStockIdentifier = (serialKey && stockSerialCounts.get(serialKey) > 1)
      || (!serialKey && partKey && stockPartCounts.get(partKey) > 1);
    const match = duplicateStockIdentifier
      ? { status: "conflict", reason: "duplicate_stock_report_row", kit: null, matchedBy: null }
      : findStockKitMatch(stockRow, kitsByIdentifier);
    const proposedChanges = buildProposedChanges(match.kit, stockRow);
    const matchStatus = match.status === "matched" && Object.keys(proposedChanges).length === 0
      ? "up_to_date"
      : match.status;

    return {
      id: `${normalizeIdentifier(stockRow.serial_number) || "stock"}-${normalizeIdentifier(stockRow.part_code) || index}-${index}`,
      part_code: stockRow.part_code || "",
      serial_number: stockRow.serial_number || "",
      product_name: stockRow.product_name || "",
      part_description: stockRow.part_description || "",
      user_group: stockRow.user_group || "",
      make: stockRow.make || "",
      model: stockRow.model || "",
      match_status: matchStatus,
      match_reason: match.reason,
      matched_by: match.matchedBy,
      kit: match.kit
        ? {
            id: match.kit.id,
            part_code: match.kit.part_code || "",
            serial_number: match.kit.serial_number || "",
            device_type: match.kit.device_type || "",
            brand: match.kit.brand || "",
            model: match.kit.model || "",
            project_ja_code: match.kit.project_ja_code || "",
          }
        : null,
      proposed_changes: proposedChanges,
      updateable: match.status === "matched" && Object.keys(proposedChanges).length > 0,
    };
  });
}

function sameIdentifier(left, right) {
  const leftSerial = normalizeIdentifier(left.serial_number);
  const leftPart = normalizeIdentifier(left.part_code);
  const rightSerial = normalizeIdentifier(right.serial_number);
  const rightPart = normalizeIdentifier(right.part_code);

  if (rightSerial && rightPart) {
    return rightSerial === leftSerial && rightPart === leftPart;
  }

  return (rightSerial && rightSerial === leftSerial) || (rightPart && rightPart === leftPart);
}

async function updateKitFromStock(client, stockRow, actorId) {
  const [kitRows] = await client.query(
    `
      SELECT id, part_code, serial_number, project_ja_code, device_type, brand, model
      FROM kits
      WHERE id = ?
      FOR UPDATE
    `,
    [stockRow.kit.id],
  );
  const kit = kitRows[0];

  if (!kit) {
    return { status: "skipped", reason: "kit_not_found", stockRow };
  }

  const proposedChanges = buildProposedChanges(kit, stockRow);
  const changedFields = Object.keys(proposedChanges);
  if (!changedFields.length) {
    return { status: "unchanged", stockRow, kit };
  }

  const updateValues = changedFields.map((field) => proposedChanges[field].to);
  const assignments = changedFields.map((field) => `${field} = ?`).join(", ");
  await client.query(`UPDATE kits SET ${assignments} WHERE id = ?`, [...updateValues, kit.id]);

  const newValues = Object.fromEntries(changedFields.map((field) => [field, proposedChanges[field].to]));
  await client.query(
    `
      INSERT INTO kit_stock_update_audit
        (actor_employee_id, kit_id, part_code, serial_number, matched_by, old_values, new_values)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `,
    [
      actorId,
      kit.id,
      stockRow.part_code || null,
      stockRow.serial_number || null,
      stockRow.matched_by,
      JSON.stringify(Object.fromEntries(changedFields.map((field) => [field, kit[field] || ""]))),
      JSON.stringify(newValues),
    ],
  );

  return {
    status: "updated",
    stockRow,
    kit: { ...kit, ...newValues },
    changed_fields: changedFields,
  };
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
    const [stockRows, usedRows, kits] = await Promise.all([
      kitRepository.listStockReportRows(),
      kitRepository.listUsedKitUsage(),
      kitRepository.listAll(),
    ]);

    const usedBySerial = new Map();
    const usedByPartCode = new Map();
    const matchedUsedKeys = new Set();

    const addUsageIdentifier = (map, value, usage) => {
      const key = normalizeIdentifier(value);
      if (key && !map.has(key)) {
        map.set(key, usage);
      }
    };

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

      // Legacy kit records may store a part code in serial_number (or vice versa).
      // Index both fields in both lookup maps so stock and usage reconcile by either identifier.
      addUsageIdentifier(usedBySerial, row.serial_number, usage);
      addUsageIdentifier(usedBySerial, row.part_code, usage);
      addUsageIdentifier(usedByPartCode, row.part_code, usage);
      addUsageIdentifier(usedByPartCode, row.serial_number, usage);
    }

    const stockMatches = buildStockKitMatches(stockRows, kits);
    const stock = stockMatches.map((row) => {
      const serialKey = normalizeIdentifier(row.serial_number);
      const partKey = normalizeIdentifier(row.part_code);
      const matchedUsageBySerial = serialKey ? usedBySerial.get(serialKey) : null;
      const matchedUsageByPartCode = partKey ? usedByPartCode.get(partKey) : null;
      const matchedUsage = matchedUsageBySerial || matchedUsageByPartCode || null;
      const usageMatchedBy = matchedUsageBySerial ? "serial_number" : matchedUsageByPartCode ? "part_code" : null;

      if (matchedUsage) {
        matchedUsedKeys.add(`${normalizeIdentifier(matchedUsage.serial_number)}|${normalizeIdentifier(matchedUsage.part_code)}`);
      }

      return {
        ...row,
        used_count: matchedUsage?.used_count || 0,
        last_used_date: matchedUsage?.last_used_date || null,
        project_codes: matchedUsage?.project_codes || [],
        status: matchedUsage ? "used_in_timesheets" : "in_stock_not_used",
        usage_matched_by: usageMatchedBy,
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

  async compareLogWithStock(rows = [], uploadedStockSerials = "") {
    const uploadedIdentifiers = splitSerialList(uploadedStockSerials);
    const stockRows = uploadedIdentifiers.length ? [] : await kitRepository.listStockReportRows();
    const stockByIdentifier = new Map();

    const addStockIdentifier = (value, stockRow, matchedBy) => {
      const key = normalizeIdentifier(value);
      if (!key) {
        return;
      }

      const matches = stockByIdentifier.get(key) || [];
      matches.push({
        part_code: stockRow.part_code || "",
        serial_number: stockRow.serial_number || "",
        matched_by: matchedBy,
      });
      stockByIdentifier.set(key, matches);
    };

    for (const stockRow of stockRows) {
      // Include part_code because legacy imports can place a serial-like value there.
      addStockIdentifier(stockRow.serial_number, stockRow, "serial_number");
      addStockIdentifier(stockRow.part_code, stockRow, "part_code");
    }

    for (const serialNumber of uploadedIdentifiers) {
      addStockIdentifier(serialNumber, { serial_number: serialNumber, part_code: "" }, "uploaded_stock_list");
    }

    const results = [];
    for (const row of rows) {
      const name = String(row.name || "").trim();
      for (const serialNumber of splitSerialList(row.serial_numbers)) {
        const matches = stockByIdentifier.get(normalizeIdentifier(serialNumber)) || [];
        const stockMatch = matches[0] || null;
        results.push({
          name,
          serial_number: serialNumber,
          status: stockMatch ? "found_on_stock" : "not_on_stock",
          matched_by: stockMatch?.matched_by || null,
          stock_serial_number: stockMatch?.serial_number || null,
          stock_part_code: stockMatch?.part_code || null,
          duplicate_stock_matches: matches.length > 1,
        });
      }
    }

    return {
      summary: {
        submitted: results.length,
        found_on_stock: results.filter((row) => row.status === "found_on_stock").length,
        not_on_stock: results.filter((row) => row.status === "not_on_stock").length,
      },
      results,
    };
  },

  async updateFromStockReport({ actorId, scope, rows = [] }) {
    const report = await this.stockReportComparison();
    const validMatches = report.stock.filter((row) => row.updateable);
    const requestedRows = scope === "all-valid"
      ? report.stock
      : report.stock.filter((row) => rows.some((selectedRow) => sameIdentifier(row, selectedRow)));
    const selectedRows = scope === "all-valid"
      ? validMatches
      : requestedRows.filter((row) => row.match_status === "matched" || row.match_status === "up_to_date");
    const skipped = scope === "all-valid"
      ? report.stock.filter((row) => !row.updateable && row.match_status !== "up_to_date")
      : requestedRows.filter((row) => row.match_status !== "matched" && row.match_status !== "up_to_date");
    if (!selectedRows.length) {
      return {
        updated_count: 0,
        unchanged_count: 0,
        skipped_count: skipped.length,
        updated: [],
        unchanged: [],
        skipped,
      };
    }

    const result = await withTransaction(async (client) => {
      if (!client) {
        throw new AppError(503, "Database transactions are unavailable");
      }

      const updated = [];
      const unchanged = [];
      const transactionSkipped = [];

      for (const stockRow of selectedRows) {
        const updateResult = await updateKitFromStock(client, stockRow, actorId);
        if (updateResult.status === "updated") {
          updated.push(updateResult);
        } else if (updateResult.status === "unchanged") {
          unchanged.push(updateResult);
        } else {
          transactionSkipped.push(updateResult);
        }
      }

      return { updated, unchanged, transactionSkipped };
    });

    return {
      updated_count: result.updated.length,
      unchanged_count: result.unchanged.length,
      skipped_count: skipped.length + result.transactionSkipped.length,
      updated: result.updated,
      unchanged: result.unchanged,
      skipped: [...skipped, ...result.transactionSkipped],
    };
  },
};
