import { Router } from "express";
import { z } from "zod";
import { authService } from "../services/auth.service.js";
import { validate } from "../middleware/validate.js";
import { env } from "../config/env.js";
import { AppError } from "../lib/app-error.js";
import { requireAuth } from "../middleware/auth.js";

const router = Router();

/* -------------------------------------------------------------------------- */
/* Development users                                                          */
/* -------------------------------------------------------------------------- */

router.get("/dev-users", async (_req, res, next) => {
  try {
    if (!env.devAuthBypass) {
      throw new AppError(404, "Development auth bypass is disabled");
    }

    const users = await authService.listDevUsers();
    res.json({ users });
  } catch (error) {
    next(error);
  }
});

/* -------------------------------------------------------------------------- */
/* Development login                                                          */
/* -------------------------------------------------------------------------- */

router.post(
  "/dev-login",
  validate(
    z.object({
      body: z
        .object({
          userKey: z.string().min(1).optional(),
        })
        .default({}),
    })
  ),
  async (req, res, next) => {
    try {
      if (!env.devAuthBypass) {
        throw new AppError(404, "Development auth bypass is disabled");
      }

      const result = req.validated.body.userKey
        ? await authService.loginWithDevUserKey(req.validated.body.userKey)
        : await authService.loginWithDevBypass();

      res.json(result);
    } catch (error) {
      next(error);
    }
  }
);

/* -------------------------------------------------------------------------- */
/* Username / Email login                                                     */
/* -------------------------------------------------------------------------- */

router.post(
  "/login",
  validate(
    z.object({
      body: z.object({
        identity: z.string().min(1),
        password: z.string().min(1),
      }),
    })
  ),
  async (req, res, next) => {
    try {
      const { identity, password } = req.validated.body;

      const result =
        await authService.loginWithCredentials(
          identity,
          password
        );

      res.json(result);

    } catch (error) {
      next(error);
    }
  }
);


















/* -------------------------------------------------------------------------- */
/* Microsoft Login                                                            */
/* -------------------------------------------------------------------------- */

router.post(
  "/microsoft",
  validate(
    z.object({
      body: z.object({
        oid: z.string().min(1),
        name: z.string().min(1),
        email: z.string().email(),
        ein: z.string().optional(),
      }),
    })
  ),
  async (req, res, next) => {
    try {
      const result = await authService.loginWithMicrosoftProfile(
        req.validated.body
      );

      res.json(result);
    } catch (error) {
      next(error);
    }
  }
);

/* -------------------------------------------------------------------------- */
/* Development password setter                                                */
/* -------------------------------------------------------------------------- */

router.post(
  "/logout",
  requireAuth,
  async (req, res, next) => {
    try {
      if (req.authSession?.id) {
        await authService.revokeSession(req.authSession.id, "signout");
      }

      res.json({ success: true });
    } catch (error) {
      next(error);
    }
  }
);

router.post(
  "/change-password",
  requireAuth,
  validate(
    z.object({
      body: z.object({
        currentPassword: z.string().min(1),
        newPassword: z.string().min(8),
      }),
    })
  ),
  async (req, res, next) => {
    try {
      const { currentPassword, newPassword } = req.validated.body;
      const result = await authService.changePassword(
        req.user.id,
        currentPassword,
        newPassword
      );

      res.json(result);
    } catch (error) {
      next(error);
    }
  }
);

router.post(
  "/set-password",
  validate(
    z.object({
      body: z.object({
        identity: z.string().min(1),
        password: z.string().min(1),
      }),
    })
  ),
  async (req, res, next) => {
    try {
      if (!env.devAuthBypass) {
        throw new AppError(404, "Not available");
      }

      const { identity, password } = req.validated.body;

      const result = await authService.setPasswordForIdentity(
        identity,
        password
      );

      res.json(result);
    } catch (error) {
      next(error);
    }
  }
);

export const authRoutes = router;
