import { Router } from "express";
import { z } from "zod";
import { requireAuth, requireManagerOrAdmin } from "../middleware/auth.js";
import { validate } from "../middleware/validate.js";
import { kitService } from "../services/kit.service.js";
import { kitRepository } from "../repositories/kit.repository.js";

const router = Router();

router.use(requireAuth);

// Get all kits
router.get(
  "/",
  requireManagerOrAdmin,
  async (req, res, next) => {
    try {

      const kits = await kitRepository.listAll();

      res.json({
        kits,
      });

    } catch (error) {
      next(error);
    }
  },
);


router.post(
  "/resolve",
  requireManagerOrAdmin,
  validate(
    z.object({
      body: z.object({
        identifiers: z.array(z.string().min(1)).min(1),
      }),
    }),
  ),
  async (req, res, next) => {
    try {
      const kits = await kitService.resolveKits(req.validated.body.identifiers);
      res.json({ kits });
    } catch (error) {
      next(error);
    }
  },
);

router.get(
  "/stock-report",
  requireManagerOrAdmin,
  async (_req, res, next) => {
    try {
      const report = await kitService.stockReportComparison();
      res.json(report);
    } catch (error) {
      next(error);
    }
  },
);

export const kitRoutes = router;
