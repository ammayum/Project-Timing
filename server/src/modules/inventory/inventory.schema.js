import { getActiveWriteEngine, pool } from "../../config/db.js";

const MYSQL_SCHEMA = [
  `CREATE TABLE IF NOT EXISTS inventory_user_groups (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(100) NOT NULL UNIQUE,
    description VARCHAR(500) NULL,
    active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    created_by BIGINT NULL,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
  )`,
  `CREATE TABLE IF NOT EXISTS inventory_kit_types (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    code CHAR(3) NOT NULL UNIQUE,
    name VARCHAR(120) NOT NULL,
    description VARCHAR(500) NULL,
    active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    created_by BIGINT NULL,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
  )`,
  `CREATE TABLE IF NOT EXISTS inventory_parts (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    manufacturer_part_code VARCHAR(255) NULL,
    part_description VARCHAR(500) NOT NULL,
    manufacturer VARCHAR(255) NULL,
    model VARCHAR(255) NULL,
    kit_type_id BIGINT NOT NULL,
    user_group_id BIGINT NULL,
    serialized BOOLEAN NOT NULL DEFAULT TRUE,
    stock_type VARCHAR(100) NOT NULL DEFAULT 'STANDARD',
    unit_of_measure VARCHAR(50) NOT NULL DEFAULT 'EA',
    active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    created_by BIGINT NULL,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_inventory_parts_mpn (manufacturer_part_code),
    INDEX idx_inventory_parts_kit_type (kit_type_id),
    CONSTRAINT fk_inventory_parts_kit_type FOREIGN KEY (kit_type_id) REFERENCES inventory_kit_types(id),
    CONSTRAINT fk_inventory_parts_user_group FOREIGN KEY (user_group_id) REFERENCES inventory_user_groups(id) ON DELETE SET NULL
  )`,
  `CREATE TABLE IF NOT EXISTS inventory_warehouses (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    code VARCHAR(20) NOT NULL UNIQUE,
    name VARCHAR(255) NOT NULL,
    description VARCHAR(500) NULL,
    active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    created_by BIGINT NULL,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
  )`,
  `CREATE TABLE IF NOT EXISTS inventory_locations (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    warehouse_id BIGINT NOT NULL,
    store_number VARCHAR(50) NULL,
    aisle VARCHAR(50) NULL,
    shelf VARCHAR(50) NULL,
    bin VARCHAR(50) NULL,
    location_code VARCHAR(120) NOT NULL UNIQUE,
    description VARCHAR(500) NULL,
    location_type VARCHAR(50) NOT NULL DEFAULT 'STORAGE',
    active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    created_by BIGINT NULL,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_inventory_locations_warehouse (warehouse_id),
    INDEX idx_inventory_locations_type (location_type),
    CONSTRAINT fk_inventory_locations_warehouse FOREIGN KEY (warehouse_id) REFERENCES inventory_warehouses(id)
  )`,
  `CREATE TABLE IF NOT EXISTS inventory_assets (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    serial_number VARCHAR(255) NOT NULL UNIQUE,
    part_code VARCHAR(32) NOT NULL UNIQUE,
    inventory_part_id BIGINT NOT NULL,
    project_id BIGINT NOT NULL,
    current_location_id BIGINT NULL,
    current_custody VARCHAR(50) NOT NULL DEFAULT 'STORES',
    stock_status VARCHAR(50) NOT NULL DEFAULT 'AVAILABLE',
    condition_status VARCHAR(50) NOT NULL DEFAULT 'GOOD',
    version INT NOT NULL DEFAULT 1,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    created_by BIGINT NULL,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    updated_by BIGINT NULL,
    INDEX idx_inventory_assets_project (project_id),
    INDEX idx_inventory_assets_location (current_location_id),
    INDEX idx_inventory_assets_status (stock_status),
    INDEX idx_inventory_assets_custody (current_custody),
    INDEX idx_inventory_assets_part (inventory_part_id),
    CONSTRAINT fk_inventory_assets_part FOREIGN KEY (inventory_part_id) REFERENCES inventory_parts(id),
    CONSTRAINT fk_inventory_assets_project FOREIGN KEY (project_id) REFERENCES projects(id),
    CONSTRAINT fk_inventory_assets_location FOREIGN KEY (current_location_id) REFERENCES inventory_locations(id) ON DELETE SET NULL
  )`,
  `CREATE TABLE IF NOT EXISTS inventory_part_code_sequences (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    project_suffix CHAR(3) NOT NULL,
    kit_type_code CHAR(3) NOT NULL,
    last_sequence INT NOT NULL DEFAULT 0,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uniq_inventory_part_code_sequence (project_suffix, kit_type_code)
  )`,
  `CREATE TABLE IF NOT EXISTS inventory_stock_balances (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    inventory_part_id BIGINT NOT NULL,
    location_id BIGINT NOT NULL,
    available_quantity DECIMAL(12,2) NOT NULL DEFAULT 0,
    reserved_quantity DECIMAL(12,2) NOT NULL DEFAULT 0,
    quarantine_quantity DECIMAL(12,2) NOT NULL DEFAULT 0,
    version INT NOT NULL DEFAULT 1,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uniq_inventory_balance (inventory_part_id, location_id),
    INDEX idx_inventory_balance_location (location_id),
    CONSTRAINT fk_inventory_balance_part FOREIGN KEY (inventory_part_id) REFERENCES inventory_parts(id),
    CONSTRAINT fk_inventory_balance_location FOREIGN KEY (location_id) REFERENCES inventory_locations(id)
  )`,
  `CREATE TABLE IF NOT EXISTS inventory_reservations (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    reservation_reference VARCHAR(64) NOT NULL UNIQUE,
    project_id BIGINT NOT NULL,
    status VARCHAR(30) NOT NULL DEFAULT 'ACTIVE',
    notes VARCHAR(1000) NULL,
    created_by BIGINT NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_inventory_reservation_project (project_id),
    INDEX idx_inventory_reservation_status (status),
    CONSTRAINT fk_inventory_reservation_project FOREIGN KEY (project_id) REFERENCES projects(id),
    CONSTRAINT fk_inventory_reservation_user FOREIGN KEY (created_by) REFERENCES employees(id)
  )`,
  `CREATE TABLE IF NOT EXISTS inventory_reservation_items (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    reservation_id BIGINT NOT NULL,
    asset_id BIGINT NULL,
    inventory_part_id BIGINT NOT NULL,
    location_id BIGINT NULL,
    quantity DECIMAL(12,2) NOT NULL DEFAULT 1,
    status VARCHAR(30) NOT NULL DEFAULT 'RESERVED',
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_inventory_reservation_item_asset (asset_id),
    INDEX idx_inventory_reservation_item_part (inventory_part_id),
    CONSTRAINT fk_inventory_reservation_item_header FOREIGN KEY (reservation_id) REFERENCES inventory_reservations(id) ON DELETE CASCADE,
    CONSTRAINT fk_inventory_reservation_item_asset FOREIGN KEY (asset_id) REFERENCES inventory_assets(id) ON DELETE SET NULL,
    CONSTRAINT fk_inventory_reservation_item_part FOREIGN KEY (inventory_part_id) REFERENCES inventory_parts(id),
    CONSTRAINT fk_inventory_reservation_item_location FOREIGN KEY (location_id) REFERENCES inventory_locations(id) ON DELETE SET NULL
  )`,
  `CREATE TABLE IF NOT EXISTS inventory_movements (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    movement_reference VARCHAR(64) NOT NULL UNIQUE,
    movement_type VARCHAR(50) NOT NULL,
    from_location_id BIGINT NULL,
    to_location_id BIGINT NULL,
    from_custody VARCHAR(50) NULL,
    to_custody VARCHAR(50) NULL,
    project_id BIGINT NULL,
    performed_by BIGINT NOT NULL,
    approved_by BIGINT NULL,
    movement_date TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    reference VARCHAR(255) NULL,
    reason VARCHAR(1000) NULL,
    correlation_id VARCHAR(64) NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_inventory_movement_date (movement_date),
    INDEX idx_inventory_movement_project (project_id),
    INDEX idx_inventory_movement_correlation (correlation_id),
    CONSTRAINT fk_inventory_movement_project FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE SET NULL,
    CONSTRAINT fk_inventory_movement_user FOREIGN KEY (performed_by) REFERENCES employees(id),
    CONSTRAINT fk_inventory_movement_from_location FOREIGN KEY (from_location_id) REFERENCES inventory_locations(id) ON DELETE SET NULL,
    CONSTRAINT fk_inventory_movement_to_location FOREIGN KEY (to_location_id) REFERENCES inventory_locations(id) ON DELETE SET NULL
  )`,
  `CREATE TABLE IF NOT EXISTS inventory_movement_items (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    movement_id BIGINT NOT NULL,
    asset_id BIGINT NULL,
    inventory_part_id BIGINT NOT NULL,
    serial_number VARCHAR(255) NULL,
    part_code VARCHAR(32) NULL,
    quantity DECIMAL(12,2) NOT NULL DEFAULT 1,
    INDEX idx_inventory_movement_item_asset (asset_id),
    INDEX idx_inventory_movement_item_part (inventory_part_id),
    CONSTRAINT fk_inventory_movement_item_header FOREIGN KEY (movement_id) REFERENCES inventory_movements(id) ON DELETE CASCADE,
    CONSTRAINT fk_inventory_movement_item_asset FOREIGN KEY (asset_id) REFERENCES inventory_assets(id) ON DELETE SET NULL,
    CONSTRAINT fk_inventory_movement_item_part FOREIGN KEY (inventory_part_id) REFERENCES inventory_parts(id)
  )`,
  `CREATE TABLE IF NOT EXISTS inventory_asset_part_code_history (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    asset_id BIGINT NOT NULL,
    serial_number VARCHAR(255) NOT NULL,
    old_part_code VARCHAR(255) NULL,
    new_part_code VARCHAR(32) NOT NULL,
    old_project_id BIGINT NULL,
    new_project_id BIGINT NOT NULL,
    changed_by BIGINT NOT NULL,
    changed_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    reason VARCHAR(1000) NULL,
    movement_id BIGINT NULL,
    INDEX idx_inventory_history_asset (asset_id),
    INDEX idx_inventory_history_serial (serial_number),
    INDEX idx_inventory_history_old_code (old_part_code),
    INDEX idx_inventory_history_new_code (new_part_code),
    CONSTRAINT fk_inventory_history_asset FOREIGN KEY (asset_id) REFERENCES inventory_assets(id) ON DELETE CASCADE,
    CONSTRAINT fk_inventory_history_user FOREIGN KEY (changed_by) REFERENCES employees(id),
    CONSTRAINT fk_inventory_history_movement FOREIGN KEY (movement_id) REFERENCES inventory_movements(id) ON DELETE SET NULL
  )`,
  `CREATE TABLE IF NOT EXISTS inventory_handovers (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    handover_reference VARCHAR(64) NOT NULL UNIQUE,
    direction VARCHAR(40) NOT NULL,
    project_id BIGINT NOT NULL,
    from_location_id BIGINT NULL,
    to_location_id BIGINT NULL,
    from_custody VARCHAR(50) NOT NULL,
    to_custody VARCHAR(50) NOT NULL,
    issued_by BIGINT NOT NULL,
    issued_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    received_by BIGINT NULL,
    received_at TIMESTAMP NULL,
    status VARCHAR(30) NOT NULL DEFAULT 'PENDING',
    notes VARCHAR(1000) NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_inventory_handover_project (project_id),
    INDEX idx_inventory_handover_status (status),
    CONSTRAINT fk_inventory_handover_project FOREIGN KEY (project_id) REFERENCES projects(id),
    CONSTRAINT fk_inventory_handover_issued_by FOREIGN KEY (issued_by) REFERENCES employees(id),
    CONSTRAINT fk_inventory_handover_received_by FOREIGN KEY (received_by) REFERENCES employees(id) ON DELETE SET NULL,
    CONSTRAINT fk_inventory_handover_from_location FOREIGN KEY (from_location_id) REFERENCES inventory_locations(id) ON DELETE SET NULL,
    CONSTRAINT fk_inventory_handover_to_location FOREIGN KEY (to_location_id) REFERENCES inventory_locations(id) ON DELETE SET NULL
  )`,
  `CREATE TABLE IF NOT EXISTS inventory_handover_items (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    handover_id BIGINT NOT NULL,
    asset_id BIGINT NULL,
    inventory_part_id BIGINT NOT NULL,
    serial_number VARCHAR(255) NULL,
    part_code VARCHAR(32) NULL,
    quantity DECIMAL(12,2) NOT NULL DEFAULT 1,
    CONSTRAINT fk_inventory_handover_item_header FOREIGN KEY (handover_id) REFERENCES inventory_handovers(id) ON DELETE CASCADE,
    CONSTRAINT fk_inventory_handover_item_asset FOREIGN KEY (asset_id) REFERENCES inventory_assets(id) ON DELETE SET NULL,
    CONSTRAINT fk_inventory_handover_item_part FOREIGN KEY (inventory_part_id) REFERENCES inventory_parts(id)
  )`,
  `CREATE TABLE IF NOT EXISTS inventory_couriers (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    courier_name VARCHAR(255) NOT NULL UNIQUE,
    account_reference VARCHAR(255) NULL,
    contact_name VARCHAR(255) NULL,
    contact_phone VARCHAR(100) NULL,
    contact_email VARCHAR(255) NULL,
    tracking_url_template VARCHAR(1000) NULL,
    active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    created_by BIGINT NULL,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
  )`,
  `CREATE TABLE IF NOT EXISTS inventory_shipments (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    shipment_reference VARCHAR(64) NOT NULL UNIQUE,
    project_id BIGINT NOT NULL,
    destination_name VARCHAR(255) NOT NULL,
    destination_contact VARCHAR(255) NULL,
    destination_address TEXT NOT NULL,
    courier_id BIGINT NULL,
    courier_service VARCHAR(255) NULL,
    consignment_number VARCHAR(255) NULL,
    tracking_number VARCHAR(255) NULL,
    shipment_status VARCHAR(50) NOT NULL DEFAULT 'PACKED',
    packed_by BIGINT NOT NULL,
    dispatched_by BIGINT NULL,
    packed_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    dispatched_at TIMESTAMP NULL,
    delivered_at TIMESTAMP NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_inventory_shipment_project (project_id),
    INDEX idx_inventory_shipment_tracking (tracking_number),
    INDEX idx_inventory_shipment_status (shipment_status),
    CONSTRAINT fk_inventory_shipment_project FOREIGN KEY (project_id) REFERENCES projects(id),
    CONSTRAINT fk_inventory_shipment_courier FOREIGN KEY (courier_id) REFERENCES inventory_couriers(id) ON DELETE SET NULL,
    CONSTRAINT fk_inventory_shipment_packed_by FOREIGN KEY (packed_by) REFERENCES employees(id),
    CONSTRAINT fk_inventory_shipment_dispatched_by FOREIGN KEY (dispatched_by) REFERENCES employees(id) ON DELETE SET NULL
  )`,
  `CREATE TABLE IF NOT EXISTS inventory_shipment_items (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    shipment_id BIGINT NOT NULL,
    asset_id BIGINT NULL,
    inventory_part_id BIGINT NOT NULL,
    serial_number VARCHAR(255) NULL,
    part_code VARCHAR(32) NULL,
    quantity DECIMAL(12,2) NOT NULL DEFAULT 1,
    INDEX idx_inventory_shipment_item_asset (asset_id),
    CONSTRAINT fk_inventory_shipment_item_header FOREIGN KEY (shipment_id) REFERENCES inventory_shipments(id) ON DELETE CASCADE,
    CONSTRAINT fk_inventory_shipment_item_asset FOREIGN KEY (asset_id) REFERENCES inventory_assets(id) ON DELETE SET NULL,
    CONSTRAINT fk_inventory_shipment_item_part FOREIGN KEY (inventory_part_id) REFERENCES inventory_parts(id)
  )`,
  `CREATE TABLE IF NOT EXISTS inventory_shipment_tracking_events (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    shipment_id BIGINT NOT NULL,
    courier_status VARCHAR(100) NOT NULL,
    event_description VARCHAR(1000) NULL,
    event_location VARCHAR(255) NULL,
    event_timestamp TIMESTAMP NOT NULL,
    external_reference VARCHAR(255) NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_inventory_tracking_shipment (shipment_id),
    INDEX idx_inventory_tracking_timestamp (event_timestamp),
    CONSTRAINT fk_inventory_tracking_shipment FOREIGN KEY (shipment_id) REFERENCES inventory_shipments(id) ON DELETE CASCADE
  )`,
  `CREATE TABLE IF NOT EXISTS inventory_audit_logs (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    event_type VARCHAR(100) NOT NULL,
    entity_type VARCHAR(100) NOT NULL,
    entity_id VARCHAR(100) NOT NULL,
    action VARCHAR(100) NOT NULL,
    user_id BIGINT NOT NULL,
    ein VARCHAR(255) NULL,
    before_value JSON NULL,
    after_value JSON NULL,
    ip_address VARCHAR(100) NULL,
    user_agent VARCHAR(1000) NULL,
    correlation_id VARCHAR(64) NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_inventory_audit_entity (entity_type, entity_id),
    INDEX idx_inventory_audit_event (event_type),
    INDEX idx_inventory_audit_created (created_at),
    INDEX idx_inventory_audit_correlation (correlation_id),
    CONSTRAINT fk_inventory_audit_user FOREIGN KEY (user_id) REFERENCES employees(id)
  )`,
];

const KIT_TYPE_SEEDS = [
  ["RTR", "Router"],
  ["SWI", "Network Switch"],
  ["FIR", "Firewall"],
  ["APL", "Wireless Access Point"],
  ["SRV", "Server"],
  ["UPS", "UPS"],
  ["PDU", "Power Distribution Unit"],
  ["MOD", "Modem"],
  ["ANT", "Antenna"],
  ["ACC", "Accessory"],
  ["CAB", "Cable"],
  ["PSU", "Power Supply"],
];

export async function ensureInventorySchema() {
  const engine = await getActiveWriteEngine();
  if (engine !== "mysql") {
    return {
      available: false,
      reason: "The inventory warehouse module currently requires MySQL as the active write database.",
    };
  }

  for (const statement of MYSQL_SCHEMA) {
    await pool.query(statement);
  }

  await pool.query(
    `INSERT IGNORE INTO teams (name, description)
     VALUES ('Stores', 'Stores and warehouse stock management'),
            ('Engineering', 'Engineering team custody destination/source')`,
  );

  for (const [code, name] of KIT_TYPE_SEEDS) {
    await pool.query(
      `INSERT IGNORE INTO inventory_kit_types (code, name, description)
       VALUES (?, ?, ?)`,
      [code, name, `${name} inventory type`],
    );
  }

  await pool.query(
    `INSERT IGNORE INTO inventory_warehouses (code, name, description)
     VALUES ('SHEF', 'Sheffield', 'Default warehouse')`,
  );

  const defaultLocations = [
    ["SHEF-01-A01-S01-B01", "STORAGE", "Store 01 / Aisle A01 / Shelf S01 / Bin B01", "01", "A01", "S01", "B01"],
    ["SHEF-01-A01-S01-B02", "STORAGE", "Store 01 / Aisle A01 / Shelf S01 / Bin B02", "01", "A01", "S01", "B02"],
    ["SHEF-ENG-HANDOVER", "ENGINEERING_HANDOVER", "Engineering handover point", null, null, null, null],
    ["SHEF-ENG-CUSTODY", "ENGINEERING_CUSTODY", "Engineering team custody", null, null, null, null],
    ["SHEF-RETURNS", "RETURNS", "Stores returns intake", null, null, null, null],
    ["SHEF-QUARANTINE", "QUARANTINE", "Quarantine stock", null, null, null, null],
    ["SHEF-PACKING", "PACKING", "Packing area", null, null, null, null],
    ["SHEF-DISPATCH", "DISPATCH", "Dispatch area", null, null, null, null],
  ];

  for (const [locationCode, locationType, description, storeNumber, aisle, shelf, bin] of defaultLocations) {
    await pool.query(
      `INSERT IGNORE INTO inventory_locations
        (warehouse_id, store_number, aisle, shelf, bin, location_code, description, location_type)
       SELECT id, ?, ?, ?, ?, ?, ?, ?
       FROM inventory_warehouses
       WHERE code = 'SHEF'
       LIMIT 1`,
      [storeNumber, aisle, shelf, bin, locationCode, description, locationType],
    );
  }

  return { available: true, engine };
}
