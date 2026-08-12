import crypto from "node:crypto";
import { pool } from "../../config/db.js";
import { AppError } from "../../lib/app-error.js";
import { getInventoryAccess } from "./inventory.permissions.js";
import { inventoryRepository } from "./inventory.repository.js";
import { ensureEngineerLocationSchema } from "./inventory.location.schema.js";
import { ensurePalletSchema } from "./inventory.pallet.schema.js";

function correlationContext(context = {}) {
  return {
    ...context,
    correlationId: context.correlationId || crypto.randomUUID(),
  };
}

function movementReference() {
  return `MOV-${new Date().toISOString().slice(0, 10).replaceAll("-", "")}-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
}

function auditPayload(user, context, values) {
  return {
    ...values,
    userId: user.id,
    ein: user.ein,
    ipAddress: context.ipAddress,
    userAgent: context.userAgent,
    correlationId: context.correlationId,
  };
}

function normalizedSuffix(value) {
  const suffix = String(value || "").trim().toUpperCase();
  if (!/^[A-Z0-9]{3}$/.test(suffix)) {
    throw new AppError(400, "Project must have an exactly 3-character suffix before a pallet can be created");
  }
  return suffix;
}

function uniqueIdentifiers(values) {
  return [...new Set((values || []).map((value) => String(value || "").trim()).filter(Boolean))];
}

async function loadPallet(tx, palletId, { forUpdate = false } = {}) {
  const [rows] = await tx.query(
    `SELECT p.*, pr.\`Ja_Code\` AS project_code, pr.\`Project_Name\` AS project_name,
            UPPER(pr.\`Suffix\`) AS project_suffix,
            l.location_code, l.location_type, l.assigned_employee_id
     FROM inventory_pallets p
     INNER JOIN projects pr ON pr.id = p.project_id
     INNER JOIN inventory_locations l ON l.id = p.current_location_id
     WHERE p.id = ?
     LIMIT 1 ${forUpdate ? "FOR UPDATE" : ""}`,
    [palletId],
  );
  return rows[0] || null;
}

async function loadLocation(tx, locationId, { forUpdate = false } = {}) {
  const [rows] = await tx.query(
    `SELECT l.*, w.code AS warehouse_code, w.name AS warehouse_name,
            e.name AS assigned_employee_name, e.ein AS assigned_employee_ein
     FROM inventory_locations l
     INNER JOIN inventory_warehouses w ON w.id = l.warehouse_id
     LEFT JOIN employees e ON e.id = l.assigned_employee_id
     WHERE l.id = ? AND l.active = TRUE
     LIMIT 1 ${forUpdate ? "FOR UPDATE" : ""}`,
    [locationId],
  );
  return rows[0] || null;
}

async function resolveAssets(tx, identifiers) {
  const requested = uniqueIdentifiers(identifiers);
  if (!requested.length) return [];

  const placeholders = requested.map(() => "?").join(",");
  const [rows] = await tx.query(
    `SELECT a.*, ip.part_description, ip.manufacturer_part_code, kt.code AS kit_type_code
     FROM inventory_assets a
     INNER JOIN inventory_parts ip ON ip.id = a.inventory_part_id
     INNER JOIN inventory_kit_types kt ON kt.id = ip.kit_type_id
     WHERE a.serial_number IN (${placeholders}) OR a.part_code IN (${placeholders})
     FOR UPDATE`,
    [...requested, ...requested],
  );

  const found = new Set();
  for (const row of rows) {
    found.add(String(row.serial_number));
    found.add(String(row.part_code));
  }
  const missing = requested.filter((value) => !found.has(value));
  if (missing.length) {
    throw new AppError(404, `Inventory item not found: ${missing.join(", ")}`);
  }
  return rows;
}

async function nextPalletCode(tx, suffixInput) {
  const suffix = normalizedSuffix(suffixInput);
  await tx.query(
    `INSERT INTO inventory_pallet_sequences (project_suffix, last_sequence)
     VALUES (?, 0)
     ON DUPLICATE KEY UPDATE updated_at = updated_at`,
    [suffix],
  );
  const [rows] = await tx.query(
    `SELECT project_suffix, last_sequence
     FROM inventory_pallet_sequences
     WHERE project_suffix = ?
     FOR UPDATE`,
    [suffix],
  );
  const next = Number(rows[0]?.last_sequence || 0) + 1;
  if (next > 9999) {
    throw new AppError(409, `Pallet-code sequence exhausted for ${suffix}`);
  }
  await tx.query(
    `UPDATE inventory_pallet_sequences SET last_sequence = ? WHERE project_suffix = ?`,
    [next, suffix],
  );
  return `${suffix}PLT-${String(next).padStart(4, "0")}`;
}

async function loadPalletItemsForUpdate(tx, palletId) {
  const [rows] = await tx.query(
    `SELECT pa.id AS membership_id, a.*, ip.part_description, ip.manufacturer_part_code,
            kt.code AS kit_type_code
     FROM inventory_pallet_assets pa
     INNER JOIN inventory_assets a ON a.id = pa.asset_id
     INNER JOIN inventory_parts ip ON ip.id = a.inventory_part_id
     INNER JOIN inventory_kit_types kt ON kt.id = ip.kit_type_id
     WHERE pa.pallet_id = ?
     ORDER BY a.part_code
     FOR UPDATE`,
    [palletId],
  );
  return rows;
}

async function addAssetsToPallet(tx, pallet, assets, user, reason) {
  if (pallet.pallet_status !== "OPEN") {
    throw new AppError(409, "Pallet must be OPEN before contents can be changed");
  }

  for (const asset of assets) {
    if (Number(asset.project_id) !== Number(pallet.project_id)) {
      throw new AppError(409, `${asset.part_code} belongs to a different project`);
    }
    if (Number(asset.current_location_id) !== Number(pallet.current_location_id)) {
      throw new AppError(409, `${asset.part_code} is not in pallet location ${pallet.location_code}`);
    }
    if (String(asset.current_custody) !== String(pallet.current_custody)) {
      throw new AppError(409, `${asset.part_code} custody does not match the pallet`);
    }
    if (["DISPATCHED", "IN_TRANSIT", "DELIVERED", "LOST", "RETIRED"].includes(asset.stock_status)) {
      throw new AppError(409, `${asset.part_code} cannot be placed on a pallet while status is ${asset.stock_status}`);
    }

    const [existingRows] = await tx.query(
      `SELECT pa.id, p.pallet_code
       FROM inventory_pallet_assets pa
       INNER JOIN inventory_pallets p ON p.id = pa.pallet_id
       WHERE pa.asset_id = ?
       LIMIT 1 FOR UPDATE`,
      [asset.id],
    );
    if (existingRows[0]) {
      throw new AppError(409, `${asset.part_code} is already on pallet ${existingRows[0].pallet_code}`);
    }

    await tx.query(
      `INSERT INTO inventory_pallet_assets (pallet_id, asset_id, added_by)
       VALUES (?, ?, ?)`,
      [pallet.id, asset.id, user.id],
    );
    await tx.query(
      `INSERT INTO inventory_pallet_membership_history
        (pallet_id, asset_id, action, performed_by, reason)
       VALUES (?, ?, 'ADD', ?, ?)`,
      [pallet.id, asset.id, user.id, reason || "Added to pallet"],
    );
  }
}

function inferMove(access, pallet, destination, user) {
  const storesMode = access.isStores;
  const engineeringMode = access.isEngineering && !access.isStores;

  if (storesMode) {
    if (destination.location_type === "ENGINEERING_CUSTODY") {
      return {
        nextCustody: "ENGINEERING",
        crossingStatus: "WITH_ENGINEERING",
        movementType: pallet.current_custody === "ENGINEERING" ? "PALLET_ENGINEERING_LOCATION_MOVE" : "PALLET_STORES_TO_ENGINEERING",
      };
    }
    if (pallet.current_custody === "ENGINEERING") {
      return {
        nextCustody: "STORES",
        crossingStatus: "RETURNED",
        movementType: "PALLET_ENGINEERING_TO_STORES",
      };
    }
    return {
      nextCustody: "STORES",
      crossingStatus: null,
      movementType: "PALLET_TRANSFER",
    };
  }

  if (engineeringMode) {
    if (pallet.current_custody !== "ENGINEERING") {
      throw new AppError(403, "Engineering can move only pallets already in Engineering custody");
    }
    if (destination.location_type !== "ENGINEERING_CUSTODY") {
      throw new AppError(403, "Engineering can move pallets only to Engineering custody locations");
    }
    if (Number(destination.assigned_employee_id) !== Number(user.id)) {
      throw new AppError(403, "Engineering can move pallets only to a location assigned to themselves");
    }
    return {
      nextCustody: "ENGINEERING",
      crossingStatus: "WITH_ENGINEERING",
      movementType: "PALLET_ENGINEERING_LOCATION_MOVE",
    };
  }

  throw new AppError(403, "Stores or Engineering access is required to move pallets");
}

export const inventoryPalletService = {
  async ensureSchema() {
    await ensureEngineerLocationSchema();
    return ensurePalletSchema();
  },

  async meta(user) {
    await this.ensureSchema();
    const access = getInventoryAccess(user);
    if (!access.canView) throw new AppError(403, "Inventory access required");

    const engineeringOnly = access.isEngineering && !access.isStores;
    const [projectRows, locationRows, metricRows] = await Promise.all([
      pool.query(
        `SELECT id, \`Ja_Code\` AS ja_code, \`Project_Name\` AS project_name, UPPER(\`Suffix\`) AS suffix
         FROM projects
         WHERE \`Status\` = 'active'
         ORDER BY \`Ja_Code\``),
      pool.query(
        `SELECT l.*, w.code AS warehouse_code, w.name AS warehouse_name,
                e.name AS assigned_employee_name, e.ein AS assigned_employee_ein
         FROM inventory_locations l
         INNER JOIN inventory_warehouses w ON w.id = l.warehouse_id
         LEFT JOIN employees e ON e.id = l.assigned_employee_id
         WHERE l.active = TRUE
         ${engineeringOnly ? "AND l.location_type = 'ENGINEERING_CUSTODY' AND l.assigned_employee_id = ?" : ""}
         ORDER BY l.location_type, l.location_code`,
        engineeringOnly ? [user.id] : [],
      ),
      pool.query(
        `SELECT COUNT(*) AS total,
                SUM(CASE WHEN pallet_status = 'OPEN' THEN 1 ELSE 0 END) AS open_count,
                SUM(CASE WHEN pallet_status = 'SEALED' THEN 1 ELSE 0 END) AS sealed_count,
                SUM(CASE WHEN current_custody = 'ENGINEERING' THEN 1 ELSE 0 END) AS with_engineering
         FROM inventory_pallets`),
    ]);

    const metrics = metricRows[0][0] || {};
    return {
      access: {
        mode: access.isStores ? "STORES" : engineeringOnly ? "ENGINEERING" : "READ_ONLY",
        canCreate: access.isStores,
        canManageContents: access.isStores,
        canMove: access.isStores || engineeringOnly,
      },
      projects: projectRows[0],
      locations: locationRows[0],
      metrics: {
        total: Number(metrics.total || 0),
        open: Number(metrics.open_count || 0),
        sealed: Number(metrics.sealed_count || 0),
        withEngineering: Number(metrics.with_engineering || 0),
      },
    };
  },

  async list({ q = "", limit = 100 } = {}) {
    await this.ensureSchema();
    const safeLimit = Math.min(Math.max(Number(limit) || 100, 1), 250);
    const term = `%${String(q || "").trim()}%`;
    const [rows] = await pool.query(
      `SELECT p.*, pr.\`Ja_Code\` AS project_code, pr.\`Project_Name\` AS project_name,
              UPPER(pr.\`Suffix\`) AS project_suffix,
              l.location_code, l.location_type, e.name AS assigned_employee_name,
              COUNT(pa.asset_id) AS item_count
       FROM inventory_pallets p
       INNER JOIN projects pr ON pr.id = p.project_id
       INNER JOIN inventory_locations l ON l.id = p.current_location_id
       LEFT JOIN employees e ON e.id = l.assigned_employee_id
       LEFT JOIN inventory_pallet_assets pa ON pa.pallet_id = p.id
       WHERE (? = '%%' OR p.pallet_code LIKE ? OR pr.\`Ja_Code\` LIKE ? OR pr.\`Project_Name\` LIKE ? OR l.location_code LIKE ?)
       GROUP BY p.id, pr.\`Ja_Code\`, pr.\`Project_Name\`, pr.\`Suffix\`, l.location_code, l.location_type, e.name
       ORDER BY p.updated_at DESC
       LIMIT ?`,
      [term, term, term, term, term, safeLimit],
    );
    return rows;
  },

  async get(palletId) {
    await this.ensureSchema();
    const [[palletRows], [itemRows], [movementRows], [membershipRows]] = await Promise.all([
      pool.query(
        `SELECT p.*, pr.\`Ja_Code\` AS project_code, pr.\`Project_Name\` AS project_name,
                UPPER(pr.\`Suffix\`) AS project_suffix,
                l.location_code, l.location_type, l.assigned_employee_id,
                e.name AS assigned_employee_name
         FROM inventory_pallets p
         INNER JOIN projects pr ON pr.id = p.project_id
         INNER JOIN inventory_locations l ON l.id = p.current_location_id
         LEFT JOIN employees e ON e.id = l.assigned_employee_id
         WHERE p.id = ? LIMIT 1`,
        [palletId],
      ),
      pool.query(
        `SELECT pa.added_at, a.id AS asset_id, a.serial_number, a.part_code, a.stock_status,
                a.current_custody, ip.part_description, ip.manufacturer_part_code,
                ip.manufacturer, ip.model, kt.code AS kit_type_code
         FROM inventory_pallet_assets pa
         INNER JOIN inventory_assets a ON a.id = pa.asset_id
         INNER JOIN inventory_parts ip ON ip.id = a.inventory_part_id
         INNER JOIN inventory_kit_types kt ON kt.id = ip.kit_type_id
         WHERE pa.pallet_id = ? ORDER BY a.part_code`,
        [palletId],
      ),
      pool.query(
        `SELECT pm.*, fl.location_code AS from_location_code, tl.location_code AS to_location_code,
                e.name AS performed_by_name
         FROM inventory_pallet_movements pm
         INNER JOIN inventory_locations fl ON fl.id = pm.from_location_id
         INNER JOIN inventory_locations tl ON tl.id = pm.to_location_id
         INNER JOIN employees e ON e.id = pm.performed_by
         WHERE pm.pallet_id = ? ORDER BY pm.moved_at DESC`,
        [palletId],
      ),
      pool.query(
        `SELECT h.*, a.serial_number, a.part_code, e.name AS performed_by_name
         FROM inventory_pallet_membership_history h
         INNER JOIN inventory_assets a ON a.id = h.asset_id
         INNER JOIN employees e ON e.id = h.performed_by
         WHERE h.pallet_id = ? ORDER BY h.occurred_at DESC LIMIT 200`,
        [palletId],
      ),
    ]);

    if (!palletRows[0]) throw new AppError(404, "Pallet not found");
    return {
      pallet: palletRows[0],
      items: itemRows,
      movements: movementRows,
      membershipHistory: membershipRows,
    };
  },

  async create(payload, user, contextInput = {}) {
    await this.ensureSchema();
    const access = getInventoryAccess(user);
    if (!access.isStores) throw new AppError(403, "Stores access is required to create pallets");
    const context = correlationContext(contextInput);
    let palletId;

    await inventoryRepository.transaction(async (tx) => {
      const project = await inventoryRepository.loadProject(tx, payload.projectId, { forUpdate: true });
      if (!project || project.status !== "active") throw new AppError(404, "Active project not found");
      const suffix = normalizedSuffix(project.suffix);
      const location = await loadLocation(tx, payload.locationId, { forUpdate: true });
      if (!location) throw new AppError(404, "Pallet location not found");
      const palletCode = await nextPalletCode(tx, suffix);
      const custody = location.location_type === "ENGINEERING_CUSTODY" ? "ENGINEERING" : "STORES";

      const [result] = await tx.query(
        `INSERT INTO inventory_pallets
          (pallet_code, project_id, current_location_id, current_custody, pallet_status,
           description, created_by, updated_by)
         VALUES (?, ?, ?, ?, 'OPEN', ?, ?, ?)`,
        [palletCode, project.id, location.id, custody, payload.description || null, user.id, user.id],
      );
      palletId = result.insertId;
      const pallet = {
        id: palletId,
        project_id: project.id,
        current_location_id: location.id,
        current_custody: custody,
        pallet_status: "OPEN",
        location_code: location.location_code,
      };

      const assets = await resolveAssets(tx, payload.identifiers || []);
      await addAssetsToPallet(tx, pallet, assets, user, payload.reason || "Initial pallet contents");

      await inventoryRepository.insertAudit(tx, auditPayload(user, context, {
        eventType: "PALLET_CREATED",
        entityType: "inventory_pallet",
        entityId: palletId,
        action: "CREATE",
        afterValue: {
          palletCode,
          projectId: project.id,
          locationId: location.id,
          custody,
          itemCount: assets.length,
        },
      }));
    });

    return this.get(palletId);
  },

  async addItems(palletId, payload, user, contextInput = {}) {
    await this.ensureSchema();
    const access = getInventoryAccess(user);
    if (!access.isStores) throw new AppError(403, "Stores access is required to change pallet contents");
    const context = correlationContext(contextInput);

    await inventoryRepository.transaction(async (tx) => {
      const pallet = await loadPallet(tx, palletId, { forUpdate: true });
      if (!pallet) throw new AppError(404, "Pallet not found");
      const assets = await resolveAssets(tx, payload.identifiers);
      await addAssetsToPallet(tx, pallet, assets, user, payload.reason);
      await inventoryRepository.insertAudit(tx, auditPayload(user, context, {
        eventType: "PALLET_ITEMS_ADDED",
        entityType: "inventory_pallet",
        entityId: pallet.id,
        action: "ADD_ITEMS",
        afterValue: { identifiers: payload.identifiers, addedCount: assets.length },
      }));
    });
    return this.get(palletId);
  },

  async removeItems(palletId, payload, user, contextInput = {}) {
    await this.ensureSchema();
    const access = getInventoryAccess(user);
    if (!access.isStores) throw new AppError(403, "Stores access is required to change pallet contents");
    const context = correlationContext(contextInput);

    await inventoryRepository.transaction(async (tx) => {
      const pallet = await loadPallet(tx, palletId, { forUpdate: true });
      if (!pallet) throw new AppError(404, "Pallet not found");
      if (pallet.pallet_status !== "OPEN") throw new AppError(409, "Pallet must be OPEN before contents can be changed");
      const assets = await resolveAssets(tx, payload.identifiers);

      for (const asset of assets) {
        const [membershipRows] = await tx.query(
          `SELECT id FROM inventory_pallet_assets WHERE pallet_id = ? AND asset_id = ? LIMIT 1 FOR UPDATE`,
          [pallet.id, asset.id],
        );
        if (!membershipRows[0]) throw new AppError(409, `${asset.part_code} is not on this pallet`);
        await tx.query(`DELETE FROM inventory_pallet_assets WHERE id = ?`, [membershipRows[0].id]);
        await tx.query(
          `INSERT INTO inventory_pallet_membership_history
            (pallet_id, asset_id, action, performed_by, reason)
           VALUES (?, ?, 'REMOVE', ?, ?)`,
          [pallet.id, asset.id, user.id, payload.reason || "Removed from pallet"],
        );
      }

      await inventoryRepository.insertAudit(tx, auditPayload(user, context, {
        eventType: "PALLET_ITEMS_REMOVED",
        entityType: "inventory_pallet",
        entityId: pallet.id,
        action: "REMOVE_ITEMS",
        afterValue: { identifiers: payload.identifiers, removedCount: assets.length },
      }));
    });
    return this.get(palletId);
  },

  async setStatus(palletId, payload, user, contextInput = {}) {
    await this.ensureSchema();
    const access = getInventoryAccess(user);
    if (!access.isStores) throw new AppError(403, "Stores access is required to change pallet status");
    const context = correlationContext(contextInput);

    await inventoryRepository.transaction(async (tx) => {
      const pallet = await loadPallet(tx, palletId, { forUpdate: true });
      if (!pallet) throw new AppError(404, "Pallet not found");
      const nextStatus = payload.status;
      await tx.query(
        `UPDATE inventory_pallets SET pallet_status = ?, version = version + 1, updated_by = ? WHERE id = ?`,
        [nextStatus, user.id, pallet.id],
      );
      await inventoryRepository.insertAudit(tx, auditPayload(user, context, {
        eventType: "PALLET_STATUS_CHANGED",
        entityType: "inventory_pallet",
        entityId: pallet.id,
        action: "STATUS",
        beforeValue: { status: pallet.pallet_status },
        afterValue: { status: nextStatus },
      }));
    });
    return this.get(palletId);
  },

  async move(palletId, payload, user, contextInput = {}) {
    await this.ensureSchema();
    const access = getInventoryAccess(user);
    const context = correlationContext(contextInput);

    await inventoryRepository.transaction(async (tx) => {
      const pallet = await loadPallet(tx, palletId, { forUpdate: true });
      if (!pallet) throw new AppError(404, "Pallet not found");
      if (["DELIVERED", "CLOSED"].includes(pallet.pallet_status)) {
        throw new AppError(409, `Pallet cannot be moved while status is ${pallet.pallet_status}`);
      }
      const destination = await loadLocation(tx, payload.toLocationId, { forUpdate: true });
      if (!destination) throw new AppError(404, "Destination location not found");
      if (Number(destination.id) === Number(pallet.current_location_id)) {
        throw new AppError(409, "Pallet is already in the selected location");
      }

      const moveRule = inferMove(access, pallet, destination, user);
      const items = await loadPalletItemsForUpdate(tx, pallet.id);
      for (const asset of items) {
        if (Number(asset.current_location_id) !== Number(pallet.current_location_id) || String(asset.current_custody) !== String(pallet.current_custody)) {
          throw new AppError(409, `Pallet contents are out of sync at ${asset.part_code}; reconcile the kit location before moving the pallet`);
        }
        if (["DISPATCHED", "IN_TRANSIT", "DELIVERED", "LOST", "RETIRED"].includes(asset.stock_status)) {
          throw new AppError(409, `${asset.part_code} cannot move with the pallet while status is ${asset.stock_status}`);
        }
      }

      const crossingStatus = moveRule.crossingStatus;
      for (const asset of items) {
        const nextStatus = crossingStatus || asset.stock_status;
        await tx.query(
          `UPDATE inventory_assets
           SET current_location_id = ?, current_custody = ?, stock_status = ?,
               version = version + 1, updated_by = ?
           WHERE id = ?`,
          [destination.id, moveRule.nextCustody, nextStatus, user.id, asset.id],
        );
      }

      await tx.query(
        `UPDATE inventory_pallets
         SET current_location_id = ?, current_custody = ?, version = version + 1, updated_by = ?
         WHERE id = ?`,
        [destination.id, moveRule.nextCustody, user.id, pallet.id],
      );

      let inventoryMovementId = null;
      if (items.length) {
        inventoryMovementId = await inventoryRepository.insertMovement(tx, {
          movementReference: movementReference(),
          movementType: moveRule.movementType,
          fromLocationId: pallet.current_location_id,
          toLocationId: destination.id,
          fromCustody: pallet.current_custody,
          toCustody: moveRule.nextCustody,
          projectId: pallet.project_id,
          performedBy: user.id,
          reference: payload.reference || pallet.pallet_code,
          reason: payload.reason || `Pallet ${pallet.pallet_code} movement`,
          correlationId: context.correlationId,
          items: items.map((asset) => ({
            assetId: asset.id,
            inventoryPartId: asset.inventory_part_id,
            serialNumber: asset.serial_number,
            partCode: asset.part_code,
            quantity: 1,
          })),
        });
      }

      await tx.query(
        `INSERT INTO inventory_pallet_movements
          (pallet_id, inventory_movement_id, from_location_id, to_location_id,
           from_custody, to_custody, performed_by, reference, reason, correlation_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          pallet.id,
          inventoryMovementId,
          pallet.current_location_id,
          destination.id,
          pallet.current_custody,
          moveRule.nextCustody,
          user.id,
          payload.reference || null,
          payload.reason || `Pallet ${pallet.pallet_code} movement`,
          context.correlationId,
        ],
      );

      await inventoryRepository.insertAudit(tx, auditPayload(user, context, {
        eventType: moveRule.movementType,
        entityType: "inventory_pallet",
        entityId: pallet.id,
        action: "MOVE",
        beforeValue: {
          palletCode: pallet.pallet_code,
          locationId: pallet.current_location_id,
          custody: pallet.current_custody,
          itemCount: items.length,
        },
        afterValue: {
          locationId: destination.id,
          locationCode: destination.location_code,
          custody: moveRule.nextCustody,
          assignedEmployeeId: destination.assigned_employee_id || null,
          assignedEmployeeName: destination.assigned_employee_name || null,
          inventoryMovementId,
        },
      }));
    });

    return this.get(palletId);
  },
};
