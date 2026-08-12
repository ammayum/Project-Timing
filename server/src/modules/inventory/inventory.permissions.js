import { AppError } from "../../lib/app-error.js";

function normalizeTeamName(user) {
  return String(user?.team_name || "").trim().toLowerCase();
}

export function getInventoryAccess(user) {
  const teamName = normalizeTeamName(user);
  const isAdmin = Boolean(user?.is_admin) || user?.role === "admin";
  const isManager = user?.role === "manager";
  const isStores = isAdmin || teamName.includes("store") || teamName.includes("warehouse");
  const isEngineering = isAdmin || teamName.includes("engineer");

  return {
    isAdmin,
    isManager,
    isStores,
    isEngineering,
    canView: isAdmin || isManager || isStores || isEngineering,
    canManageStock: isAdmin || isStores,
    canReceiveEngineeringHandover: isAdmin || isEngineering,
    canCreateEngineeringReturn: isAdmin || isEngineering,
    canAcceptEngineeringReturn: isAdmin || isStores,
    canViewAudit: isAdmin || isManager || isStores,
  };
}

export function requireInventoryView(req, _res, next) {
  if (!getInventoryAccess(req.user).canView) {
    return next(new AppError(403, "Inventory access required"));
  }
  return next();
}

export function requireStoresInventory(req, _res, next) {
  if (!getInventoryAccess(req.user).canManageStock) {
    return next(new AppError(403, "Stores inventory access required"));
  }
  return next();
}

export function requireInventoryAudit(req, _res, next) {
  if (!getInventoryAccess(req.user).canViewAudit) {
    return next(new AppError(403, "Inventory audit access required"));
  }
  return next();
}
