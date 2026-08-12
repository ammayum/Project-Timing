export async function detachAssetFromPallet(tx, assetId, userId, reason = "Kit moved separately") {
  const [rows] = await tx.query(
    `SELECT pa.id AS membership_id, pa.pallet_id, p.pallet_code
     FROM inventory_pallet_assets pa
     INNER JOIN inventory_pallets p ON p.id = pa.pallet_id
     WHERE pa.asset_id = ?
     LIMIT 1 FOR UPDATE`,
    [assetId],
  );

  const membership = rows[0];
  if (!membership) return null;

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

  return {
    palletId: membership.pallet_id,
    palletCode: membership.pallet_code,
    itemCount: Number(countRows[0]?.item_count || 0),
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
