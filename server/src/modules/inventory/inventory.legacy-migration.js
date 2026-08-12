import crypto from "node:crypto";
import { pool } from "../../config/db.js";
import { AppError } from "../../lib/app-error.js";
import { inventoryRepository } from "./inventory.repository.js";

const TYPE_MAP = [
  [/router|routing|isr|asr/i, "RTR"],
  [/switch|switching|catalyst|nexus/i, "SWI"],
  [/firewall|fortigate|asa|security appliance/i, "FIR"],
  [/access point|wireless|\bap\b/i, "APL"],
  [/server/i, "SRV"],
  [/\bups\b/i, "UPS"],
  [/\bpdu\b|power distribution/i, "PDU"],
  [/modem/i, "MOD"],
  [/antenna/i, "ANT"],
  [/cable|patch lead/i, "CAB"],
  [/power supply|\bpsu\b/i, "PSU"],
];

function inferKitTypeCode(deviceType) {
  const value = String(deviceType || "").trim();
  return TYPE_MAP.find(([pattern]) => pattern.test(value))?.[1] || "ACC";
}

function correlationId() {
  return crypto.randomUUID();
}

async function resolveProject(tx, legacyKit) {
  if (legacyKit.project_id) {
    const project = await inventoryRepository.loadProject(tx, legacyKit.project_id, { forUpdate: true });
    if (project) return project;
  }

  if (!legacyKit.project_ja_code) return null;
  const [rows] = await tx.query(
    `SELECT id, \`Ja_Code\` AS ja_code, \`Project_Name\` AS project_name,
            UPPER(\`Suffix\`) AS suffix, \`Status\` AS status
     FROM projects
     WHERE \`Ja_Code\` = ? AND \`Status\` = 'active'
     ORDER BY id ASC LIMIT 1 FOR UPDATE`,
    [legacyKit.project_ja_code],
  );
  return rows[0] || null;
}

async function resolveOrCreatePart(tx, legacyKit, kitTypeId, userId) {
  const manufacturer = String(legacyKit.brand || "").trim();
  const model = String(legacyKit.model || "").trim();
  const description = String(legacyKit.device_type || "Legacy inventory asset").trim() || "Legacy inventory asset";
  const [rows] = await tx.query(
    `SELECT id FROM inventory_parts
     WHERE kit_type_id = ? AND serialized = TRUE
       AND COALESCE(manufacturer, '') = ? AND COALESCE(model, '') = ?
       AND part_description = ?
     LIMIT 1 FOR UPDATE`,
    [kitTypeId, manufacturer, model, description],
  );
  if (rows[0]) return rows[0].id;

  const [result] = await tx.query(
    `INSERT INTO inventory_parts
      (manufacturer_part_code, part_description, manufacturer, model, kit_type_id, serialized,
       stock_type, unit_of_measure, active, created_by)
     VALUES (NULL, ?, ?, ?, ?, TRUE, 'STANDARD', 'EA', TRUE, ?)`,
    [description, manufacturer || null, model || null, kitTypeId, userId],
  );
  return result.insertId;
}

export const inventoryLegacyMigration = {
  async migrate({ defaultLocationId }, user, requestContext = {}) {
    await inventoryRepository.ensureReady();
    const [legacyKits] = await pool.query(
      `SELECT * FROM kits
       WHERE TRIM(COALESCE(serial_number, '')) <> ''
       ORDER BY id ASC`,
    );

    const summary = { scanned: legacyKits.length, imported: 0, skipped: 0, failed: 0, errors: [] };

    for (const legacyKit of legacyKits) {
      try {
        const result = await inventoryRepository.transaction(async (tx) => {
          const serial = String(legacyKit.serial_number).trim();
          const [existingRows] = await tx.query(`SELECT id, part_code FROM inventory_assets WHERE serial_number = ? LIMIT 1 FOR UPDATE`, [serial]);
          if (existingRows[0]) return { skipped: true, reason: "Serial already migrated" };

          const location = await inventoryRepository.loadLocation(tx, defaultLocationId);
          if (!location) throw new AppError(404, "Default migration location not found");
          const project = await resolveProject(tx, legacyKit);
          if (!project) throw new AppError(409, `Project not found for legacy kit ${legacyKit.id}`);
          const suffix = String(project.suffix || "").trim().toUpperCase();
          if (!/^[A-Z0-9]{3}$/.test(suffix)) throw new AppError(409, `Project ${project.ja_code} does not have a valid 3-character suffix`);

          const kitTypeCode = inferKitTypeCode(legacyKit.device_type);
          const [typeRows] = await tx.query(`SELECT id, code FROM inventory_kit_types WHERE code = ? LIMIT 1 FOR UPDATE`, [kitTypeCode]);
          if (!typeRows[0]) throw new AppError(409, `Kit type ${kitTypeCode} is not configured`);
          const partId = await resolveOrCreatePart(tx, legacyKit, typeRows[0].id, user.id);
          const partCode = await inventoryRepository.nextPartCode(tx, suffix, kitTypeCode);

          const [assetResult] = await tx.query(
            `INSERT INTO inventory_assets
              (serial_number, part_code, inventory_part_id, project_id, current_location_id,
               current_custody, stock_status, condition_status, created_by, updated_by)
             VALUES (?, ?, ?, ?, ?, 'STORES', 'AVAILABLE', 'GOOD', ?, ?)`,
            [serial, partCode, partId, project.id, location.id, user.id, user.id],
          );
          const assetId = assetResult.insertId;
          const cid = requestContext.correlationId || correlationId();
          const movementId = await inventoryRepository.insertMovement(tx, {
            movementReference: `MIG-${String(legacyKit.id).padStart(6, "0")}-${crypto.randomUUID().slice(0, 6).toUpperCase()}`,
            movementType: "INITIAL_RECEIPT",
            toLocationId: location.id,
            toCustody: "STORES",
            projectId: project.id,
            performedBy: user.id,
            reference: `LEGACY-KIT-${legacyKit.id}`,
            reason: "Migrated from existing kits table",
            correlationId: cid,
            items: [{ assetId, inventoryPartId: partId, serialNumber: serial, partCode, quantity: 1 }],
          });

          await tx.query(
            `INSERT INTO inventory_asset_part_code_history
              (asset_id, serial_number, old_part_code, new_part_code, old_project_id, new_project_id, changed_by, reason, movement_id)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [assetId, serial, legacyKit.part_code || null, partCode, legacyKit.project_id || project.id, project.id, user.id,
             "Legacy kit migrated to project part-code standard", movementId],
          );

          await tx.query(
            `UPDATE kits
             SET project_id = ?, project_ja_code = ?, part_code = ?
             WHERE id = ?`,
            [project.id, project.ja_code, partCode, legacyKit.id],
          );

          await inventoryRepository.insertAudit(tx, {
            eventType: "LEGACY_KIT_MIGRATED",
            entityType: "inventory_asset",
            entityId: assetId,
            action: "MIGRATE",
            userId: user.id,
            ein: user.ein,
            beforeValue: { legacyKitId: legacyKit.id, legacyPartCode: legacyKit.part_code, serialNumber: serial },
            afterValue: { assetId, partCode, projectId: project.id, locationId: location.id },
            ipAddress: requestContext.ipAddress || null,
            userAgent: requestContext.userAgent || null,
            correlationId: cid,
          });

          return { skipped: false, assetId, partCode };
        });

        if (result.skipped) summary.skipped += 1;
        else summary.imported += 1;
      } catch (error) {
        summary.failed += 1;
        summary.errors.push({ legacyKitId: legacyKit.id, serialNumber: legacyKit.serial_number, message: error.message });
      }
    }

    return summary;
  },
};
