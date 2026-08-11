import { Router } from "express";
import { z } from "zod";
import { requireAuth, requireManagerOrAdmin } from "../middleware/auth.js";
import { validate } from "../middleware/validate.js";
import { kitService } from "../services/kit.service.js";
import { kitRepository } from "../repositories/kit.repository.js";
import { AppError } from "../lib/app-error.js";
import { parseLogCsv } from "../lib/log-csv.js";

const router = Router();

const logRowSchema = z.object({
  name: z.string().trim().min(1).max(255),
  serial_numbers: z.string().trim().min(1).max(10000),
});

const logRowsSchema = z.array(logRowSchema).min(1).max(500);

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

router.post(
  "/log-vs-stock",
  requireManagerOrAdmin,
  validate(
    z.object({
      body: z.object({
        rows: logRowsSchema,
        stock_serials: z.string().max(2_000_000).optional().default(""),
      }),
    }),
  ),
  async (req, res, next) => {
    try {
      const result = await kitService.compareLogWithStock(
        req.validated.body.rows,
        req.validated.body.stock_serials,
      );
      res.json(result);
    } catch (error) {
      next(error);
    }
  },
);

router.post(
  "/log-vs-stock/upload",
  requireManagerOrAdmin,
  validate(
    z.object({
      body: z.object({
        csvContent: z.string().trim().min(1).max(2_000_000),
        stock_serials: z.string().max(2_000_000).optional().default(""),
      }),
    }),
  ),
  async (req, res, next) => {
    try {
      const rows = parseLogCsv(req.validated.body.csvContent);
      const parsedRows = logRowsSchema.safeParse(rows);
      if (!parsedRows.success) {
        throw new AppError(400, "CSV must contain name and serial_numbers columns", parsedRows.error.flatten());
      }

      const result = await kitService.compareLogWithStock(
        parsedRows.data,
        req.validated.body.stock_serials,
      );
      res.json({ ...result, uploaded_rows: parsedRows.data.length });
    } catch (error) {
      return next(error);
    }
  },
);

router.post(
  "/stock-report/update",
  requireManagerOrAdmin,
  validate(
    z.object({
      body: z.object({
        scope: z.enum(["selected", "all-valid"]),
        rows: z.array(
          z.object({
            serial_number: z.string().max(255).optional().default(""),
            part_code: z.string().max(255).optional().default(""),
          }),
        ).max(500).default([]),
      }).superRefine((body, ctx) => {
        if (body.scope === "selected" && body.rows.length === 0) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["rows"],
            message: "At least one stock row is required for a selected update.",
          });
        }
      }),
    }),
  ),
  async (req, res, next) => {
    try {
      const result = await kitService.updateFromStockReport({
        actorId: req.user.id,
        scope: req.validated.body.scope,
        rows: req.validated.body.rows,
      });
      res.json(result);
    } catch (error) {
      next(error);
    }
  },
);

export const kitRoutes = router;
