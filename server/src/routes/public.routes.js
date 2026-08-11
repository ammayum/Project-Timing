import { Router } from "express";
import { z } from "zod";
import { AppError } from "../lib/app-error.js";
import { parseLogCsv } from "../lib/log-csv.js";
import { validate } from "../middleware/validate.js";
import { kitService } from "../services/kit.service.js";

const router = Router();
const publicUploadSchema = z.object({
  csvContent: z.string().trim().min(1).max(2_000_000),
  stock_serials: z.string().trim().min(1).max(2_000_000),
});
const logRowsSchema = z.array(
  z.object({
    name: z.string().trim().min(1).max(255),
    serial_numbers: z.string().trim().min(1).max(10000),
  }),
).min(1).max(500);

router.post(
  "/log-vs-stock/upload",
  validate(z.object({ body: publicUploadSchema })),
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
      next(error);
    }
  },
);

export const publicRoutes = router;
