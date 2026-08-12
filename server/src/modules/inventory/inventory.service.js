import crypto from "node:crypto";
import { AppError } from "../../lib/app-error.js";
import { inventoryRepository } from "./inventory.repository.js";
import { getInventoryAccess } from "./inventory.permissions.js";

const STORES_ASSET_STATUSES = new Set([
  "AVAILABLE",
  "RESERVED",
  "PICKED",
  "READY_FOR_HANDOVER",
  "RETURNED",
  "READY_TO_PACK",
  "PACKED",
  "READY_TO_SHIP",
  "QUARANTINE",
  "DAMAGED",
]);

function ref(prefix) {
  return `${prefix}-${new Date().toISOString().slice(0, 10).replaceAll("-", "")}-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
}

function contextWithId(context = {}) {
  return {
    ...context,
    correlationId: context.correlationId || crypto.randomUUID(),
  };
}

function validateProjectSuffix(project) {
  const suffix = String(project?.suffix || "").trim().toUpperCase();
  if (!/^[A-Z0-9]{3}$/.test(suffix)) {
    throw new AppError(400, `Project ${project?.ja_code || ""} must have a 3-character suffix before inventory can be allocated`);
  }
  return suffix;
}

async function resolveAssets(tx, identifiers, { forUpdate = true } = {}) {
  const requested = [...new Set((identifiers || []).map((value) => String(value).trim()).filter(Boolean))];
  if (requested.length === 0) {
    throw new AppError(400, "At least one serial number or part code is required");
  }
  const placeholders = requested.map(() => "?").join(",");
  const [rows] = await tx.query(
    `SELECT a.*, ip.part_description, ip.serialized, kt.code AS kit_type_code
     FROM inventory_assets a
     INNER JOIN inventory_parts ip ON ip.id = a.inventory_part_id
     INNER JOIN inventory_kit_types kt ON kt.id = ip.kit_type_id
     WHERE a.serial_number IN (${placeholders}) OR a.part_code IN (${placeholders})
     ${forUpdate ? "FOR UPDATE" : ""}`,
    [...requested, ...requested],
  );

  const found = new Set();
  for (const row of rows) {
    found.add(String(row.serial_number));
    found.add(String(row.part_code));
  }
  const missing = requested.filter((value) => !found.has(value));
  if (missing.length > 0) {
    throw new AppError(404, `Inventory item not found: ${missing.join(", ")}`);
  }
  return rows;
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

export const inventoryService = {
  async meta(user) {
    const [meta] = await Promise.all([inventoryRepository.listMeta()]);
    return { ...meta, access: getInventoryAccess(user) };
  },

  async dashboard() {
    return inventoryRepository.dashboard();
  },

  async search(q, limit) {
    return inventoryRepository.search(q, limit);
  },

  async listAssets(filters) {
    return inventoryRepository.listAssets(filters);
  },

  async getAsset(assetId) {
    const result = await inventoryRepository.getAsset(assetId);
    if (!result) throw new AppError(404, "Asset not found");
    return result;
  },

  async listMovements(limit) {
    return inventoryRepository.listMovements(limit);
  },

  async listHandovers(limit) {
    return inventoryRepository.listHandovers(limit);
  },

  async listShipments(limit) {
    return inventoryRepository.listShipments(limit);
  },

  async listAudit(limit) {
    return inventoryRepository.listAudit(limit);
  },

  async createKitType(payload, user) {
    return inventoryRepository.createKitType(payload, user.id);
  },

  async createUserGroup(payload, user) {
    return inventoryRepository.createUserGroup(payload, user.id);
  },

  async createPart(payload, user) {
    return inventoryRepository.createPart(payload, user.id);
  },

  async createWarehouse(payload, user) {
    return inventoryRepository.createWarehouse(payload, user.id);
  },

  async createLocation(payload, user) {
    return inventoryRepository.createLocation(payload, user.id);
  },

  async createCourier(payload, user) {
    return inventoryRepository.createCourier(payload, user.id);
  },

  async createSerializedAsset(payload, user, requestContext = {}) {
    const context = contextWithId(requestContext);
    const assetId = await inventoryRepository.transaction(async (tx) => {
      const project = await inventoryRepository.loadProject(tx, payload.projectId, { forUpdate: true });
      if (!project || project.status !== "active") throw new AppError(404, "Active project not found");
      const suffix = validateProjectSuffix(project);
      const part = await inventoryRepository.loadPart(tx, payload.inventoryPartId, { forUpdate: true });
      if (!part || !part.active) throw new AppError(404, "Inventory part not found");
      if (!part.serialized) throw new AppError(400, "Selected part is quantity-managed, not serialized");
      const location = await inventoryRepository.loadLocation(tx, payload.locationId);
      if (!location) throw new AppError(404, "Stores location not found");

      const serial = String(payload.serialNumber || "").trim();
      const [duplicates] = await tx.query(`SELECT id FROM inventory_assets WHERE serial_number = ? LIMIT 1 FOR UPDATE`, [serial]);
      if (duplicates[0]) throw new AppError(409, "Serial number already exists");

      const partCode = await inventoryRepository.nextPartCode(tx, suffix, part.kit_type_code);
      const [insertResult] = await tx.query(
        `INSERT INTO inventory_assets
          (serial_number, part_code, inventory_part_id, project_id, current_location_id,
           current_custody, stock_status, condition_status, created_by, updated_by)
         VALUES (?, ?, ?, ?, ?, 'STORES', 'AVAILABLE', ?, ?, ?)`,
        [serial, partCode, part.id, project.id, location.id, payload.conditionStatus || "GOOD", user.id, user.id],
      );
      const newAssetId = insertResult.insertId;
      const movementId = await inventoryRepository.insertMovement(tx, {
        movementReference: ref("MOV"), movementType: "INITIAL_RECEIPT", toLocationId: location.id,
        toCustody: "STORES", projectId: project.id, performedBy: user.id,
        reference: payload.reference, reason: payload.reason || "Serialized asset registered in Stores",
        correlationId: context.correlationId,
        items: [{ assetId: newAssetId, inventoryPartId: part.id, serialNumber: serial, partCode, quantity: 1 }],
      });
      await tx.query(
        `INSERT INTO inventory_asset_part_code_history
          (asset_id, serial_number, old_part_code, new_part_code, old_project_id, new_project_id, changed_by, reason, movement_id)
         VALUES (?, ?, NULL, ?, NULL, ?, ?, ?, ?)`,
        [newAssetId, serial, partCode, project.id, user.id, "Initial project part code", movementId],
      );
      await inventoryRepository.insertAudit(tx, auditPayload(user, context, {
        eventType: "ASSET_CREATED", entityType: "inventory_asset", entityId: newAssetId, action: "CREATE",
        afterValue: { serialNumber: serial, partCode, projectId: project.id, locationId: location.id },
      }));
      return newAssetId;
    });
    return this.getAsset(assetId);
  },

  async reassignAsset(assetId, payload, user, requestContext = {}) {
    const context = contextWithId(requestContext);
    await inventoryRepository.transaction(async (tx) => {
      const asset = await inventoryRepository.loadAsset(tx, assetId, { forUpdate: true });
      if (!asset) throw new AppError(404, "Asset not found");
      if (["IN_TRANSIT", "DELIVERED", "RETIRED"].includes(asset.stock_status)) {
        throw new AppError(409, `Asset cannot be reassigned while status is ${asset.stock_status}`);
      }
      if (asset.current_custody !== "STORES") {
        throw new AppError(409, "Asset must be returned to Stores before project reassignment");
      }
      const project = await inventoryRepository.loadProject(tx, payload.projectId, { forUpdate: true });
      if (!project || project.status !== "active") throw new AppError(404, "Active project not found");
      const suffix = validateProjectSuffix(project);
      const newPartCode = await inventoryRepository.nextPartCode(tx, suffix, asset.kit_type_code);
      const before = { projectId: asset.project_id, partCode: asset.part_code };

      await tx.query(
        `UPDATE inventory_assets
         SET project_id = ?, part_code = ?, stock_status = 'AVAILABLE', version = version + 1,
             updated_by = ? WHERE id = ?`,
        [project.id, newPartCode, user.id, asset.id],
      );
      const movementId = await inventoryRepository.insertMovement(tx, {
        movementReference: ref("MOV"), movementType: "PROJECT_REASSIGNMENT",
        fromLocationId: asset.current_location_id, toLocationId: asset.current_location_id,
        fromCustody: "STORES", toCustody: "STORES", projectId: project.id, performedBy: user.id,
        reference: payload.reference, reason: payload.reason || "Project reassignment", correlationId: context.correlationId,
        items: [{ assetId: asset.id, inventoryPartId: asset.inventory_part_id, serialNumber: asset.serial_number, partCode: newPartCode, quantity: 1 }],
      });
      await tx.query(
        `INSERT INTO inventory_asset_part_code_history
          (asset_id, serial_number, old_part_code, new_part_code, old_project_id, new_project_id, changed_by, reason, movement_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [asset.id, asset.serial_number, asset.part_code, newPartCode, asset.project_id, project.id, user.id,
         payload.reason || "Project reassignment", movementId],
      );
      await inventoryRepository.insertAudit(tx, auditPayload(user, context, {
        eventType: "PROJECT_REASSIGNED", entityType: "inventory_asset", entityId: asset.id, action: "REASSIGN",
        beforeValue: before, afterValue: { projectId: project.id, partCode: newPartCode },
      }));
    });
    return this.getAsset(assetId);
  },

  async moveAsset(payload, user, requestContext = {}) {
    const context = contextWithId(requestContext);
    let movedAssetId;
    await inventoryRepository.transaction(async (tx) => {
      const [asset] = await resolveAssets(tx, [payload.identifier]);
      if (asset.current_custody !== "STORES") throw new AppError(409, "Only Stores-custody assets can use warehouse movement");
      const location = await inventoryRepository.loadLocation(tx, payload.toLocationId);
      if (!location) throw new AppError(404, "Destination location not found");
      const nextStatus = payload.stockStatus || asset.stock_status;
      if (!STORES_ASSET_STATUSES.has(nextStatus)) throw new AppError(400, "Invalid Stores stock status");
      await tx.query(
        `UPDATE inventory_assets SET current_location_id = ?, stock_status = ?, version = version + 1, updated_by = ? WHERE id = ?`,
        [location.id, nextStatus, user.id, asset.id],
      );
      await inventoryRepository.insertMovement(tx, {
        movementReference: ref("MOV"), movementType: "STORE_TRANSFER",
        fromLocationId: asset.current_location_id, toLocationId: location.id,
        fromCustody: "STORES", toCustody: "STORES", projectId: asset.project_id, performedBy: user.id,
        reference: payload.reference, reason: payload.reason || "Stores location transfer", correlationId: context.correlationId,
        items: [{ assetId: asset.id, inventoryPartId: asset.inventory_part_id, serialNumber: asset.serial_number, partCode: asset.part_code, quantity: 1 }],
      });
      await inventoryRepository.insertAudit(tx, auditPayload(user, context, {
        eventType: "STOCK_MOVED", entityType: "inventory_asset", entityId: asset.id, action: "MOVE",
        beforeValue: { locationId: asset.current_location_id, stockStatus: asset.stock_status },
        afterValue: { locationId: location.id, stockStatus: nextStatus },
      }));
      movedAssetId = asset.id;
    });
    return this.getAsset(movedAssetId);
  },

  async adjustQuantityStock(payload, user, requestContext = {}) {
    const context = contextWithId(requestContext);
    return inventoryRepository.transaction(async (tx) => {
      const part = await inventoryRepository.loadPart(tx, payload.inventoryPartId, { forUpdate: true });
      if (!part) throw new AppError(404, "Inventory part not found");
      if (part.serialized) throw new AppError(400, "Serialized parts must be managed as individual assets");
      const location = await inventoryRepository.loadLocation(tx, payload.locationId);
      if (!location) throw new AppError(404, "Location not found");
      await tx.query(
        `INSERT INTO inventory_stock_balances (inventory_part_id, location_id, available_quantity)
         VALUES (?, ?, 0)
         ON DUPLICATE KEY UPDATE updated_at = updated_at`,
        [part.id, location.id],
      );
      const [balanceRows] = await tx.query(
        `SELECT * FROM inventory_stock_balances WHERE inventory_part_id = ? AND location_id = ? FOR UPDATE`,
        [part.id, location.id],
      );
      const balance = balanceRows[0];
      const delta = Number(payload.quantityDelta);
      const next = Number(balance.available_quantity) + delta;
      if (!Number.isFinite(delta) || delta === 0) throw new AppError(400, "Quantity adjustment must be non-zero");
      if (next < 0) throw new AppError(409, "Stock adjustment would make available quantity negative");
      await tx.query(
        `UPDATE inventory_stock_balances SET available_quantity = ?, version = version + 1 WHERE id = ?`,
        [next, balance.id],
      );
      const movementId = await inventoryRepository.insertMovement(tx, {
        movementReference: ref("MOV"), movementType: "STOCK_ADJUSTMENT",
        fromLocationId: location.id, toLocationId: location.id, fromCustody: "STORES", toCustody: "STORES",
        performedBy: user.id, approvedBy: payload.approvedBy || null, reason: payload.reason,
        reference: payload.reference, correlationId: context.correlationId,
        items: [{ inventoryPartId: part.id, quantity: delta }],
      });
      await inventoryRepository.insertAudit(tx, auditPayload(user, context, {
        eventType: "STOCK_ADJUSTED", entityType: "stock_balance", entityId: balance.id, action: "ADJUST",
        beforeValue: { availableQuantity: Number(balance.available_quantity) },
        afterValue: { availableQuantity: next, delta, movementId },
      }));
      return { balanceId: balance.id, inventoryPartId: part.id, locationId: location.id, availableQuantity: next, movementId };
    });
  },

  async createReservation(payload, user, requestContext = {}) {
    const context = contextWithId(requestContext);
    const reservationId = await inventoryRepository.transaction(async (tx) => {
      const project = await inventoryRepository.loadProject(tx, payload.projectId, { forUpdate: true });
      if (!project) throw new AppError(404, "Project not found");
      validateProjectSuffix(project);
      const assets = payload.identifiers?.length ? await resolveAssets(tx, payload.identifiers) : [];
      const reservationReference = ref("RES");
      const [headerResult] = await tx.query(
        `INSERT INTO inventory_reservations (reservation_reference, project_id, status, notes, created_by)
         VALUES (?, ?, 'ACTIVE', ?, ?)`,
        [reservationReference, project.id, payload.notes || null, user.id],
      );
      const reservationIdValue = headerResult.insertId;
      const movementItems = [];

      for (const asset of assets) {
        if (Number(asset.project_id) !== Number(project.id)) throw new AppError(409, `${asset.part_code} belongs to a different project`);
        if (asset.current_custody !== "STORES" || asset.stock_status !== "AVAILABLE") {
          throw new AppError(409, `${asset.part_code} is not available in Stores`);
        }
        await tx.query(`UPDATE inventory_assets SET stock_status = 'RESERVED', version = version + 1, updated_by = ? WHERE id = ?`, [user.id, asset.id]);
        await tx.query(
          `INSERT INTO inventory_reservation_items (reservation_id, asset_id, inventory_part_id, location_id, quantity)
           VALUES (?, ?, ?, ?, 1)`,
          [reservationIdValue, asset.id, asset.inventory_part_id, asset.current_location_id],
        );
        movementItems.push({ assetId: asset.id, inventoryPartId: asset.inventory_part_id, serialNumber: asset.serial_number, partCode: asset.part_code, quantity: 1 });
      }

      for (const line of payload.quantityLines || []) {
        const part = await inventoryRepository.loadPart(tx, line.inventoryPartId, { forUpdate: true });
        if (!part || part.serialized) throw new AppError(400, "Quantity reservation line must reference a non-serialized part");
        const [balanceRows] = await tx.query(
          `SELECT * FROM inventory_stock_balances WHERE inventory_part_id = ? AND location_id = ? FOR UPDATE`,
          [part.id, line.locationId],
        );
        const balance = balanceRows[0];
        const qty = Number(line.quantity);
        if (!balance || qty <= 0 || Number(balance.available_quantity) < qty) throw new AppError(409, `Insufficient available quantity for ${part.part_description}`);
        await tx.query(
          `UPDATE inventory_stock_balances
           SET available_quantity = available_quantity - ?, reserved_quantity = reserved_quantity + ?, version = version + 1
           WHERE id = ?`,
          [qty, qty, balance.id],
        );
        await tx.query(
          `INSERT INTO inventory_reservation_items (reservation_id, inventory_part_id, location_id, quantity)
           VALUES (?, ?, ?, ?)`,
          [reservationIdValue, part.id, line.locationId, qty],
        );
        movementItems.push({ inventoryPartId: part.id, quantity: qty });
      }

      await inventoryRepository.insertMovement(tx, {
        movementReference: ref("MOV"), movementType: "RESERVATION", projectId: project.id,
        fromCustody: "STORES", toCustody: "STORES", performedBy: user.id,
        reference: reservationReference, reason: payload.notes || "Project stock reservation",
        correlationId: context.correlationId, items: movementItems,
      });
      await inventoryRepository.insertAudit(tx, auditPayload(user, context, {
        eventType: "STOCK_RESERVED", entityType: "inventory_reservation", entityId: reservationIdValue,
        action: "CREATE", afterValue: { reservationReference, projectId: project.id, assetCount: assets.length, quantityLines: payload.quantityLines || [] },
      }));
      return reservationIdValue;
    });
    return { reservationId };
  },

  async pickReservation(reservationId, user, requestContext = {}) {
    const context = contextWithId(requestContext);
    return inventoryRepository.transaction(async (tx) => {
      const [headerRows] = await tx.query(`SELECT * FROM inventory_reservations WHERE id = ? FOR UPDATE`, [reservationId]);
      const reservation = headerRows[0];
      if (!reservation) throw new AppError(404, "Reservation not found");
      if (reservation.status !== "ACTIVE") throw new AppError(409, `Reservation is ${reservation.status}`);
      const [items] = await tx.query(`SELECT * FROM inventory_reservation_items WHERE reservation_id = ? FOR UPDATE`, [reservation.id]);
      const movementItems = [];
      for (const item of items) {
        if (item.asset_id) {
          const asset = await inventoryRepository.loadAsset(tx, item.asset_id, { forUpdate: true });
          if (!asset || asset.stock_status !== "RESERVED") throw new AppError(409, "Reserved serialized asset is no longer available for picking");
          await tx.query(`UPDATE inventory_assets SET stock_status = 'PICKED', version = version + 1, updated_by = ? WHERE id = ?`, [user.id, asset.id]);
          movementItems.push({ assetId: asset.id, inventoryPartId: asset.inventory_part_id, serialNumber: asset.serial_number, partCode: asset.part_code, quantity: 1 });
        } else {
          movementItems.push({ inventoryPartId: item.inventory_part_id, quantity: Number(item.quantity) });
        }
        await tx.query(`UPDATE inventory_reservation_items SET status = 'PICKED' WHERE id = ?`, [item.id]);
      }
      await tx.query(`UPDATE inventory_reservations SET status = 'PICKED' WHERE id = ?`, [reservation.id]);
      await inventoryRepository.insertMovement(tx, {
        movementReference: ref("MOV"), movementType: "PICK", projectId: reservation.project_id,
        fromCustody: "STORES", toCustody: "STORES", performedBy: user.id,
        reference: reservation.reservation_reference, reason: "Project reservation picked",
        correlationId: context.correlationId, items: movementItems,
      });
      await inventoryRepository.insertAudit(tx, auditPayload(user, context, {
        eventType: "STOCK_PICKED", entityType: "inventory_reservation", entityId: reservation.id,
        action: "PICK", beforeValue: { status: "ACTIVE" }, afterValue: { status: "PICKED" },
      }));
      return { reservationId: reservation.id, status: "PICKED" };
    });
  },

  async createHandover(payload, user, requestContext = {}) {
    const context = contextWithId(requestContext);
    const access = getInventoryAccess(user);
    const direction = payload.direction;
    if (direction === "STORES_TO_ENGINEERING" && !access.canManageStock) throw new AppError(403, "Stores access required");
    if (direction === "ENGINEERING_TO_STORES" && !access.canCreateEngineeringReturn) throw new AppError(403, "Engineering custody access required");

    const handoverId = await inventoryRepository.transaction(async (tx) => {
      const project = await inventoryRepository.loadProject(tx, payload.projectId, { forUpdate: true });
      if (!project) throw new AppError(404, "Project not found");
      const assets = await resolveAssets(tx, payload.identifiers);
      const fromCustody = direction === "STORES_TO_ENGINEERING" ? "STORES" : "ENGINEERING";
      const toCustody = direction === "STORES_TO_ENGINEERING" ? "ENGINEERING" : "STORES";
      const handoverReference = ref("HO");
      const [headerResult] = await tx.query(
        `INSERT INTO inventory_handovers
          (handover_reference, direction, project_id, from_location_id, to_location_id,
           from_custody, to_custody, issued_by, status, notes)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'PENDING', ?)`,
        [handoverReference, direction, project.id, payload.fromLocationId || null, payload.toLocationId || null,
         fromCustody, toCustody, user.id, payload.notes || null],
      );
      for (const asset of assets) {
        if (Number(asset.project_id) !== Number(project.id)) throw new AppError(409, `${asset.part_code} belongs to another project`);
        if (asset.current_custody !== fromCustody) throw new AppError(409, `${asset.part_code} is not in ${fromCustody} custody`);
        if (direction === "STORES_TO_ENGINEERING" && !["PICKED", "READY_FOR_HANDOVER", "AVAILABLE"].includes(asset.stock_status)) {
          throw new AppError(409, `${asset.part_code} cannot be handed to Engineering from ${asset.stock_status}`);
        }
        await tx.query(
          `UPDATE inventory_assets SET stock_status = ?, version = version + 1, updated_by = ? WHERE id = ?`,
          [direction === "STORES_TO_ENGINEERING" ? "READY_FOR_HANDOVER" : "RETURN_PENDING", user.id, asset.id],
        );
        await tx.query(
          `INSERT INTO inventory_handover_items (handover_id, asset_id, inventory_part_id, serial_number, part_code, quantity)
           VALUES (?, ?, ?, ?, ?, 1)`,
          [headerResult.insertId, asset.id, asset.inventory_part_id, asset.serial_number, asset.part_code],
        );
      }
      await inventoryRepository.insertAudit(tx, auditPayload(user, context, {
        eventType: direction, entityType: "inventory_handover", entityId: headerResult.insertId,
        action: "CREATE", afterValue: { handoverReference, projectId: project.id, assetCount: assets.length, direction },
      }));
      return headerResult.insertId;
    });
    return { handoverId };
  },

  async receiveHandover(handoverId, payload, user, requestContext = {}) {
    const context = contextWithId(requestContext);
    const access = getInventoryAccess(user);
    return inventoryRepository.transaction(async (tx) => {
      const [headerRows] = await tx.query(`SELECT * FROM inventory_handovers WHERE id = ? FOR UPDATE`, [handoverId]);
      const handover = headerRows[0];
      if (!handover) throw new AppError(404, "Handover not found");
      if (handover.status !== "PENDING") throw new AppError(409, `Handover is already ${handover.status}`);
      if (handover.direction === "STORES_TO_ENGINEERING" && !access.canReceiveEngineeringHandover) throw new AppError(403, "Engineering receipt access required");
      if (handover.direction === "ENGINEERING_TO_STORES" && !access.canAcceptEngineeringReturn) throw new AppError(403, "Stores return acceptance required");
      const [items] = await tx.query(`SELECT * FROM inventory_handover_items WHERE handover_id = ? FOR UPDATE`, [handover.id]);
      const movementItems = [];
      const returnOutcome = payload.outcome || "RETURNED";
      if (handover.direction === "ENGINEERING_TO_STORES" && !["RETURNED", "AVAILABLE", "READY_TO_PACK", "QUARANTINE", "DAMAGED"].includes(returnOutcome)) {
        throw new AppError(400, "Invalid Stores return outcome");
      }
      for (const item of items) {
        if (!item.asset_id) continue;
        const asset = await inventoryRepository.loadAsset(tx, item.asset_id, { forUpdate: true });
        const nextStatus = handover.direction === "STORES_TO_ENGINEERING" ? "WITH_ENGINEERING" : returnOutcome;
        await tx.query(
          `UPDATE inventory_assets
           SET current_custody = ?, stock_status = ?, current_location_id = COALESCE(?, current_location_id),
               version = version + 1, updated_by = ? WHERE id = ?`,
          [handover.to_custody, nextStatus, handover.to_location_id, user.id, asset.id],
        );
        movementItems.push({ assetId: asset.id, inventoryPartId: asset.inventory_part_id, serialNumber: asset.serial_number, partCode: asset.part_code, quantity: 1 });
      }
      await tx.query(
        `UPDATE inventory_handovers SET status = 'RECEIVED', received_by = ?, received_at = CURRENT_TIMESTAMP WHERE id = ?`,
        [user.id, handover.id],
      );
      const movementType = handover.direction;
      await inventoryRepository.insertMovement(tx, {
        movementReference: ref("MOV"), movementType,
        fromLocationId: handover.from_location_id, toLocationId: handover.to_location_id,
        fromCustody: handover.from_custody, toCustody: handover.to_custody,
        projectId: handover.project_id, performedBy: user.id, reference: handover.handover_reference,
        reason: payload.notes || "Custody handover received", correlationId: context.correlationId, items: movementItems,
      });
      await inventoryRepository.insertAudit(tx, auditPayload(user, context, {
        eventType: handover.direction === "STORES_TO_ENGINEERING" ? "ENGINEERING_RECEIPT" : "STORES_RETURN_ACCEPTED",
        entityType: "inventory_handover", entityId: handover.id, action: "RECEIVE",
        beforeValue: { status: "PENDING" }, afterValue: { status: "RECEIVED", outcome: returnOutcome },
      }));
      return { handoverId: handover.id, status: "RECEIVED" };
    });
  },

  async createShipment(payload, user, requestContext = {}) {
    const context = contextWithId(requestContext);
    const shipmentId = await inventoryRepository.transaction(async (tx) => {
      const project = await inventoryRepository.loadProject(tx, payload.projectId, { forUpdate: true });
      if (!project) throw new AppError(404, "Project not found");
      const assets = await resolveAssets(tx, payload.identifiers);
      const shipmentReference = ref("SHP");
      const [shipmentResult] = await tx.query(
        `INSERT INTO inventory_shipments
          (shipment_reference, project_id, destination_name, destination_contact, destination_address,
           courier_id, courier_service, consignment_number, tracking_number, shipment_status, packed_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'PACKED', ?)`,
        [shipmentReference, project.id, payload.destinationName, payload.destinationContact || null,
         payload.destinationAddress, payload.courierId || null, payload.courierService || null,
         payload.consignmentNumber || null, payload.trackingNumber || null, user.id],
      );
      const movementItems = [];
      for (const asset of assets) {
        if (Number(asset.project_id) !== Number(project.id)) throw new AppError(409, `${asset.part_code} belongs to another project`);
        if (asset.current_custody !== "STORES" || !["PICKED", "RETURNED", "READY_TO_PACK", "AVAILABLE"].includes(asset.stock_status)) {
          throw new AppError(409, `${asset.part_code} is not available for packing`);
        }
        const [existingShipment] = await tx.query(
          `SELECT si.id FROM inventory_shipment_items si
           INNER JOIN inventory_shipments s ON s.id = si.shipment_id
           WHERE si.asset_id = ? AND s.shipment_status NOT IN ('CANCELLED', 'DELIVERED') LIMIT 1 FOR UPDATE`,
          [asset.id],
        );
        if (existingShipment[0]) throw new AppError(409, `${asset.part_code} is already in an active shipment`);
        await tx.query(
          `INSERT INTO inventory_shipment_items (shipment_id, asset_id, inventory_part_id, serial_number, part_code, quantity)
           VALUES (?, ?, ?, ?, ?, 1)`,
          [shipmentResult.insertId, asset.id, asset.inventory_part_id, asset.serial_number, asset.part_code],
        );
        await tx.query(
          `UPDATE inventory_assets SET stock_status = 'PACKED', current_custody = 'SHIPPING',
             current_location_id = COALESCE(?, current_location_id), version = version + 1, updated_by = ? WHERE id = ?`,
          [payload.packingLocationId || null, user.id, asset.id],
        );
        movementItems.push({ assetId: asset.id, inventoryPartId: asset.inventory_part_id, serialNumber: asset.serial_number, partCode: asset.part_code, quantity: 1 });
      }
      await inventoryRepository.insertMovement(tx, {
        movementReference: ref("MOV"), movementType: "PACK", toLocationId: payload.packingLocationId || null,
        fromCustody: "STORES", toCustody: "SHIPPING", projectId: project.id, performedBy: user.id,
        reference: shipmentReference, reason: "Shipment packed", correlationId: context.correlationId, items: movementItems,
      });
      await inventoryRepository.insertAudit(tx, auditPayload(user, context, {
        eventType: "PACKED", entityType: "inventory_shipment", entityId: shipmentResult.insertId,
        action: "CREATE", afterValue: { shipmentReference, projectId: project.id, assetCount: assets.length },
      }));
      return shipmentResult.insertId;
    });
    return { shipmentId };
  },

  async dispatchShipment(shipmentId, user, requestContext = {}) {
    const context = contextWithId(requestContext);
    return inventoryRepository.transaction(async (tx) => {
      const [shipmentRows] = await tx.query(`SELECT * FROM inventory_shipments WHERE id = ? FOR UPDATE`, [shipmentId]);
      const shipment = shipmentRows[0];
      if (!shipment) throw new AppError(404, "Shipment not found");
      if (!["PACKED", "READY_TO_SHIP"].includes(shipment.shipment_status)) throw new AppError(409, `Shipment is ${shipment.shipment_status}`);
      const [items] = await tx.query(`SELECT * FROM inventory_shipment_items WHERE shipment_id = ? FOR UPDATE`, [shipment.id]);
      const movementItems = [];
      for (const item of items) {
        if (!item.asset_id) continue;
        const asset = await inventoryRepository.loadAsset(tx, item.asset_id, { forUpdate: true });
        await tx.query(
          `UPDATE inventory_assets SET stock_status = 'DISPATCHED', current_custody = 'COURIER',
             version = version + 1, updated_by = ? WHERE id = ?`,
          [user.id, asset.id],
        );
        movementItems.push({ assetId: asset.id, inventoryPartId: asset.inventory_part_id, serialNumber: asset.serial_number, partCode: asset.part_code, quantity: 1 });
      }
      await tx.query(
        `UPDATE inventory_shipments SET shipment_status = 'DISPATCHED', dispatched_by = ?, dispatched_at = CURRENT_TIMESTAMP WHERE id = ?`,
        [user.id, shipment.id],
      );
      await inventoryRepository.insertMovement(tx, {
        movementReference: ref("MOV"), movementType: "DISPATCH", fromCustody: "SHIPPING", toCustody: "COURIER",
        projectId: shipment.project_id, performedBy: user.id, reference: shipment.shipment_reference,
        reason: "Shipment dispatched to courier", correlationId: context.correlationId, items: movementItems,
      });
      await inventoryRepository.insertAudit(tx, auditPayload(user, context, {
        eventType: "DISPATCHED", entityType: "inventory_shipment", entityId: shipment.id, action: "DISPATCH",
        beforeValue: { status: shipment.shipment_status }, afterValue: { status: "DISPATCHED" },
      }));
      return { shipmentId: shipment.id, status: "DISPATCHED" };
    });
  },

  async addTrackingEvent(shipmentId, payload, user, requestContext = {}) {
    const context = contextWithId(requestContext);
    return inventoryRepository.transaction(async (tx) => {
      const [shipmentRows] = await tx.query(`SELECT * FROM inventory_shipments WHERE id = ? FOR UPDATE`, [shipmentId]);
      const shipment = shipmentRows[0];
      if (!shipment) throw new AppError(404, "Shipment not found");
      await tx.query(
        `INSERT INTO inventory_shipment_tracking_events
          (shipment_id, courier_status, event_description, event_location, event_timestamp, external_reference)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [shipment.id, payload.courierStatus, payload.eventDescription || null, payload.eventLocation || null,
         new Date(payload.eventTimestamp), payload.externalReference || null],
      );
      const normalized = String(payload.courierStatus).trim().toUpperCase();
      if (normalized === "DELIVERED") {
        const [items] = await tx.query(`SELECT * FROM inventory_shipment_items WHERE shipment_id = ? FOR UPDATE`, [shipment.id]);
        const movementItems = [];
        for (const item of items) {
          if (!item.asset_id) continue;
          const asset = await inventoryRepository.loadAsset(tx, item.asset_id, { forUpdate: true });
          await tx.query(
            `UPDATE inventory_assets SET stock_status = 'DELIVERED', current_custody = 'PROJECT_SITE',
             version = version + 1, updated_by = ? WHERE id = ?`,
            [user.id, asset.id],
          );
          movementItems.push({ assetId: asset.id, inventoryPartId: asset.inventory_part_id, serialNumber: asset.serial_number, partCode: asset.part_code, quantity: 1 });
        }
        await tx.query(`UPDATE inventory_shipments SET shipment_status = 'DELIVERED', delivered_at = ? WHERE id = ?`, [new Date(payload.eventTimestamp), shipment.id]);
        await inventoryRepository.insertMovement(tx, {
          movementReference: ref("MOV"), movementType: "DELIVERY", fromCustody: "COURIER", toCustody: "PROJECT_SITE",
          projectId: shipment.project_id, performedBy: user.id, reference: shipment.shipment_reference,
          reason: "Courier delivery confirmed", correlationId: context.correlationId, items: movementItems,
        });
      } else if (["IN_TRANSIT", "OUT_FOR_DELIVERY"].includes(normalized)) {
        await tx.query(`UPDATE inventory_shipments SET shipment_status = 'IN_TRANSIT' WHERE id = ?`, [shipment.id]);
        await tx.query(
          `UPDATE inventory_assets a
           INNER JOIN inventory_shipment_items si ON si.asset_id = a.id
           SET a.stock_status = 'IN_TRANSIT', a.version = a.version + 1, a.updated_by = ?
           WHERE si.shipment_id = ?`,
          [user.id, shipment.id],
        );
      }
      await inventoryRepository.insertAudit(tx, auditPayload(user, context, {
        eventType: normalized === "DELIVERED" ? "DELIVERED" : "TRACKING_UPDATED",
        entityType: "inventory_shipment", entityId: shipment.id, action: "TRACKING_EVENT",
        afterValue: { courierStatus: normalized, eventTimestamp: payload.eventTimestamp },
      }));
      return { shipmentId: shipment.id, courierStatus: normalized };
    });
  },
};
