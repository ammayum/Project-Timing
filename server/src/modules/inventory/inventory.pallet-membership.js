// Pallet membership is a handling relationship only.
// IMPORTANT: moving one kit separately must never delete, close, relocate, or otherwise
// disband its pallet. This helper deducts only that kit from the pallet contents and
// leaves the pallet identity/status/location/custody intact, even when the count reaches 0.
export async function detachAssetFromPallet(tx, assetId, userId, reason = "Kit moved separately") {
  const [rows] = await tx.query(
    `SELECT pa.id AS membership_id, pa.pallet_id, p.pallet_code,
            p.pallet_status, p.project_id, p.current_location_id, p.current_custody
     FROM inventory_pallet_assets pa
     INNER JOIN inventory_pallets p ON p.id = pa.pallet_id
     WHERE pa.asset_id = ?
     LIMIT 1 FOR UPDATE`,
    [assetId],
  );

  const membership = rows[0];
  if (!membership) return null;

  // Deduct only this kit from the pallet. Never delete the pallet row itself.
  await tx.query(
    `DELETE FROM inventory_pallet_assets WHERE id = ?`,
    [membership.membership_id],
  );

  await tx.query(
    `INSERT INTO inventory_pallet_membership_history
      (pallet_id, asset_id, action, performed_by, reason)
     VALUES (?, ?, 'REMOVE', ?, ?)`,
    [membership.pallet_id, assetId, userId, reason],
  );

  // Touch the pallet version for live-list refresh only. Its status, project, location,
  // custody and pallet code deliberately remain unchanged.
  await tx.query(
    `UPDATE inventory_pallets
     SET version = version + 1,
         updated_by = ?,
         updated_at = CURRENT_TIMESTAMP
     WHERE id = ?`,
    [userId, membership.pallet_id],
  );

  const [countRows] = await tx.query(
    `SELECT COUNT(*) AS item_count
     FROM inventory_pallet_assets
     WHERE pallet_id = ?`,
    [membership.pallet_id],
  );

  const remainingKitCount = Number(countRows[0]?.item_count || 0);

  return {
    palletId: membership.pallet_id,
    palletCode: membership.pallet_code,
    palletStatus: membership.pallet_status,
    projectId: membership.project_id,
    palletLocationId: membership.current_location_id,
    palletCustody: membership.current_custody,
    itemCount: remainingKitCount,
    remainingKitCount,
    palletPreserved: true,
  };
}

export async function detachAssetsFromPallets(tx, assets, userId, reason = "Kits moved separately") {
  const detached = [];
  for (const asset of assets || []) {
    const result = await detachAssetFromPallet(tx, asset.id, userId, reason);
    if (result) detached.push({ assetId: asset.id, ...result });
  }
  return detached;
}
