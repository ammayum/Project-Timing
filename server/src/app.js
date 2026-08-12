import cors from "cors";
import express from "express";
import helmet from "helmet";
import morgan from "morgan";
import rateLimit from "express-rate-limit";
import { errorHandler } from "./middleware/error-handler.js";
import { maintenanceGuard } from "./middleware/maintenance.js";
import { notFoundHandler } from "./middleware/not-found.js";
import { authRoutes } from "./routes/auth.routes.js";
import { timeEntryRoutes } from "./routes/time-entry.routes.js";
import { kitRoutes } from "./routes/kit.routes.js";
import { adminRoutes } from "./routes/admin.routes.js";
import { syncRoutes } from "./routes/sync.routes.js";
import { publicRoutes } from "./routes/public.routes.js";
import { inventoryRoutes } from "./modules/inventory/inventory.routes.js";
import { inventoryLegacyRoutes } from "./modules/inventory/inventory.legacy.routes.js";
import { inventoryLocationMoveRoutes } from "./modules/inventory/inventory.location-move.routes.js";
import { inventoryPalletRoutes } from "./modules/inventory/inventory.pallet.routes.js";
import { env } from "./config/env.js";
import { getProductionReadiness } from "./config/db.js";

function createLimiter(windowMs, limit, message) {
  return rateLimit({
    windowMs,
    limit,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    message: { message },
  });
}

export function createApp() {
  const app = express();

  app.set("trust proxy", env.trustProxy);

  app.use(
    cors({
      origin(origin, callback) {
        if (!origin || env.frontendOrigins.includes(origin)) {
          return callback(null, true);
        }

        return callback(new Error("CORS origin is not allowed"));
      },
      credentials: true,
    }),
  );
  app.use(helmet());
  app.use(express.json({ limit: "2mb" }));
  app.use(express.urlencoded({ extended: true }));
  app.use(morgan(":method :url :status :res[content-length] - :response-time ms"));
  app.use(
    createLimiter(15 * 60 * 1000, 300, "Too many requests. Please try again later."),
  );

  const loginLimiter = createLimiter(15 * 60 * 1000, 10, "Too many login attempts. Please try again later.");
  const sensitiveLimiter = createLimiter(15 * 60 * 1000, 30, "Too many sensitive requests. Please try again later.");
  const adminLimiter = createLimiter(15 * 60 * 1000, 120, "Too many admin requests. Please try again later.");
  const inventoryLimiter = createLimiter(15 * 60 * 1000, 240, "Too many inventory requests. Please try again later.");

  app.use("/api/auth/login", loginLimiter);
  app.use("/api/auth/microsoft", loginLimiter);
  app.use("/api/auth/change-password", sensitiveLimiter);
  app.use("/api/admin", adminLimiter);
  app.use("/api/v1/inventory", inventoryLimiter);
  app.use("/api/time-entries/upload", sensitiveLimiter);
  app.use("/api/admin/kits/upload", sensitiveLimiter);
  app.use("/api/public/log-vs-stock", sensitiveLimiter);

  app.get("/api/ready", async (_req, res, next) => {
    try {
      const readiness = await getProductionReadiness();
      res.status(readiness.ready ? 200 : 503).json(readiness);
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/health", (_req, res) => {
    res.json({ status: "ok" });
  });

  app.use(maintenanceGuard);

  app.use("/api/auth", authRoutes);
  app.use("/api/public", publicRoutes);
  app.use("/api/time-entries", timeEntryRoutes);
  app.use("/api/kits", kitRoutes);
  app.use("/api/admin", adminRoutes);
  app.use("/api/sync", syncRoutes);
  app.use("/api/v1/inventory", inventoryRoutes);
  app.use("/api/v1/inventory", inventoryLegacyRoutes);
  app.use("/api/v1/inventory", inventoryLocationMoveRoutes);
  app.use("/api/v1/inventory", inventoryPalletRoutes);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
