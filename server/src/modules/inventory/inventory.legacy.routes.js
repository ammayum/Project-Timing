import { Router } from "express";
import { z } from "zod";
import { requireAuth } from "../../middleware/auth.js";
import { validate } from "../../middleware/validate.js";
import { requireStoresInventory } from "./inventory.permissions.js";
import { inventoryLegacyMigration } from "./inventory.legacy-migration.js";

const router = Router();

router.post(
  "/legacy/migrate",
  requireAuth,
  requireStoresInventory,
  validate(z.object({ body: z.object({ defaultLocationId: z.coerce.number().int().positive() }) })),
  async (req, res, next) => {
    try {
      const result = await inventoryLegacyMigration.migrate(
        req.validated.body,
        req.user,
        {
          correlationId: req.headers["x-correlation-id"] || undefined,
          ipAddress: req.ip,
          userAgent: req.headers["user-agent"] || null,
        },
      );
      res.json(result);
    } catch (error) {
      next(error);
    }
  },
);

export const inventoryLegacyRoutes = router;
