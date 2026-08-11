import crypto from "node:crypto";
import { pool } from "../../config/db.js";
import { AppError } from "../../lib/app-error.js";
import { getInventoryAccess } from "./inventory.permissions.js";
import { inventoryRepository } from "./inventory.repository.js";
import { ensureEngineerLocationSchema } from "./inventory.location.schema.js";

function movementReference() {
  return `MOV-${new Date().toISOString().slice(0, 10).replaceAll("-", "")}-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
}

function requestContext(context = {}) {
  return {
    ...context,
    correlationId: context.correlationId || crypto.randomUUID(),
  };
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

async function findEngineeringEmployee(tx, employeeId) {
  const [rows] = await tx.query(
    `SELECT e.id, e.name, e.ein, e.email, t.name AS team_name
     FROM employees e
     LEFT JOIN teams t ON t.id = e.team_id
     WHERE e.id = ?
       AND (e.active IS NULL OR e.active = TRUE)
       AND LOWER(COALESCE(t.name, '')) LIKE '%engineer%'
     LIMIT 1`,
    [employeeId],
  );
  return rows[0] || null;
}

async function loadAssignedLocation(tx, locationId, { forUpdate = false } = {}) {
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

async function loadAssetByIdentifier(tx, identifier) {
  const value = String(identifier || "").trim();
  const [rows] = await tx.query(
    `SELECT a.*, ip.part_description, kt.code AS kit_type_code
     FROM inventory_assets a
     INNER JOIN inventory_parts ip ON ip.id = a.inventory_part_id
     INNER JOIN inventory_kit_types kt ON kt.id = ip.kit_type_id
     WHERE a.serial_number = ? OR a.part_code = ?
     LIMIT 1 FOR UPDATE`,
    [value, value],
  );
  return rows[0] || null;
}

export const inventoryLocationMoveService = {
  async ensureSchema() {
    return ensureEngineerLocationSchema();
  },

  async meta(user) {
    await ensureEngineerLocationSchema();
    const access = getInventoryAccess(user);

    if (!access.canView) {
      throw new AppError(403, "Inventory access required");
    }

    const isStoresUser = access.isStores;
    const isEngineeringUser = access.isEngineering && !isStoresUser;

    const locationSql = `
      SELECT l.*, w.code AS warehouse_code, w.name AS warehouse_name,
             e.name AS assigned_employee_name, e.ein AS assigned_employee_ein
      FROM inventory_locations l
      INNER JOIN inventory_warehouses w ON w.id = l.warehouse_id
      LEFT JOIN employees e ON e.id = l.assigned_employee_id
      WHERE l.active = TRUE
      ${isEngineeringUser ? "AND l.location_type = 'ENGINEERING_CUSTODY' AND l.assigned_employee_id = ?" : ""}
      ORDER BY l.location_type, l.location_code
    `;

    const [locationRows] = await pool.query(locationSql, isEngineeringUser ? [user.id] : []);

    let engineeringUsers = [];
    if (isStoresUser) {
      const [rows] = await pool.query(
        `SELECT e.id, e.name, e.ein, e.email, t.name AS team_name
         FROM employees e
         LEFT JOIN teams t ON t.id = e.team_id
         WHERE (e.active IS NULL OR e.active = TRUE)
           AND LOWER(COALESCE(t.name, '')) LIKE '%engineer%'
         ORDER BY e.name`,
      );
      engineeringUsers = rows;
    }

    return {
      access: {
        canMove: isStoresUser || isEngineeringUser,
        canAssignEngineeringLocations: isStoresUser,
        mode: isStoresUser ? "STORES" : isEngineeringUser ? "ENGINEERING" : "READ_ONLY",
      },
      locations: locationRows,
      engineeringUsers,
    };
  },

  async createEngineeringLocation(payload, user, contextInput = {}) {
    await ensureEngineerLocationSchema();
    const access = getInventoryAccess(user);
    if (!access.isStores) {
      throw new AppError(403, "Stores access is required to create Engineering locations");
    }

    const context = requestContext(contextInput);
    let createdId;

    await inventoryRepository.transaction(async (tx) => {
      const engineer = await findEngineeringEmployee(tx, payload.employeeId);
      if (!engineer) {
        throw new AppError(400, "Assigned employee must belong to the Engineering team");
      }

      const [warehouseRows] = await tx.query(
        `SELECT id FROM inventory_warehouses WHERE id = ? AND active = TRUE LIMIT 1`,
        [payload.warehouseId],
      );
      if (!warehouseRows[0]) {
        throw new AppError(404, "Warehouse not found");
      }

      const code = String(payload.locationCode || "").trim().toUpperCase();
      const [result] = await tx.query(
        `INSERT INTO inventory_locations
          (warehouse_id, store_number, aisle, shelf, bin, location_code, description,
           location_type, assigned_employee_id, active, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'ENGINEERING_CUSTODY', ?, TRUE, ?)`,
        [
          payload.warehouseId,
          payload.storeNumber || null,
          payload.aisle || null,
          payload.shelf || null,
          payload.bin || null,
          code,
          payload.description || `${engineer.name} Engineering location`,
          engineer.id,
          user.id,
        ],
      );
      createdId = result.insertId;

      await inventoryRepository.insertAudit(tx, auditPayload(user, context, {
        eventType: "ENGINEERING_LOCATION_CREATED",
        entityType: "inventory_location",
        entityId: createdId,
        action: "CREATE",
        afterValue: {
          locationCode: code,
          assignedEmployeeId: engineer.id,
          assignedEmployeeName: engineer.name,
        },
      }));
    });

    return inventoryRepository.transaction((tx) => loadAssignedLocation(tx, createdId));
  },

  async assignEngineeringLocation(locationId, payload, user, contextInput = {}) {
    await ensureEngineerLocationSchema();
    const access = getInventoryAccess(user);
    if (!access.isStores) {
      throw new AppError(403, "Stores access is required to assign Engineering locations");
    }

    const context = requestContext(contextInput);

    await inventoryRepository.transaction(async (tx) => {
      const location = await loadAssignedLocation(tx, locationId, { forUpdate: true });
      if (!location) {
        throw new AppError(404, "Location not found");
      }
      if (location.location_type !== "ENGINEERING_CUSTODY") {
        throw new AppError(400, "Only ENGINEERING_CUSTODY locations can be assigned to an Engineer");
      }

      let engineer = null;
      if (payload.employeeId) {
        engineer = await findEngineeringEmployee(tx, payload.employeeId);
        if (!engineer) {
          throw new AppError(400, "Assigned employee must belong to the Engineering team");
        }
      }

      await tx.query(
        `UPDATE inventory_locations
         SET assigned_employee_id = ?, updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
        [engineer?.id || null, location.id],
      );

      await inventoryRepository.insertAudit(tx, auditPayload(user, context, {
        eventType: "ENGINEERING_LOCATION_ASSIGNED",
        entityType: "inventory_location",
        entityId: location.id,
        action: "ASSIGN",
        beforeValue: { assignedEmployeeId: location.assigned_employee_id || null },
        afterValue: {
          assignedEmployeeId: engineer?.id || null,
          assignedEmployeeName: engineer?.name || null,
        },
      }));
    });

    return inventoryRepository.transaction((tx) => loadAssignedLocation(tx, locationId));
  },

  async moveKit(payload, user, contextInput = {}) {
    await ensureEngineerLocationSchema();
    const access = getInventoryAccess(user);
    if (!access.isStores && !access.isEngineering) {
      throw new AppError(403, "Stores or Engineering access is required to move kits");
    }

    const context = requestContext(contextInput);
    let assetId;

    await inventoryRepository.transaction(async (tx) => {
      const asset = await loadAssetByIdentifier(tx, payload.identifier);
      if (!asset) {
        throw new AppError(404, "Kit not found by serial number or part code");
      }

      const destination = await loadAssignedLocation(tx, payload.toLocationId, { forUpdate: true });
      if (!destination) {
        throw new AppError(404, "Destination location not found");
      }
      if (Number(asset.current_location_id) === Number(destination.id)) {
        throw new AppError(409, "Kit is already in the selected location");
      }
      if (["DISPATCHED", "IN_TRANSIT", "DELIVERED", "RETIRED", "LOST"].includes(asset.stock_status)) {
        throw new AppError(409, `Kit cannot be moved while status is ${asset.stock_status}`);
      }

      let nextCustody;
      let nextStatus;
      let movementType;

      if (access.isStores && asset.current_custody === "STORES") {
        if (destination.location_type === "ENGINEERING_CUSTODY") {
          nextCustody = "ENGINEERING";
          nextStatus = "WITH_ENGINEERING";
          movementType = "STORES_TO_ENGINEERING_DIRECT";
        } else if (destination.location_type === "ENGINEERING_HANDOVER") {
          nextCustody = "STORES";
          nextStatus = "READY_FOR_HANDOVER";
          movementType = "STORE_TRANSFER";
        } else {
          nextCustody = "STORES";
          nextStatus = asset.stock_status;
          movementType = "STORE_TRANSFER";
        }
      } else if (access.isEngineering && asset.current_custody === "ENGINEERING") {
        if (destination.location_type !== "ENGINEERING_CUSTODY") {
          throw new AppError(403, "Engineering users can move kits only to Engineering custody locations");
        }
        if (Number(destination.assigned_employee_id) !== Number(user.id)) {
          throw new AppError(403, "Engineering users can move kits only to a location assigned to themselves");
        }
        nextCustody = "ENGINEERING";
        nextStatus = "WITH_ENGINEERING";
        movementType = "ENGINEERING_LOCATION_MOVE";
      } else if (asset.current_custody === "ENGINEERING") {
        throw new AppError(409, "Kit is in Engineering custody. Use an Engineering user or the formal return workflow before Stores moves it.");
      } else {
        throw new AppError(403, "You are not permitted to move this kit from its current custody");
      }

      await tx.query(
        `UPDATE inventory_assets
         SET current_location_id = ?, current_custody = ?, stock_status = ?,
             version = version + 1, updated_by = ?
         WHERE id = ?`,
        [destination.id, nextCustody, nextStatus, user.id, asset.id],
      );

      const movementId = await inventoryRepository.insertMovement(tx, {
        movementReference: movementReference(),
        movementType,
        fromLocationId: asset.current_location_id,
        toLocationId: destination.id,
        fromCustody: asset.current_custody,
        toCustody: nextCustody,
        projectId: asset.project_id,
        performedBy: user.id,
        reference: payload.reference,
        reason: payload.reason || "Kit location movement",
        correlationId: context.correlationId,
        items: [{
          assetId: asset.id,
          inventoryPartId: asset.inventory_part_id,
          serialNumber: asset.serial_number,
          partCode: asset.part_code,
          quantity: 1,
        }],
      });

      await inventoryRepository.insertAudit(tx, auditPayload(user, context, {
        eventType: movementType,
        entityType: "inventory_asset",
        entityId: asset.id,
        action: "MOVE",
        beforeValue: {
          locationId: asset.current_location_id,
          custody: asset.current_custody,
          status: asset.stock_status,
        },
        afterValue: {
          locationId: destination.id,
          locationCode: destination.location_code,
          assignedEmployeeId: destination.assigned_employee_id || null,
          assignedEmployeeName: destination.assigned_employee_name || null,
          custody: nextCustody,
          status: nextStatus,
          movementId,
        },
      }));

      assetId = asset.id;
    });

    return inventoryRepository.getAsset(assetId);
  },
};
