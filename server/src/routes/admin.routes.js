import { Router } from "express";
import { z } from "zod";
import { requireAdmin, requireAuth, requireManagerOrAdmin } from "../middleware/auth.js";
import { AppError } from "../lib/app-error.js";
import { adminService } from "../services/admin.service.js";
import { validate } from "../middleware/validate.js";

const router = Router();

const nullableTeamIdSchema = z.preprocess((value) => {
  if (value === "" || value === undefined || value === null) {
    return null;
  }

  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) {
      return null;
    }
    return Number(trimmed);
  }

  return value;
}, z.number().int().positive().nullable());

const optionalEinSchema = z.preprocess((value) => {
  if (value === undefined || value === null) {
    return null;
  }

  const normalized = String(value).trim();
  return normalized === "" ? null : normalized;
}, z.string().nullable());

const booleanLikeSchema = z.preprocess((value) => {
  if (typeof value === "boolean") {
    return value;
  }

  if (typeof value === "number") {
    return value === 1;
  }

  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();

    if (normalized === "true" || normalized === "1") {
      return true;
    }

    if (normalized === "false" || normalized === "0" || normalized === "") {
      return false;
    }
  }

  return value;
}, z.boolean());

router.get("/projects-with-kits", requireAuth, requireManagerOrAdmin, async (req, res, next) => {
  try {
    res.json({ projects: await adminService.projectKitIndex(req.user) });
  } catch (error) {
    next(error);
  }
});

router.get(
  "/performance",
  requireAuth,
  requireManagerOrAdmin,
  validate(
    z.object({
      query: z.object({
        start_date: z.string().optional(),
        end_date: z.string().optional(),
      }),
    }),
  ),
  async (req, res, next) => {
    try {
      res.json(
        await adminService.employeePerformance({
          startDate: req.validated.query.start_date,
          endDate: req.validated.query.end_date,
        }),
      );
    } catch (error) {
      next(error);
    }
  },
);

router.use(requireAuth, requireAdmin);

router.get("/database-runtime", async (_req, res, next) => {
  try {
    res.json(await adminService.runtimeStatus());
  } catch (error) {
    next(error);
  }
});

router.get("/database-runtime/health", async (_req, res, next) => {
  try {
    res.json((await adminService.runtimeStatus()).health);
  } catch (error) {
    next(error);
  }
});

router.post(
  "/database-runtime/mode",
  validate(
    z.object({
      body: z.object({
        mode: z.enum(["mysql_primary", "postgres_primary", "mysql_only", "postgres_only", "maintenance"]),
        note: z.string().optional(),
      }),
    }),
  ),
  async (req, res, next) => {
    try {
      const runtime = await adminService.switchRuntimeMode({
        mode: req.validated.body.mode,
        note: req.validated.body.note,
        changedByEmployeeId: req.user.id,
      });
      res.json({ runtime });
    } catch (error) {
      next(error);
    }
  },
);

router.post(
  "/database-runtime/engines/:engine",
  validate(
    z.object({
      params: z.object({
        engine: z.enum(["mysql", "postgres"]),
      }),
      body: z.object({
        enabled: z.boolean(),
        note: z.string().optional(),
      }),
    }),
  ),
  async (req, res, next) => {
    try {
      const runtime = await adminService.setDatabaseEnabled({
        engine: req.validated.params.engine,
        enabled: req.validated.body.enabled,
        note: req.validated.body.note,
        changedByEmployeeId: req.user.id,
      });
      res.json({ runtime });
    } catch (error) {
      next(error);
    }
  },
);

router.post(
  "/users",
  validate(
    z.object({
      body: z.object({
        sso_id: z.string().trim().min(1, "SSO ID / Username is required"),
        name: z.string().min(1),
        email: z.string().email(),
        ein: optionalEinSchema,
        role: z.enum(["employee", "manager", "admin"]),
        overtime_allowed: booleanLikeSchema,
        working_hours_per_day: z.coerce.number().min(0.25).max(24).default(7.5),
        is_admin: booleanLikeSchema,
        team_id: nullableTeamIdSchema.optional(),
        set_default_password: z.boolean().default(true),
      }),
    }),
  ),
  async (req, res, next) => {
    try {
      const result = await adminService.upsertUser(req.validated.body);
      res.status(201).json(result);
    } catch (error) {
      next(error);
    }
  },
);

router.post(
  "/teams",
  validate(
    z.object({
      body: z.object({
        id: z.coerce.number().optional(),
        name: z.string().min(1),
        description: z.string().optional(),
      }),
    }),
  ),
  async (req, res, next) => {
    try {
      const team = await adminService.upsertTeam(req.validated.body);
      res.status(201).json({ team });
    } catch (error) {
      next(error);
    }
  },
);

router.post(
  "/users/:id/reset-password",
  validate(
    z.object({
      params: z.object({
        id: z.coerce.number(),
      }),
    }),
  ),
  async (req, res, next) => {
    try {
      const result = await adminService.resetUserPassword(req.validated.params.id);
      res.json(result);
    } catch (error) {
      next(
        error.message === "User not found"
          ? new AppError(404, error.message)
          : error,
      );
    }
  },
);

router.get("/db", async (_req, res, next) => {
  try {
    res.json(await adminService.databaseDetails());
  } catch (error) {
    next(error);
  }
});

router.get("/mysql", async (_req, res, next) => {
  try {
    res.json(await adminService.mysqlStatus());
  } catch (error) {
    next(error);
  }
});

router.get("/postgres", async (_req, res, next) => {
  try {
    res.json(await adminService.postgresStatus());
  } catch (error) {
    next(error);
  }
});

router.post("/mysql/init", async (_req, res, next) => {
  try {
    res.json(await adminService.initializeMysql());
  } catch (error) {
    next(error);
  }
});

router.post("/postgres/init", async (_req, res, next) => {
  try {
    res.json(await adminService.initializePostgres());
  } catch (error) {
    next(error);
  }
});

router.get("/sync/status", async (_req, res, next) => {
  try {
    res.json(await adminService.syncStatus());
  } catch (error) {
    next(error);
  }
});

router.get("/sync/sharepoint-preview", async (_req, res, next) => {
  try {
    res.json(await adminService.previewSharePointSync());
  } catch (error) {
    next(error);
  }
});

router.get("/sharepoint/files", async (_req, res, next) => {
  try {
    res.json(await adminService.listSharePointFiles());
  } catch (error) {
    next(error);
  }
});

router.get("/", async (_req, res, next) => {
  try {
    res.json(await adminService.dashboardData());
  } catch (error) {
    next(error);
  }
});

router.put(
  "/employees/:id",
  validate(
    z.object({
      params: z.object({ id: z.coerce.number() }),
      body: z.object({
        name: z.string(),
        email: z.string().email(),
        ein: optionalEinSchema,
        role: z.enum(["employee", "manager", "admin"]),
        overtime_allowed: booleanLikeSchema,
        working_hours_per_day: z.coerce.number().min(0.25).max(24).default(7.5),
        is_admin: booleanLikeSchema,
        team_id: nullableTeamIdSchema.optional(),
      }),
    }),
  ),
  async (req, res, next) => {
    try {
      const employee = await adminService.updateEmployee(req.validated.params.id, req.validated.body);
      res.json({ employee });
    } catch (error) {
      next(error);
    }
  },
);

router.post(
  "/projects",
  validate(
    z.object({
      body: z.object({
        id: z.coerce.number().optional(),
        ja_code: z.string(),
        project_name: z.string().min(1),
        fd_ref: z.string().min(1),
        suffix: z.string().default(""),
        status: z.enum(["active", "inactive"]).default("active"),
        team_ids: z.array(z.coerce.number()).default([]),
        manager_ids: z.array(z.coerce.number()).default([]),
      }).superRefine((body, ctx) => {
        if (!body.id && !body.ja_code.trim()) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["ja_code"],
            message: "JA code is required for new projects.",
          });
        }
      }),
    }),
  ),
  async (req, res, next) => {
    try {
      const project = await adminService.upsertProject(req.validated.body);
      res.status(201).json({ project });
    } catch (error) {
      next(error);
    }
  },
);

router.post(
  "/kits",
  validate(
    z.object({
      body: z.object({
        id: z.coerce.number().optional(),
        project_ja_code: z.string().nullable().default(null),
        part_code: z.string().default(""),
        serial_number: z.string().default(""),
        device_type: z.string().default(""),
        brand: z.string().default(""),
        model: z.string().default(""),
      }),
    }),
  ),
  async (req, res, next) => {
    try {
      const kit = await adminService.upsertKit(req.validated.body);
      res.status(201).json({ kit });
    } catch (error) {
      next(error);
    }
  },
);

router.post(
  "/kits/upload",
  validate(
    z.object({
      body: z.object({
        csvContent: z.string().min(1),
      }),
    }),
  ),
  async (req, res, next) => {
    try {
      res.status(201).json(await adminService.importKitsCsv(req.validated.body.csvContent));
    } catch (error) {
      next(error);
    }
  },
);

router.post(
  "/sync-toggle",
  validate(
    z.object({
      body: z.object({
        enabled: z.boolean(),
      }),
    }),
  ),
  async (req, res, next) => {
    try {
      const setting = await adminService.setSyncEnabled(req.validated.body.enabled);
      res.json({ setting });
    } catch (error) {
      next(error);
    }
  },
);

export const adminRoutes = router;
