import { getActiveWriteEngine, pool, withTransaction } from "../../config/db.js";
import { AppError } from "../../lib/app-error.js";
import { ensureInventorySchema } from "./inventory.schema.js";

function numberValue(value) {
  return Number(value ?? 0);
}

function normalizeCode(value) {
  return String(value || "").trim().toUpperCase();
}

async function ensureMysqlInventory() {
  const engine = await getActiveWriteEngine();
  if (engine !== "mysql") {
    throw new AppError(503, "Inventory warehouse operations require MySQL as the active write database");
  }
  await ensureInventorySchema();
}

export const inventoryRepository = {
  async ensureSchema() {
    return ensureInventorySchema();
  },

  async ensureReady() {
    await ensureMysqlInventory();
  },

  async listMeta() {
    await ensureMysqlInventory();
    const [kitTypesResult, userGroupsResult, partsResult, warehousesResult, locationsResult, projectsResult, couriersResult] =
      await Promise.all([
        pool.query(`SELECT id, code, name, description, active FROM inventory_kit_types WHERE active = TRUE ORDER BY code`),
        pool.query(`SELECT id, name, description, active FROM inventory_user_groups WHERE active = TRUE ORDER BY name`),
        pool.query(`
          SELECT ip.*, kt.code AS kit_type_code, kt.name AS kit_type_name, ug.name AS user_group_name
          FROM inventory_parts ip
          INNER JOIN inventory_kit_types kt ON kt.id = ip.kit_type_id
          LEFT JOIN inventory_user_groups ug ON ug.id = ip.user_group_id
          WHERE ip.active = TRUE
          ORDER BY ip.part_description
        `),
        pool.query(`SELECT * FROM inventory_warehouses WHERE active = TRUE ORDER BY code`),
        pool.query(`
          SELECT l.*, w.code AS warehouse_code, w.name AS warehouse_name
          FROM inventory_locations l
          INNER JOIN inventory_warehouses w ON w.id = l.warehouse_id
          WHERE l.active = TRUE
          ORDER BY l.location_code
        `),
        pool.query(`
          SELECT id, \`Ja_Code\` AS ja_code, \`Project_Name\` AS project_name,
                 UPPER(\`Suffix\`) AS suffix, \`Status\` AS status
          FROM projects
          WHERE \`Status\` = 'active'
          ORDER BY \`Ja_Code\`, \`Suffix\`
        `),
        pool.query(`SELECT * FROM inventory_couriers WHERE active = TRUE ORDER BY courier_name`),
      ]);

    return {
      kitTypes: kitTypesResult[0],
      userGroups: userGroupsResult[0],
      parts: partsResult[0],
      warehouses: warehousesResult[0],
      locations: locationsResult[0],
      projects: projectsResult[0],
      couriers: couriersResult[0],
    };
  },

  async dashboard() {
    await ensureMysqlInventory();
    const [[assetRows], [quantityRows], [handoverRows], [shipmentRows], [movementRows]] = await Promise.all([
      pool.query(`
        SELECT
          COUNT(*) AS total_assets,
          SUM(CASE WHEN stock_status = 'AVAILABLE' THEN 1 ELSE 0 END) AS available,
          SUM(CASE WHEN stock_status = 'RESERVED' THEN 1 ELSE 0 END) AS reserved,
          SUM(CASE WHEN stock_status = 'PICKED' THEN 1 ELSE 0 END) AS picked,
          SUM(CASE WHEN current_custody = 'ENGINEERING' THEN 1 ELSE 0 END) AS with_engineering,
          SUM(CASE WHEN stock_status = 'RETURN_PENDING' THEN 1 ELSE 0 END) AS awaiting_return,
          SUM(CASE WHEN stock_status IN ('READY_TO_PACK', 'RETURNED') THEN 1 ELSE 0 END) AS ready_to_pack,
          SUM(CASE WHEN stock_status = 'READY_TO_SHIP' THEN 1 ELSE 0 END) AS ready_to_ship,
          SUM(CASE WHEN stock_status = 'IN_TRANSIT' THEN 1 ELSE 0 END) AS in_transit,
          SUM(CASE WHEN stock_status = 'QUARANTINE' THEN 1 ELSE 0 END) AS quarantine
        FROM inventory_assets
      `),
      pool.query(`
        SELECT
          COALESCE(SUM(available_quantity), 0) AS available_quantity,
          COALESCE(SUM(reserved_quantity), 0) AS reserved_quantity,
          COALESCE(SUM(quarantine_quantity), 0) AS quarantine_quantity
        FROM inventory_stock_balances
      `),
      pool.query(`
        SELECT id, handover_reference, direction, status, issued_at, project_id
        FROM inventory_handovers
        WHERE status = 'PENDING'
        ORDER BY issued_at DESC
        LIMIT 10
      `),
      pool.query(`
        SELECT s.id, s.shipment_reference, s.shipment_status, s.tracking_number,
               p.\`Ja_Code\` AS project_code, p.\`Project_Name\` AS project_name
        FROM inventory_shipments s
        INNER JOIN projects p ON p.id = s.project_id
        WHERE s.shipment_status IN ('PACKED', 'READY_TO_SHIP', 'DISPATCHED', 'IN_TRANSIT')
        ORDER BY s.created_at DESC
        LIMIT 10
      `),
      pool.query(`
        SELECT m.id, m.movement_reference, m.movement_type, m.movement_date,
               e.name AS performed_by_name, p.\`Ja_Code\` AS project_code
        FROM inventory_movements m
        INNER JOIN employees e ON e.id = m.performed_by
        LEFT JOIN projects p ON p.id = m.project_id
        ORDER BY m.movement_date DESC
        LIMIT 12
      `),
    ]);

    const assets = assetRows[0] || {};
    const quantities = quantityRows[0] || {};
    return {
      metrics: {
        totalAssets: numberValue(assets.total_assets),
        available: numberValue(assets.available),
        reserved: numberValue(assets.reserved),
        picked: numberValue(assets.picked),
        withEngineering: numberValue(assets.with_engineering),
        awaitingReturn: numberValue(assets.awaiting_return),
        readyToPack: numberValue(assets.ready_to_pack),
        readyToShip: numberValue(assets.ready_to_ship),
        inTransit: numberValue(assets.in_transit),
        quarantine: numberValue(assets.quarantine),
        quantityAvailable: numberValue(quantities.available_quantity),
        quantityReserved: numberValue(quantities.reserved_quantity),
        quantityQuarantine: numberValue(quantities.quarantine_quantity),
      },
      pendingHandovers: handoverRows,
      activeShipments: shipmentRows,
      recentMovements: movementRows,
    };
  },

  async search(searchTerm, limit = 25) {
    await ensureMysqlInventory();
    const term = `%${String(searchTerm || "").trim()}%`;
    const safeLimit = Math.min(Math.max(Number(limit) || 25, 1), 100);
    const params = Array(11).fill(term);
    params.push(safeLimit);

    const [rows] = await pool.query(
      `
      SELECT DISTINCT
        a.id, a.serial_number, a.part_code, a.stock_status, a.current_custody,
        a.condition_status, a.project_id, a.current_location_id,
        ip.manufacturer_part_code, ip.part_description, ip.manufacturer, ip.model,
        kt.code AS kit_type_code, kt.name AS kit_type_name,
        p.\`Ja_Code\` AS project_code, p.\`Project_Name\` AS project_name,
        p.\`Suffix\` AS project_suffix,
        l.location_code
      FROM inventory_assets a
      INNER JOIN inventory_parts ip ON ip.id = a.inventory_part_id
      INNER JOIN inventory_kit_types kt ON kt.id = ip.kit_type_id
      INNER JOIN projects p ON p.id = a.project_id
      LEFT JOIN inventory_locations l ON l.id = a.current_location_id
      WHERE
        a.serial_number LIKE ? OR
        a.part_code LIKE ? OR
        ip.manufacturer_part_code LIKE ? OR
        ip.part_description LIKE ? OR
        ip.manufacturer LIKE ? OR
        ip.model LIKE ? OR
        kt.name LIKE ? OR
        p.\`Ja_Code\` LIKE ? OR
        p.\`Project_Name\` LIKE ? OR
        p.\`Suffix\` LIKE ? OR
        l.location_code LIKE ? OR
        EXISTS (
          SELECT 1 FROM inventory_asset_part_code_history h
          WHERE h.asset_id = a.id
            AND h.old_part_code LIKE ?
        )
      ORDER BY a.updated_at DESC
      LIMIT ?
      `,
      [...params.slice(0, 11), term, safeLimit],
    );
    return rows;
  },

  async listAssets({ page = 1, limit = 50, status, custody, projectId, q } = {}) {
    await ensureMysqlInventory();
    const safePage = Math.max(Number(page) || 1, 1);
    const safeLimit = Math.min(Math.max(Number(limit) || 50, 1), 100);
    const offset = (safePage - 1) * safeLimit;
    const where = ["1 = 1"];
    const params = [];

    if (status) {
      where.push("a.stock_status = ?");
      params.push(status);
    }
    if (custody) {
      where.push("a.current_custody = ?");
      params.push(custody);
    }
    if (projectId) {
      where.push("a.project_id = ?");
      params.push(Number(projectId));
    }
    if (q) {
      const term = `%${String(q).trim()}%`;
      where.push(`(a.serial_number LIKE ? OR a.part_code LIKE ? OR ip.part_description LIKE ? OR p.\`Ja_Code\` LIKE ?)`);
      params.push(term, term, term, term);
    }

    const baseFrom = `
      FROM inventory_assets a
      INNER JOIN inventory_parts ip ON ip.id = a.inventory_part_id
      INNER JOIN inventory_kit_types kt ON kt.id = ip.kit_type_id
      INNER JOIN projects p ON p.id = a.project_id
      LEFT JOIN inventory_locations l ON l.id = a.current_location_id
      WHERE ${where.join(" AND ")}
    `;

    const [[countRow], rowsResult] = await Promise.all([
      pool.query(`SELECT COUNT(*) AS total ${baseFrom}`, params),
      pool.query(
        `SELECT a.*, ip.part_description, ip.manufacturer_part_code, ip.manufacturer, ip.model,
                kt.code AS kit_type_code, p.\`Ja_Code\` AS project_code,
                p.\`Project_Name\` AS project_name, p.\`Suffix\` AS project_suffix,
                l.location_code
         ${baseFrom}
         ORDER BY a.updated_at DESC
         LIMIT ? OFFSET ?`,
        [...params, safeLimit, offset],
      ),
    ]);

    return {
      items: rowsResult[0],
      page: safePage,
      limit: safeLimit,
      total: numberValue(countRow[0]?.total),
    };
  },

  async getAsset(assetId) {
    await ensureMysqlInventory();
    const [[assetRows], [historyRows], [movementRows], [shipmentRows]] = await Promise.all([
      pool.query(
        `SELECT a.*, ip.part_description, ip.manufacturer_part_code, ip.manufacturer, ip.model,
                ip.stock_type, ug.name AS user_group_name, kt.code AS kit_type_code,
                kt.name AS kit_type_name, p.\`Ja_Code\` AS project_code,
                p.\`Project_Name\` AS project_name, p.\`Suffix\` AS project_suffix,
                l.location_code, l.description AS location_description
         FROM inventory_assets a
         INNER JOIN inventory_parts ip ON ip.id = a.inventory_part_id
         INNER JOIN inventory_kit_types kt ON kt.id = ip.kit_type_id
         LEFT JOIN inventory_user_groups ug ON ug.id = ip.user_group_id
         INNER JOIN projects p ON p.id = a.project_id
         LEFT JOIN inventory_locations l ON l.id = a.current_location_id
         WHERE a.id = ? LIMIT 1`,
        [assetId],
      ),
      pool.query(
        `SELECT h.*, op.\`Ja_Code\` AS old_project_code, np.\`Ja_Code\` AS new_project_code,
                e.name AS changed_by_name
         FROM inventory_asset_part_code_history h
         LEFT JOIN projects op ON op.id = h.old_project_id
         INNER JOIN projects np ON np.id = h.new_project_id
         INNER JOIN employees e ON e.id = h.changed_by
         WHERE h.asset_id = ? ORDER BY h.changed_at DESC`,
        [assetId],
      ),
      pool.query(
        `SELECT m.*, mi.serial_number, mi.part_code, mi.quantity, e.name AS performed_by_name,
                fl.location_code AS from_location_code, tl.location_code AS to_location_code
         FROM inventory_movement_items mi
         INNER JOIN inventory_movements m ON m.id = mi.movement_id
         INNER JOIN employees e ON e.id = m.performed_by
         LEFT JOIN inventory_locations fl ON fl.id = m.from_location_id
         LEFT JOIN inventory_locations tl ON tl.id = m.to_location_id
         WHERE mi.asset_id = ? ORDER BY m.movement_date DESC`,
        [assetId],
      ),
      pool.query(
        `SELECT s.*, c.courier_name
         FROM inventory_shipment_items si
         INNER JOIN inventory_shipments s ON s.id = si.shipment_id
         LEFT JOIN inventory_couriers c ON c.id = s.courier_id
         WHERE si.asset_id = ? ORDER BY s.created_at DESC`,
        [assetId],
      ),
    ]);

    if (!assetRows[0]) {
      return null;
    }
    return {
      asset: assetRows[0],
      partCodeHistory: historyRows,
      movements: movementRows,
      shipments: shipmentRows,
    };
  },

  async listMovements(limit = 100) {
    await ensureMysqlInventory();
    const safeLimit = Math.min(Math.max(Number(limit) || 100, 1), 250);
    const [rows] = await pool.query(
      `SELECT m.*, e.name AS performed_by_name, p.\`Ja_Code\` AS project_code,
              fl.location_code AS from_location_code, tl.location_code AS to_location_code
       FROM inventory_movements m
       INNER JOIN employees e ON e.id = m.performed_by
       LEFT JOIN projects p ON p.id = m.project_id
       LEFT JOIN inventory_locations fl ON fl.id = m.from_location_id
       LEFT JOIN inventory_locations tl ON tl.id = m.to_location_id
       ORDER BY m.movement_date DESC LIMIT ?`,
      [safeLimit],
    );
    return rows;
  },

  async listHandovers(limit = 100) {
    await ensureMysqlInventory();
    const safeLimit = Math.min(Math.max(Number(limit) || 100, 1), 250);
    const [rows] = await pool.query(
      `SELECT h.*, p.\`Ja_Code\` AS project_code, p.\`Project_Name\` AS project_name,
              issuer.name AS issued_by_name, receiver.name AS received_by_name
       FROM inventory_handovers h
       INNER JOIN projects p ON p.id = h.project_id
       INNER JOIN employees issuer ON issuer.id = h.issued_by
       LEFT JOIN employees receiver ON receiver.id = h.received_by
       ORDER BY h.issued_at DESC LIMIT ?`,
      [safeLimit],
    );
    return rows;
  },

  async listShipments(limit = 100) {
    await ensureMysqlInventory();
    const safeLimit = Math.min(Math.max(Number(limit) || 100, 1), 250);
    const [rows] = await pool.query(
      `SELECT s.*, p.\`Ja_Code\` AS project_code, p.\`Project_Name\` AS project_name,
              c.courier_name, e.name AS packed_by_name
       FROM inventory_shipments s
       INNER JOIN projects p ON p.id = s.project_id
       LEFT JOIN inventory_couriers c ON c.id = s.courier_id
       INNER JOIN employees e ON e.id = s.packed_by
       ORDER BY s.created_at DESC LIMIT ?`,
      [safeLimit],
    );
    return rows;
  },

  async listAudit(limit = 100) {
    await ensureMysqlInventory();
    const safeLimit = Math.min(Math.max(Number(limit) || 100, 1), 250);
    const [rows] = await pool.query(
      `SELECT a.*, e.name AS user_name
       FROM inventory_audit_logs a
       INNER JOIN employees e ON e.id = a.user_id
       ORDER BY a.created_at DESC LIMIT ?`,
      [safeLimit],
    );
    return rows;
  },

  async createKitType(payload, userId) {
    await ensureMysqlInventory();
    const code = normalizeCode(payload.code);
    await pool.query(
      `INSERT INTO inventory_kit_types (code, name, description, active, created_by)
       VALUES (?, ?, ?, TRUE, ?)
       ON DUPLICATE KEY UPDATE name = VALUES(name), description = VALUES(description), active = TRUE`,
      [code, payload.name.trim(), payload.description || null, userId],
    );
    const [rows] = await pool.query(`SELECT * FROM inventory_kit_types WHERE code = ? LIMIT 1`, [code]);
    return rows[0];
  },

  async createUserGroup(payload, userId) {
    await ensureMysqlInventory();
    await pool.query(
      `INSERT INTO inventory_user_groups (name, description, active, created_by)
       VALUES (?, ?, TRUE, ?)
       ON DUPLICATE KEY UPDATE description = VALUES(description), active = TRUE`,
      [payload.name.trim(), payload.description || null, userId],
    );
    const [rows] = await pool.query(`SELECT * FROM inventory_user_groups WHERE name = ? LIMIT 1`, [payload.name.trim()]);
    return rows[0];
  },

  async createPart(payload, userId) {
    await ensureMysqlInventory();
    const [result] = await pool.query(
      `INSERT INTO inventory_parts
        (manufacturer_part_code, part_description, manufacturer, model, kit_type_id,
         user_group_id, serialized, stock_type, unit_of_measure, active, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, TRUE, ?)`,
      [
        payload.manufacturerPartCode || null,
        payload.partDescription.trim(),
        payload.manufacturer || null,
        payload.model || null,
        payload.kitTypeId,
        payload.userGroupId || null,
        Boolean(payload.serialized),
        payload.stockType || "STANDARD",
        payload.unitOfMeasure || "EA",
        userId,
      ],
    );
    const [rows] = await pool.query(`SELECT * FROM inventory_parts WHERE id = ? LIMIT 1`, [result.insertId]);
    return rows[0];
  },

  async createWarehouse(payload, userId) {
    await ensureMysqlInventory();
    const code = normalizeCode(payload.code);
    await pool.query(
      `INSERT INTO inventory_warehouses (code, name, description, active, created_by)
       VALUES (?, ?, ?, TRUE, ?)
       ON DUPLICATE KEY UPDATE name = VALUES(name), description = VALUES(description), active = TRUE`,
      [code, payload.name.trim(), payload.description || null, userId],
    );
    const [rows] = await pool.query(`SELECT * FROM inventory_warehouses WHERE code = ? LIMIT 1`, [code]);
    return rows[0];
  },

  async createLocation(payload, userId) {
    await ensureMysqlInventory();
    const locationCode = normalizeCode(payload.locationCode);
    await pool.query(
      `INSERT INTO inventory_locations
        (warehouse_id, store_number, aisle, shelf, bin, location_code, description, location_type, active, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, TRUE, ?)
       ON DUPLICATE KEY UPDATE description = VALUES(description), location_type = VALUES(location_type), active = TRUE`,
      [
        payload.warehouseId,
        payload.storeNumber || null,
        payload.aisle || null,
        payload.shelf || null,
        payload.bin || null,
        locationCode,
        payload.description || null,
        payload.locationType || "STORAGE",
        userId,
      ],
    );
    const [rows] = await pool.query(`SELECT * FROM inventory_locations WHERE location_code = ? LIMIT 1`, [locationCode]);
    return rows[0];
  },

  async createCourier(payload, userId) {
    await ensureMysqlInventory();
    await pool.query(
      `INSERT INTO inventory_couriers
        (courier_name, account_reference, contact_name, contact_phone, contact_email, tracking_url_template, active, created_by)
       VALUES (?, ?, ?, ?, ?, ?, TRUE, ?)
       ON DUPLICATE KEY UPDATE account_reference = VALUES(account_reference), contact_name = VALUES(contact_name),
         contact_phone = VALUES(contact_phone), contact_email = VALUES(contact_email),
         tracking_url_template = VALUES(tracking_url_template), active = TRUE`,
      [payload.courierName.trim(), payload.accountReference || null, payload.contactName || null,
       payload.contactPhone || null, payload.contactEmail || null, payload.trackingUrlTemplate || null, userId],
    );
    const [rows] = await pool.query(`SELECT * FROM inventory_couriers WHERE courier_name = ? LIMIT 1`, [payload.courierName.trim()]);
    return rows[0];
  },

  async transaction(callback) {
    await ensureMysqlInventory();
    return withTransaction(callback);
  },

  async loadProject(tx, projectId, { forUpdate = false } = {}) {
    const [rows] = await tx.query(
      `SELECT id, \`Ja_Code\` AS ja_code, \`Project_Name\` AS project_name,
              UPPER(\`Suffix\`) AS suffix, \`Status\` AS status
       FROM projects WHERE id = ? LIMIT 1 ${forUpdate ? "FOR UPDATE" : ""}`,
      [projectId],
    );
    return rows[0] || null;
  },

  async loadPart(tx, partId, { forUpdate = false } = {}) {
    const [rows] = await tx.query(
      `SELECT ip.*, kt.code AS kit_type_code, kt.name AS kit_type_name
       FROM inventory_parts ip
       INNER JOIN inventory_kit_types kt ON kt.id = ip.kit_type_id
       WHERE ip.id = ? LIMIT 1 ${forUpdate ? "FOR UPDATE" : ""}`,
      [partId],
    );
    return rows[0] || null;
  },

  async loadAsset(tx, assetId, { forUpdate = false } = {}) {
    const [rows] = await tx.query(
      `SELECT a.*, ip.kit_type_id, kt.code AS kit_type_code, ip.part_description
       FROM inventory_assets a
       INNER JOIN inventory_parts ip ON ip.id = a.inventory_part_id
       INNER JOIN inventory_kit_types kt ON kt.id = ip.kit_type_id
       WHERE a.id = ? LIMIT 1 ${forUpdate ? "FOR UPDATE" : ""}`,
      [assetId],
    );
    return rows[0] || null;
  },

  async loadLocation(tx, locationId) {
    if (!locationId) return null;
    const [rows] = await tx.query(`SELECT * FROM inventory_locations WHERE id = ? AND active = TRUE LIMIT 1`, [locationId]);
    return rows[0] || null;
  },

  async nextPartCode(tx, projectSuffix, kitTypeCode) {
    const suffix = normalizeCode(projectSuffix);
    const kitCode = normalizeCode(kitTypeCode);
    if (!/^[A-Z0-9]{3}$/.test(suffix)) {
      throw new AppError(400, "Project suffix must be exactly 3 letters/numbers before stock can be allocated");
    }
    if (!/^[A-Z0-9]{3}$/.test(kitCode)) {
      throw new AppError(400, "Kit type code must be exactly 3 letters/numbers");
    }

    await tx.query(
      `INSERT INTO inventory_part_code_sequences (project_suffix, kit_type_code, last_sequence)
       VALUES (?, ?, 0)
       ON DUPLICATE KEY UPDATE updated_at = updated_at`,
      [suffix, kitCode],
    );
    const [rows] = await tx.query(
      `SELECT id, last_sequence FROM inventory_part_code_sequences
       WHERE project_suffix = ? AND kit_type_code = ? FOR UPDATE`,
      [suffix, kitCode],
    );
    const next = numberValue(rows[0]?.last_sequence) + 1;
    if (next > 9999) {
      throw new AppError(409, `Part-code sequence exhausted for ${suffix}${kitCode}`);
    }
    await tx.query(`UPDATE inventory_part_code_sequences SET last_sequence = ? WHERE id = ?`, [next, rows[0].id]);
    return `${suffix}${kitCode}-${String(next).padStart(4, "0")}`;
  },

  async insertMovement(tx, payload) {
    const [result] = await tx.query(
      `INSERT INTO inventory_movements
        (movement_reference, movement_type, from_location_id, to_location_id, from_custody, to_custody,
         project_id, performed_by, approved_by, reference, reason, correlation_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [payload.movementReference, payload.movementType, payload.fromLocationId || null, payload.toLocationId || null,
       payload.fromCustody || null, payload.toCustody || null, payload.projectId || null, payload.performedBy,
       payload.approvedBy || null, payload.reference || null, payload.reason || null, payload.correlationId],
    );
    const movementId = result.insertId;
    for (const item of payload.items || []) {
      await tx.query(
        `INSERT INTO inventory_movement_items
          (movement_id, asset_id, inventory_part_id, serial_number, part_code, quantity)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [movementId, item.assetId || null, item.inventoryPartId, item.serialNumber || null,
         item.partCode || null, item.quantity ?? 1],
      );
    }
    return movementId;
  },

  async insertAudit(tx, payload) {
    await tx.query(
      `INSERT INTO inventory_audit_logs
        (event_type, entity_type, entity_id, action, user_id, ein, before_value, after_value,
         ip_address, user_agent, correlation_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [payload.eventType, payload.entityType, String(payload.entityId), payload.action, payload.userId,
       payload.ein || null, payload.beforeValue ? JSON.stringify(payload.beforeValue) : null,
       payload.afterValue ? JSON.stringify(payload.afterValue) : null, payload.ipAddress || null,
       payload.userAgent || null, payload.correlationId],
    );
  },
};
