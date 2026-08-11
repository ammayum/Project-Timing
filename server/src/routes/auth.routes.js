import { Router } from "express";
import { z } from "zod";
import { authService } from "../services/auth.service.js";
import { validate } from "../middleware/validate.js";
import { env } from "../config/env.js";
import { AppError } from "../lib/app-error.js";
import { requireAuth } from "../middleware/auth.js";

const router = Router();

router.get("/dev-users", async (_req, res, next) => {
  try {
    if (!env.devAuthBypass) throw new AppError(404, "Development auth bypass is disabled");
    res.json({ users: await authService.listDevUsers() });
  } catch (error) { next(error); }
});

router.post(
  "/dev-login",
  validate(z.object({ body: z.object({ userKey: z.string().min(1).optional() }).default({}) })),
  async (req, res, next) => {
    try {
      if (!env.devAuthBypass) throw new AppError(404, "Development auth bypass is disabled");
      const result = req.validated.body.userKey
        ? await authService.loginWithDevUserKey(req.validated.body.userKey)
        : await authService.loginWithDevBypass();
      res.json(result);
    } catch (error) { next(error); }
  },
);

router.post(
  "/login",
  validate(z.object({ body: z.object({ identity: z.string().min(1), password: z.string().min(1) }) })),
  async (req, res, next) => {
    try {
      const { identity, password } = req.validated.body;
      res.json(await authService.loginWithCredentials(identity, password));
    } catch (error) { next(error); }
  },
);

router.post(
  "/microsoft",
  validate(z.object({ body: z.object({ oid: z.string().min(1), name: z.string().min(1), email: z.string().email(), ein: z.string().optional() }) })),
  async (req, res, next) => {
    try { res.json(await authService.loginWithMicrosoftProfile(req.validated.body)); }
    catch (error) { next(error); }
  },
);

router.post("/logout", requireAuth, async (req, res, next) => {
  try {
    if (req.authSession?.id) await authService.revokeSession(req.authSession.id, "signout");
    res.json({ success: true });
  } catch (error) { next(error); }
});

router.post(
  "/change-password",
  requireAuth,
  validate(z.object({ body: z.object({ currentPassword: z.string().min(1), newPassword: z.string().min(env.passwordMinLength) }) })),
  async (req, res, next) => {
    try {
      const { currentPassword, newPassword } = req.validated.body;
      res.json(await authService.changePassword(req.user.id, currentPassword, newPassword, req.authSession?.id));
    } catch (error) { next(error); }
  },
);

router.post(
  "/set-password",
  validate(z.object({ body: z.object({ identity: z.string().min(1), password: z.string().min(env.passwordMinLength) }) })),
  async (req, res, next) => {
    try {
      if (!env.devAuthBypass) throw new AppError(404, "Not available");
      const { identity, password } = req.validated.body;
      res.json(await authService.setPasswordForIdentity(identity, password));
    } catch (error) { next(error); }
  },
);

export const authRoutes = router;
