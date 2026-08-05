import { Router } from "express";
import { z } from "zod";
import { requireAdmin, requireAuth } from "../middleware/auth.js";
import { validate } from "../middleware/validate.js";
import { timeEntryService } from "../services/time-entry.service.js";
import { syncService } from "../services/sync.service.js";

const router = Router();

router.use(requireAuth);

router.post(
  "/",
  validate(
    z.object({
      body: z.object({
        date: z.string().min(1),
      }),
    }),
  ),
  async (req, res, next) => {
    try {
      const entries = await timeEntryService.listForDate(req.user.id, req.validated.body.date);
      const mappedEntries = entries.map((entry) => ({
        entry_date: entry.entry_date,
        activity_name: entry.activity_name,
        project_code: entry.ja_code,
        from_time: entry.from_time,
        to_time: entry.to_time,
        hours: entry.hours,
        kit_identifiers: entry.kits ?? [],
      }));
      const result = await syncService.syncTimeEntries(mappedEntries, req.user);
      res.json(result);
    } catch (error) {
      next(error);
    }
  },
);

router.post("/toggle", requireAdmin, (_req, res) => {
  res.status(501).json({ message: "Use /api/admin/sync-toggle" });
});

export const syncRoutes = router;
