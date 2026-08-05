import bcrypt from "bcrypt";
import crypto from "node:crypto";
import { employeeRepository } from "../repositories/employee.repository.js";
import { env } from "../config/env.js";
import { AppError } from "../lib/app-error.js";
import { hashSessionToken, sessionRepository } from "../repositories/session.repository.js";

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
    mustChangePassword: Boolean(employee.must_change_password),
  };
}

export const authService = {
  async loginWithCredentials(identity, password) {
    const employee = await employeeRepository.findByIdentity(identity);

    if (!employee) {
      throw new AppError(401, "Invalid username or password");
    }

    if (!employee.password_hash) {
      throw new AppError(401, "Invalid username or password");
    }

    const passwordValid = await bcrypt.compare(password, employee.password_hash);

    if (!passwordValid) {
      throw new AppError(401, "Invalid username or password");
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

    const passwordHash = await bcrypt.hash(password, 12);
    const updated = await employeeRepository.updatePasswordState(employee.id, {
      password_hash: passwordHash,
      must_change_password: false,
    });

    return {
      employee: buildAuthEmployee(updated),
    };
  },

  async changePassword(employeeId, currentPassword, newPassword) {
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

    const passwordHash = await bcrypt.hash(newPassword, 12);
    const updated = await employeeRepository.updatePasswordState(employee.id, {
      password_hash: passwordHash,
      must_change_password: false,
    });

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
