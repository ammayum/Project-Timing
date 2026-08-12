import { getActiveWriteEngine, pool } from "../../config/db.js";

const PALLET_SCHEMA = [
  `CREATE TABLE IF NOT EXISTS inventory_pallet_sequences (
    project_suffix CHAR(3) PRIMARY KEY,
    last_sequence INT NOT NULL DEFAULT 0,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
  )`,
  `CREATE TABLE IF NOT EXISTS inventory_pallets (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    pallet_code VARCHAR(32) NOT NULL UNIQUE,
    project_id BIGINT NOT NULL,
    current_location_id BIGINT NOT NULL,
    current_custody VARCHAR(50) NOT NULL DEFAULT 'STORES',
    pallet_status VARCHAR(30) NOT NULL DEFAULT 'OPEN',
    description VARCHAR(500) NULL,
    version INT NOT NULL DEFAULT 1,
    created_by INT NOT NULL,
    updated_by INT NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_inventory_pallet_project (project_id),
    INDEX idx_inventory_pallet_location (current_location_id),
    INDEX idx_inventory_pallet_custody (current_custody),
    INDEX idx_inventory_pallet_status (pallet_status),
    CONSTRAINT fk_inventory_pallet_project FOREIGN KEY (project_id) REFERENCES projects(id),
    CONSTRAINT fk_inventory_pallet_location FOREIGN KEY (current_location_id) REFERENCES inventory_locations(id),
    CONSTRAINT fk_inventory_pallet_created_by FOREIGN KEY (created_by) REFERENCES employees(id),
    CONSTRAINT fk_inventory_pallet_updated_by FOREIGN KEY (updated_by) REFERENCES employees(id)
  )`,
  `CREATE TABLE IF NOT EXISTS inventory_pallet_assets (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    pallet_id BIGINT NOT NULL,
    asset_id BIGINT NOT NULL UNIQUE,
    added_by INT NOT NULL,
    added_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uniq_inventory_pallet_asset_pair (pallet_id, asset_id),
    INDEX idx_inventory_pallet_assets_pallet (pallet_id),
    CONSTRAINT fk_inventory_pallet_assets_pallet FOREIGN KEY (pallet_id) REFERENCES inventory_pallets(id) ON DELETE CASCADE,
    CONSTRAINT fk_inventory_pallet_assets_asset FOREIGN KEY (asset_id) REFERENCES inventory_assets(id) ON DELETE CASCADE,
    CONSTRAINT fk_inventory_pallet_assets_user FOREIGN KEY (added_by) REFERENCES employees(id)
  )`,
  `CREATE TABLE IF NOT EXISTS inventory_pallet_membership_history (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    pallet_id BIGINT NOT NULL,
    asset_id BIGINT NOT NULL,
    action VARCHAR(20) NOT NULL,
    performed_by INT NOT NULL,
    reason VARCHAR(1000) NULL,
    occurred_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_inventory_pallet_membership_pallet (pallet_id),
    INDEX idx_inventory_pallet_membership_asset (asset_id),
    CONSTRAINT fk_inventory_pallet_membership_pallet FOREIGN KEY (pallet_id) REFERENCES inventory_pallets(id) ON DELETE CASCADE,
    CONSTRAINT fk_inventory_pallet_membership_asset FOREIGN KEY (asset_id) REFERENCES inventory_assets(id),
    CONSTRAINT fk_inventory_pallet_membership_user FOREIGN KEY (performed_by) REFERENCES employees(id)
  )`,
  `CREATE TABLE IF NOT EXISTS inventory_pallet_movements (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    pallet_id BIGINT NOT NULL,
    inventory_movement_id BIGINT NULL,
    from_location_id BIGINT NOT NULL,
    to_location_id BIGINT NOT NULL,
    from_custody VARCHAR(50) NOT NULL,
    to_custody VARCHAR(50) NOT NULL,
    performed_by INT NOT NULL,
    reference VARCHAR(255) NULL,
    reason VARCHAR(1000) NULL,
    correlation_id VARCHAR(64) NOT NULL,
    moved_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_inventory_pallet_movement_pallet (pallet_id),
    INDEX idx_inventory_pallet_movement_date (moved_at),
    CONSTRAINT fk_inventory_pallet_movement_pallet FOREIGN KEY (pallet_id) REFERENCES inventory_pallets(id) ON DELETE CASCADE,
    CONSTRAINT fk_inventory_pallet_movement_inventory FOREIGN KEY (inventory_movement_id) REFERENCES inventory_movements(id) ON DELETE SET NULL,
    CONSTRAINT fk_inventory_pallet_movement_from FOREIGN KEY (from_location_id) REFERENCES inventory_locations(id),
    CONSTRAINT fk_inventory_pallet_movement_to FOREIGN KEY (to_location_id) REFERENCES inventory_locations(id),
    CONSTRAINT fk_inventory_pallet_movement_user FOREIGN KEY (performed_by) REFERENCES employees(id)
  )`,
];

export async function ensurePalletSchema() {
  const engine = await getActiveWriteEngine();
  if (engine !== "mysql") {
    return {
      available: false,
      reason: "Pallet inventory requires MySQL as the active write database.",
    };
  }

  for (const statement of PALLET_SCHEMA) {
    await pool.query(statement);
  }

  return { available: true, engine };
}
