import bcrypt from "bcrypt";
import crypto from "node:crypto";
import { employeeRepository } from "../repositories/employee.repository.js";
import { passwordSecurityRepository } from "../repositories/password-security.repository.js";
import { env } from "../config/env.js";
import { AppError } from "../lib/app-error.js";
import { hashSessionToken, sessionRepository } from "../repositories/session.repository.js";

const MINIMUM_PASSWORD_LENGTH = 12;
const PASSWORD_HISTORY_COUNT = 12;
const MINIMUM_PASSWORD_AGE_MS = 24 * 60 * 60 * 1000;

function createSessionToken() {
  return crypto.randomBytes(48).toString("base64url");
}

async function issueSession(employee) {
  const token = createSessionToken();

  await sessionRepository.create({
    employeeId: employee.id,
    tokenHash: hashSessionToken(token),
  });

  return token;
}

function buildAuthEmployee(employee) {
  const passwordExpired = passwordSecurityRepository.isExpired(employee);
  return {
    id: employee.id,
    sso_id: employee.sso_id,
    name: employee.name,
    email: employee.email,
    ein: employee.ein,
    role: employee.role,
    is_admin: employee.is_admin,
    team_id: employee.team_id ?? null,
    team_name: employee.team_name ?? null,
    working_hours_per_day: Number(employee.working_hours_per_day ?? 7.5),
    mustChangePassword: Boolean(employee.must_change_password || passwordExpired),
    passwordExpiresAt: employee.password_expires_at ?? null,
    passwordPolicy: passwordSecurityRepository.policy(),
  };
}

async function validateNewPassword(employee, newPassword) {
  if (newPassword.length < MINIMUM_PASSWORD_LENGTH) {
    throw new AppError(400, `Password must be at least ${MINIMUM_PASSWORD_LENGTH} characters`);
  }

  if (!employee.must_change_password && passwordSecurityRepository.passwordAgeMs(employee) < MINIMUM_PASSWORD_AGE_MS) {
    throw new AppError(400, "Password cannot be changed again until the minimum password age of 1 day has passed");
  }

  const recentHashes = await passwordSecurityRepository.recentPasswordHashes(employee.id, PASSWORD_HISTORY_COUNT);
  if (employee.password_hash && !recentHashes.includes(employee.password_hash)) {
    recentHashes.unshift(employee.password_hash);
  }

  for (const previousHash of recentHashes.slice(0, PASSWORD_HISTORY_COUNT)) {
    if (await bcrypt.compare(newPassword, previousHash)) {
      throw new AppError(400, "New password must not match any of your previous 12 passwords");
    }
  }
}

export const authService = {
  async loginWithCredentials(identity, password) {
    let employee = await employeeRepository.findByIdentity(identity);

    if (!employee || !employee.password_hash || employee.active === false || employee.active === 0) {
      throw new AppError(401, "Invalid username or password");
    }

    if (passwordSecurityRepository.isLocked(employee)) {
      throw new AppError(423, "Account is temporarily locked due to repeated failed login attempts");
    }

    const passwordValid = await bcrypt.compare(password, employee.password_hash);

    if (!passwordValid) {
      await passwordSecurityRepository.recordFailedLogin(employee.id);
      throw new AppError(401, "Invalid username or password");
    }

    await passwordSecurityRepository.initializeExistingPassword(employee.id, employee.password_hash, {
      mustChangePassword: Boolean(employee.must_change_password),
    });
    await passwordSecurityRepository.recordSuccessfulLogin(employee.id);
    employee = await employeeRepository.findById(employee.id);

    if (passwordSecurityRepository.isExpired(employee) && !employee.must_change_password) {
      await passwordSecurityRepository.markPasswordChangeRequired(employee.id);
      employee = await employeeRepository.findById(employee.id);
    }

    const token = await issueSession(employee);

    return {
      token,
      employee: buildAuthEmployee(employee),
    };
  },

  async loginWithMicrosoftProfile(profile) {
    const employee = await employeeRepository.upsertFromSso({
      ssoId: profile.oid,
      name: profile.name,
      email: profile.email,
      ein: profile.ein,
    });

    const token = await issueSession(employee);

    return {
      token,
      employee: buildAuthEmployee(employee),
    };
  },

  async listDevUsers() {
    try {
      const employees = await employeeRepository.listAll();

      return employees.map((emp) => ({
        key: emp.sso_id || String(emp.id),
        name: emp.name,
        email: emp.email,
        ein: emp.ein,
        role: emp.role || "employee",
        roleLabel:
          emp.roleLabel ||
          (emp.is_admin ? "Administrator" : emp.role === "manager" ? "Project Manager" : "Engineer"),
        isAdmin: Boolean(emp.is_admin),
        overtimeAllowed: Boolean(emp.overtime_allowed),
      }));
    } catch (error) {
      console.error("Error in listDevUsers:", error.message);
      return [];
    }
  },

  async loginWithDevUserKey(key) {
    const ssoMap = {
      admin: "dev-admin-user",
      manager: "dev-manager-user",
      engineer: "dev-engineer-user",
    };

    const ssoId = ssoMap[key] || key;
    const employee = await employeeRepository.findBySsoId(ssoId);

    if (!employee) {
      throw new AppError(404, `User "${key}" not found`);
    }

    return {
      token: await issueSession(employee),
      employee: buildAuthEmployee(employee),
    };
  },

  async loginWithDevBypass() {
    if (env.devAuthDefaultUserKey) {
      try {
        return await this.loginWithDevUserKey(env.devAuthDefaultUserKey);
      } catch (error) {
        if (!(error instanceof AppError) || error.statusCode !== 404) {
          throw error;
        }
      }
    }

    const allUsers = await employeeRepository.listAll();
    const employee = allUsers[0];

    if (!employee) {
      throw new AppError(404, "No users found");
    }

    return {
      token: await issueSession(employee),
      employee: buildAuthEmployee(employee),
    };
  },

  async setPasswordForIdentity(identity, password) {
    const employee = await employeeRepository.findByIdentity(identity);

    if (!employee) {
      throw new AppError(404, "User not found");
    }
    if (password.length < MINIMUM_PASSWORD_LENGTH) {
      throw new AppError(400, `Password must be at least ${MINIMUM_PASSWORD_LENGTH} characters`);
    }

    const passwordHash = await bcrypt.hash(password, 12);
    await passwordSecurityRepository.setPassword(employee.id, passwordHash, { mustChangePassword: false });
    const updated = await employeeRepository.findById(employee.id);

    return {
      employee: buildAuthEmployee(updated),
    };
  },

  async changePassword(employeeId, currentPassword, newPassword, currentSessionId = null) {
    const employee = await employeeRepository.findById(employeeId);

    if (!employee) {
      throw new AppError(404, "User not found");
    }

    if (!employee.password_hash) {
      throw new AppError(400, "Password not configured for this account");
    }

    const passwordValid = await bcrypt.compare(currentPassword, employee.password_hash);

    if (!passwordValid) {
      throw new AppError(401, "Current password is incorrect");
    }

    await passwordSecurityRepository.initializeExistingPassword(employee.id, employee.password_hash, {
      mustChangePassword: Boolean(employee.must_change_password),
    });
    const refreshedEmployee = await employeeRepository.findById(employee.id);
    await validateNewPassword(refreshedEmployee, newPassword);

    const passwordHash = await bcrypt.hash(newPassword, 12);
    await passwordSecurityRepository.setPassword(employee.id, passwordHash, { mustChangePassword: false });
    await sessionRepository.revokeOtherSessions(employee.id, currentSessionId, "password_changed");
    const updated = await employeeRepository.findById(employee.id);

    return {
      employee: buildAuthEmployee(updated),
    };
  },

  async findSessionByToken(token) {
    return sessionRepository.findByTokenHash(hashSessionToken(token));
  },

  async revokeSession(sessionId, reason = "signout") {
    await sessionRepository.revoke(sessionId, reason);
  },
};
