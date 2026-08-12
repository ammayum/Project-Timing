import { Router } from "express";
import { z } from "zod";
import { requireAuth } from "../../middleware/auth.js";
import { validate } from "../../middleware/validate.js";
import { inventoryService } from "./inventory.service.js";
import { inventoryLocationMoveService } from "./inventory.location-move.service.js";
import { requireInventoryAudit, requireInventoryView, requireStoresInventory } from "./inventory.permissions.js";

const router = Router();

const idSchema = z.coerce.number().int().positive();
const optionalText = z.string().trim().max(1000).optional().nullable();
const identifiersSchema = z.array(z.string().trim().min(1)).min(1).max(250);
const stockStatusSchema = z.enum([
  "AVAILABLE", "RESERVED", "PICKED", "READY_FOR_HANDOVER", "WITH_ENGINEERING",
  "RETURN_PENDING", "RETURNED", "READY_TO_PACK", "PACKED", "READY_TO_SHIP",
  "DISPATCHED", "IN_TRANSIT", "DELIVERED", "QUARANTINE", "DAMAGED", "LOST", "RETIRED",
]);

function requestContext(req) {
  return {
    correlationId: req.headers["x-correlation-id"] || undefined,
    ipAddress: req.ip,
    userAgent: req.headers["user-agent"] || null,
  };
}

router.use(requireAuth);

router.get("/meta", requireInventoryView, async (req, res, next) => {
  try {
    res.json(await inventoryService.meta(req.user));
  } catch (error) { next(error); }
});

router.get("/dashboard", requireInventoryView, async (_req, res, next) => {
  try { res.json(await inventoryService.dashboard()); } catch (error) { next(error); }
});

router.get(
  "/search",
  requireInventoryView,
  validate(z.object({ query: z.object({ q: z.string().trim().min(1), limit: z.coerce.number().int().min(1).max(100).default(25) }) })),
  async (req, res, next) => {
    try { res.json({ results: await inventoryService.search(req.validated.query.q, req.validated.query.limit) }); }
    catch (error) { next(error); }
  },
);

router.get(
  "/assets",
  requireInventoryView,
  validate(z.object({ query: z.object({
    page: z.coerce.number().int().positive().default(1),
    limit: z.coerce.number().int().min(1).max(100).default(50),
    status: z.string().optional(), custody: z.string().optional(), projectId: z.coerce.number().int().positive().optional(), q: z.string().optional(),
  }) })),
  async (req, res, next) => {
    try { res.json(await inventoryService.listAssets(req.validated.query)); } catch (error) { next(error); }
  },
);

router.get("/assets/:id", requireInventoryView, validate(z.object({ params: z.object({ id: idSchema }) })), async (req, res, next) => {
  try { res.json(await inventoryService.getAsset(req.validated.params.id)); } catch (error) { next(error); }
});

router.post(
  "/assets",
  requireStoresInventory,
  validate(z.object({ body: z.object({
    serialNumber: z.string().trim().min(1).max(255),
    inventoryPartId: idSchema,
    projectId: idSchema,
    locationId: idSchema,
    conditionStatus: z.string().trim().min(1).max(50).default("GOOD"),
    reference: z.string().trim().max(255).optional(),
    reason: optionalText,
  }) })),
  async (req, res, next) => {
    try { res.status(201).json(await inventoryService.createSerializedAsset(req.validated.body, req.user, requestContext(req))); }
    catch (error) { next(error); }
  },
);

router.post(
  "/assets/:id/reassign",
  requireStoresInventory,
  validate(z.object({ params: z.object({ id: idSchema }), body: z.object({ projectId: idSchema, reason: z.string().trim().min(1).max(1000), reference: z.string().trim().max(255).optional() }) })),
  async (req, res, next) => {
    try { res.json(await inventoryService.reassignAsset(req.validated.params.id, req.validated.body, req.user, requestContext(req))); }
    catch (error) { next(error); }
  },
);

router.post(
  "/movements",
  requireStoresInventory,
  validate(z.object({ body: z.object({
    identifier: z.string().trim().min(1), toLocationId: idSchema, stockStatus: stockStatusSchema.optional(),
    reference: z.string().trim().max(255).optional(), reason: z.string().trim().min(1).max(1000),
  }) })),
  async (req, res, next) => {
    try {
      const payload = { ...req.validated.body };
      delete payload.stockStatus;
      res.json(await inventoryLocationMoveService.moveKit(payload, req.user, requestContext(req)));
    } catch (error) { next(error); }
  },
);

router.post(
  "/stock/adjust",
  requireStoresInventory,
  validate(z.object({ body: z.object({
    inventoryPartId: idSchema, locationId: idSchema, quantityDelta: z.coerce.number().refine((value) => value !== 0),
    reason: z.string().trim().min(3).max(1000), reference: z.string().trim().max(255).optional(), approvedBy: idSchema.optional(),
  }) })),
  async (req, res, next) => {
    try { res.json(await inventoryService.adjustQuantityStock(req.validated.body, req.user, requestContext(req))); }
    catch (error) { next(error); }
  },
);

router.post(
  "/reservations",
  requireStoresInventory,
  validate(z.object({ body: z.object({
    projectId: idSchema,
    identifiers: z.array(z.string().trim().min(1)).max(250).default([]),
    quantityLines: z.array(z.object({ inventoryPartId: idSchema, locationId: idSchema, quantity: z.coerce.number().positive() })).max(250).default([]),
    notes: optionalText,
  }).refine((body) => body.identifiers.length > 0 || body.quantityLines.length > 0, "Reservation requires at least one item") })),
  async (req, res, next) => {
    try { res.status(201).json(await inventoryService.createReservation(req.validated.body, req.user, requestContext(req))); }
    catch (error) { next(error); }
  },
);

router.post(
  "/reservations/:id/pick",
  requireStoresInventory,
  validate(z.object({ params: z.object({ id: idSchema }) })),
  async (req, res, next) => {
    try { res.json(await inventoryService.pickReservation(req.validated.params.id, req.user, requestContext(req))); }
    catch (error) { next(error); }
  },
);

router.get("/handovers", requireInventoryView, async (req, res, next) => {
  try { res.json({ handovers: await inventoryService.listHandovers(req.query.limit) }); } catch (error) { next(error); }
});

router.post(
  "/handovers",
  requireInventoryView,
  validate(z.object({ body: z.object({
    direction: z.enum(["STORES_TO_ENGINEERING", "ENGINEERING_TO_STORES"]), projectId: idSchema,
    identifiers: identifiersSchema, fromLocationId: idSchema.optional(), toLocationId: idSchema.optional(), notes: optionalText,
  }) })),
  async (req, res, next) => {
    try { res.status(201).json(await inventoryService.createHandover(req.validated.body, req.user, requestContext(req))); }
    catch (error) { next(error); }
  },
);

router.post(
  "/handovers/:id/receive",
  requireInventoryView,
  validate(z.object({ params: z.object({ id: idSchema }), body: z.object({
    outcome: z.enum(["RETURNED", "AVAILABLE", "READY_TO_PACK", "QUARANTINE", "DAMAGED"]).optional(), notes: optionalText,
  }).default({}) })),
  async (req, res, next) => {
    try { res.json(await inventoryService.receiveHandover(req.validated.params.id, req.validated.body, req.user, requestContext(req))); }
    catch (error) { next(error); }
  },
);

router.get("/shipments", requireInventoryView, async (req, res, next) => {
  try { res.json({ shipments: await inventoryService.listShipments(req.query.limit) }); } catch (error) { next(error); }
});

router.post(
  "/shipments",
  requireStoresInventory,
  validate(z.object({ body: z.object({
    projectId: idSchema, identifiers: identifiersSchema,
    destinationName: z.string().trim().min(1).max(255), destinationContact: z.string().trim().max(255).optional(),
    destinationAddress: z.string().trim().min(3).max(4000), courierId: idSchema.optional(), courierService: z.string().trim().max(255).optional(),
    consignmentNumber: z.string().trim().max(255).optional(), trackingNumber: z.string().trim().max(255).optional(), packingLocationId: idSchema.optional(),
  }) })),
  async (req, res, next) => {
    try { res.status(201).json(await inventoryService.createShipment(req.validated.body, req.user, requestContext(req))); }
    catch (error) { next(error); }
  },
);

router.post("/shipments/:id/dispatch", requireStoresInventory, validate(z.object({ params: z.object({ id: idSchema }) })), async (req, res, next) => {
  try { res.json(await inventoryService.dispatchShipment(req.validated.params.id, req.user, requestContext(req))); }
  catch (error) { next(error); }
});

router.post(
  "/shipments/:id/tracking-events",
  requireStoresInventory,
  validate(z.object({ params: z.object({ id: idSchema }), body: z.object({
    courierStatus: z.string().trim().min(1).max(100), eventDescription: optionalText, eventLocation: z.string().trim().max(255).optional(),
    eventTimestamp: z.string().datetime(), externalReference: z.string().trim().max(255).optional(),
  }) })),
  async (req, res, next) => {
    try { res.status(201).json(await inventoryService.addTrackingEvent(req.validated.params.id, req.validated.body, req.user, requestContext(req))); }
    catch (error) { next(error); }
  },
);

router.get("/movements", requireInventoryView, async (req, res, next) => {
  try { res.json({ movements: await inventoryService.listMovements(req.query.limit) }); } catch (error) { next(error); }
});

router.get("/audit", requireInventoryAudit, async (req, res, next) => {
  try { res.json({ audit: await inventoryService.listAudit(req.query.limit) }); } catch (error) { next(error); }
});

router.post("/kit-types", requireStoresInventory, validate(z.object({ body: z.object({ code: z.string().regex(/^[A-Za-z0-9]{3}$/), name: z.string().trim().min(1), description: optionalText }) })), async (req, res, next) => {
  try { res.status(201).json({ kitType: await inventoryService.createKitType(req.validated.body, req.user) }); } catch (error) { next(error); }
});

router.post("/user-groups", requireStoresInventory, validate(z.object({ body: z.object({ name: z.string().trim().min(1).max(100), description: optionalText }) })), async (req, res, next) => {
  try { res.status(201).json({ userGroup: await inventoryService.createUserGroup(req.validated.body, req.user) }); } catch (error) { next(error); }
});

router.post("/parts", requireStoresInventory, validate(z.object({ body: z.object({
  manufacturerPartCode: z.string().trim().max(255).optional(), partDescription: z.string().trim().min(1).max(500), manufacturer: z.string().trim().max(255).optional(),
  model: z.string().trim().max(255).optional(), kitTypeId: idSchema, userGroupId: idSchema.optional(), serialized: z.boolean().default(true),
  stockType: z.string().trim().max(100).default("STANDARD"), unitOfMeasure: z.string().trim().max(50).default("EA"),
}) })), async (req, res, next) => {
  try { res.status(201).json({ part: await inventoryService.createPart(req.validated.body, req.user) }); } catch (error) { next(error); }
});

router.post("/warehouses", requireStoresInventory, validate(z.object({ body: z.object({ code: z.string().trim().min(2).max(20), name: z.string().trim().min(1).max(255), description: optionalText }) })), async (req, res, next) => {
  try { res.status(201).json({ warehouse: await inventoryService.createWarehouse(req.validated.body, req.user) }); } catch (error) { next(error); }
});

router.post("/locations", requireStoresInventory, validate(z.object({ body: z.object({
  warehouseId: idSchema, storeNumber: z.string().trim().max(50).optional(), aisle: z.string().trim().max(50).optional(), shelf: z.string().trim().max(50).optional(), bin: z.string().trim().max(50).optional(),
  locationCode: z.string().trim().min(2).max(120), description: optionalText,
  locationType: z.enum(["RECEIVING", "STORAGE", "PICKING", "ENGINEERING_HANDOVER", "ENGINEERING_CUSTODY", "RETURNS", "QUARANTINE", "PACKING", "DISPATCH"]).default("STORAGE"),
}) })), async (req, res, next) => {
  try { res.status(201).json({ location: await inventoryService.createLocation(req.validated.body, req.user) }); } catch (error) { next(error); }
});

router.post("/couriers", requireStoresInventory, validate(z.object({ body: z.object({
  courierName: z.string().trim().min(1).max(255), accountReference: z.string().trim().max(255).optional(), contactName: z.string().trim().max(255).optional(),
  contactPhone: z.string().trim().max(100).optional(), contactEmail: z.string().email().optional(), trackingUrlTemplate: z.string().url().optional(),
}) })), async (req, res, next) => {
  try { res.status(201).json({ courier: await inventoryService.createCourier(req.validated.body, req.user) }); } catch (error) { next(error); }
});

export const inventoryRoutes = router;
