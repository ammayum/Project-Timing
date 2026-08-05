import { getRuntimeState } from "../config/db.js";
import { AppError } from "../lib/app-error.js";

const WRITE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

function getCandidatePaths(req) {
  return [
    req.originalUrl,
    req.url,
    req.path,
    `${req.baseUrl || ""}${req.path || ""}`,
  ]
    .map((value) => String(value || ""))
    .filter(Boolean);
}

// Maintenance mode uses a file-backed runtime state; route exemptions keep recovery paths available.
function isMaintenanceExempt(req) {
  const paths = getCandidatePaths(req);

  return paths.some((requestPath) => {
    if (requestPath.includes("/auth/login") || requestPath.includes("/auth/dev-login")) {
      return true;
    }

    if (requestPath.includes("/admin/database-runtime")) {
      return true;
    }

    if (requestPath.includes("/admin/mysql/init") || requestPath.includes("/admin/postgres/init")) {
      return true;
    }

    return false;
  });
}

export async function maintenanceGuard(req, _res, next) {
  try {
    if (!WRITE_METHODS.has(req.method) || isMaintenanceExempt(req)) {
      return next();
    }

    const runtime = await getRuntimeState();
    if (!runtime.writeEnabled) {
      return next(new AppError(503, "System is in maintenance mode. Writes are temporarily disabled."));
    }

    return next();
  } catch (error) {
    return next(error);
  }
}
