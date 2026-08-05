import { Router } from "express";
import { z } from "zod";
import { requireAuth } from "../middleware/auth.js";
import { validate } from "../middleware/validate.js";
import { timeEntryService } from "../services/time-entry.service.js";
import { csvService } from "../services/csv.service.js";
import { projectRepository } from "../repositories/project.repository.js";
import { activityRepository } from "../repositories/activity.repository.js";

const entryRowSchema = z.object({
  date: z.string().min(1),
  activity: z.string().min(1),
  order_num: z.string().optional().nullable(),
  project: z.string().optional().nullable(),
  from_time: z.string().min(1),
  to_time: z.string().min(1),
  overtime: z.boolean(),
  kits: z.string().optional(),
});

const router = Router();

router.use(requireAuth);

router.get(
  "/meta",
  async (req, res, next) => {
    try {
      const [projects, activities] = await Promise.all([
        projectRepository.listActive(req.user),
        activityRepository.listAll(),
      ]);
      res.json({ projects, activities });
    } catch (error) {
      next(error);
    }
  },
);

router.get(
  "/",
  validate(
    z.object({
      query: z.object({
        date: z.string().min(1),
      }),
    }),
  ),
  async (req, res, next) => {
    try {
      const entries = await timeEntryService.listForDate(req.user.id, req.validated.query.date);
      res.json({ entries });
    } catch (error) {
      next(error);
    }
  },
);

router.post(
  "/",
  validate(
    z.object({
      body: z.object({
        sync: z.boolean().default(true),
        entries: z.array(entryRowSchema).min(1),
      }),
    }),
  ),
  async (req, res, next) => {
    try {
      const result = await timeEntryService.createEntries(req.user, req.validated.body.entries, {
        sync: req.validated.body.sync,
      });
      res.status(201).json(result);
    } catch (error) {
      next(error);
    }
  },
);

router.post(
  "/upload",
  validate(
    z.object({
      body: z.object({
        csvContent: z.string().min(1),
      }),
    }),
  ),
  async (req, res, next) => {
    try {
      const preview = await csvService.parseAndValidate(
        req.validated.body.csvContent,
        req.user
      );

      res.json(preview);

    } catch (error) {
      next(error);
    }
  },
);

export const timeEntryRoutes = router;
