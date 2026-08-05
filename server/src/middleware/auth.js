import { env } from "../config/env.js";
import { AppError } from "../lib/app-error.js";
import { employeeRepository } from "../repositories/employee.repository.js";
import { sessionRepository } from "../repositories/session.repository.js";
import { authService } from "../services/auth.service.js";

const SESSION_IDLE_TIMEOUT_MS = env.sessionIdleTimeoutMinutes * 60 * 1000;

function getBearerToken(header) {
  if (!header?.startsWith("Bearer ")) {
    return null;
  }

  return header.slice("Bearer ".length).trim();
}

export async function requireAuth(req, _res, next) {
  try {
    if (env.devAuthBypass) {
      const header = req.headers.authorization;
      if (!header) {
        const session = await authService.loginWithDevBypass();
        req.user = session.employee;
        return next();
      }
    }

    const token = getBearerToken(req.headers.authorization);
    if (!token) {
      throw new AppError(401, "Missing authorization token");
    }

    const session = await authService.findSessionByToken(token);
    if (!session || session.revoked_at) {
      throw new AppError(401, "Session not found");
    }

    const lastActivityAt = new Date(session.last_activity_at).getTime();
    if (!Number.isFinite(lastActivityAt)) {
      await authService.revokeSession(session.id, "invalid_activity_timestamp");
      throw new AppError(401, "Session expired");
    }

    if (Date.now() - lastActivityAt > SESSION_IDLE_TIMEOUT_MS) {
      await authService.revokeSession(session.id, "idle_timeout");
      throw new AppError(401, "Session expired due to inactivity");
    }

    const employee = await employeeRepository.findById(session.employee_id);
    if (!employee) {
      await authService.revokeSession(session.id, "user_missing");
      throw new AppError(401, "User not found");
    }

    const isPasswordChangeRequest = req.path === "/change-password";
    const isLogoutRequest = req.path === "/logout";
    if (employee.must_change_password && !isPasswordChangeRequest && !isLogoutRequest) {
      throw new AppError(403, "Password change required");
    }

    await sessionRepository.touchActivity(session.id);

    req.user = employee;
    req.authSession = session;
    next();
  } catch (error) {
    next(error instanceof AppError ? error : new AppError(401, "Invalid authorization token"));
  }
}

export function requireAdmin(req, _res, next) {
  if (!req.user?.is_admin) {
    return next(new AppError(403, "Admin access required"));
  }

  return next();
}

export function requireManagerOrAdmin(req, _res, next) {
  if (req.user?.is_admin || req.user?.role === "manager") {
    return next();
  }

  return next(new AppError(403, "Manager or admin access required"));
}
