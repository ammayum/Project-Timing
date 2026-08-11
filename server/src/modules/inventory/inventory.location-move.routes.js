import { Router } from "express";
import { z } from "zod";
import { requireAuth } from "../../middleware/auth.js";
import { validate } from "../../middleware/validate.js";
import { requireInventoryView } from "./inventory.permissions.js";
import { inventoryLocationMoveService } from "./inventory.location-move.service.js";

const router = Router();
const idSchema = z.coerce.number().int().positive();

function requestContext(req) {
  return {
    correlationId: req.headers["x-correlation-id"] || undefined,
    ipAddress: req.ip,
    userAgent: req.headers["user-agent"] || null,
  };
}

router.use(requireAuth);

router.get("/location-moves/meta", requireInventoryView, async (req, res, next) => {
  try {
    res.json(await inventoryLocationMoveService.meta(req.user));
  } catch (error) {
    next(error);
  }
});

router.post(
  "/location-moves",
  requireInventoryView,
  validate(
    z.object({
      body: z.object({
        identifier: z.string().trim().min(1).max(255),
        toLocationId: idSchema,
        reason: z.string().trim().min(3).max(1000),
        reference: z.string().trim().max(255).optional(),
      }),
    }),
  ),
  async (req, res, next) => {
    try {
      res.json(
        await inventoryLocationMoveService.moveKit(
          req.validated.body,
          req.user,
          requestContext(req),
        ),
      );
    } catch (error) {
      next(error);
    }
  },
);

router.post(
  "/engineering-locations",
  requireInventoryView,
  validate(
    z.object({
      body: z.object({
        warehouseId: idSchema,
        employeeId: idSchema,
        locationCode: z.string().trim().min(2).max(120),
        description: z.string().trim().max(500).optional(),
        storeNumber: z.string().trim().max(50).optional(),
        aisle: z.string().trim().max(50).optional(),
        shelf: z.string().trim().max(50).optional(),
        bin: z.string().trim().max(50).optional(),
      }),
    }),
  ),
  async (req, res, next) => {
    try {
      res.status(201).json({
        location: await inventoryLocationMoveService.createEngineeringLocation(
          req.validated.body,
          req.user,
          requestContext(req),
        ),
      });
    } catch (error) {
      next(error);
    }
  },
);

router.post(
  "/engineering-locations/:id/assign",
  requireInventoryView,
  validate(
    z.object({
      params: z.object({ id: idSchema }),
      body: z.object({ employeeId: idSchema.nullable().optional() }),
    }),
  ),
  async (req, res, next) => {
    try {
      res.json({
        location: await inventoryLocationMoveService.assignEngineeringLocation(
          req.validated.params.id,
          req.validated.body,
          req.user,
          requestContext(req),
        ),
      });
    } catch (error) {
      next(error);
    }
  },
);

export const inventoryLocationMoveRoutes = router;
