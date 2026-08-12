import { Router } from "express";
import { z } from "zod";
import { requireAuth } from "../../middleware/auth.js";
import { validate } from "../../middleware/validate.js";
import { requireInventoryView, requireStoresInventory } from "./inventory.permissions.js";
import { inventoryPalletService } from "./inventory.pallet.service.js";

const router = Router();
const idSchema = z.coerce.number().int().positive();
const identifiersSchema = z.array(z.string().trim().min(1)).min(1).max(500);
const optionalText = z.string().trim().max(1000).optional().nullable();

function requestContext(req) {
  return {
    correlationId: req.headers["x-correlation-id"] || undefined,
    ipAddress: req.ip,
    userAgent: req.headers["user-agent"] || null,
  };
}

router.use(requireAuth);

router.get("/pallets/meta", requireInventoryView, async (req, res, next) => {
  try {
    res.json(await inventoryPalletService.meta(req.user));
  } catch (error) {
    next(error);
  }
});

router.get(
  "/pallets",
  requireInventoryView,
  validate(z.object({ query: z.object({
    q: z.string().trim().max(120).default(""),
    limit: z.coerce.number().int().min(1).max(250).default(100),
  }) })),
  async (req, res, next) => {
    try {
      res.json({ pallets: await inventoryPalletService.list(req.validated.query) });
    } catch (error) {
      next(error);
    }
  },
);

router.get(
  "/pallets/:id",
  requireInventoryView,
  validate(z.object({ params: z.object({ id: idSchema }) })),
  async (req, res, next) => {
    try {
      res.json(await inventoryPalletService.get(req.validated.params.id));
    } catch (error) {
      next(error);
    }
  },
);

router.post(
  "/pallets",
  requireStoresInventory,
  validate(z.object({ body: z.object({
    projectId: idSchema,
    locationId: idSchema,
    description: z.string().trim().max(500).optional(),
    identifiers: z.array(z.string().trim().min(1)).max(500).default([]),
    reason: optionalText,
  }) })),
  async (req, res, next) => {
    try {
      res.status(201).json(await inventoryPalletService.create(req.validated.body, req.user, requestContext(req)));
    } catch (error) {
      next(error);
    }
  },
);

router.post(
  "/pallets/:id/items",
  requireStoresInventory,
  validate(z.object({
    params: z.object({ id: idSchema }),
    body: z.object({ identifiers: identifiersSchema, reason: optionalText }),
  })),
  async (req, res, next) => {
    try {
      res.json(await inventoryPalletService.addItems(req.validated.params.id, req.validated.body, req.user, requestContext(req)));
    } catch (error) {
      next(error);
    }
  },
);

router.post(
  "/pallets/:id/items/remove",
  requireStoresInventory,
  validate(z.object({
    params: z.object({ id: idSchema }),
    body: z.object({ identifiers: identifiersSchema, reason: optionalText }),
  })),
  async (req, res, next) => {
    try {
      res.json(await inventoryPalletService.removeItems(req.validated.params.id, req.validated.body, req.user, requestContext(req)));
    } catch (error) {
      next(error);
    }
  },
);

router.post(
  "/pallets/:id/status",
  requireStoresInventory,
  validate(z.object({
    params: z.object({ id: idSchema }),
    body: z.object({ status: z.enum(["OPEN", "SEALED", "CLOSED"]) }),
  })),
  async (req, res, next) => {
    try {
      res.json(await inventoryPalletService.setStatus(req.validated.params.id, req.validated.body, req.user, requestContext(req)));
    } catch (error) {
      next(error);
    }
  },
);

router.post(
  "/pallets/:id/move",
  requireInventoryView,
  validate(z.object({
    params: z.object({ id: idSchema }),
    body: z.object({
      toLocationId: idSchema,
      reference: z.string().trim().max(255).optional(),
      reason: z.string().trim().min(2).max(1000),
    }),
  })),
  async (req, res, next) => {
    try {
      res.json(await inventoryPalletService.move(req.validated.params.id, req.validated.body, req.user, requestContext(req)));
    } catch (error) {
      next(error);
    }
  },
);

export const inventoryPalletRoutes = router;
