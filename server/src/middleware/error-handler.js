import { AppError } from "../lib/app-error.js";
import { env } from "../config/env.js";

export function errorHandler(error, _req, res, _next) {
  if (error instanceof AppError) {
    return res.status(error.statusCode).json({
      message: error.message,
      ...(env.nodeEnv === "production" || !error.details ? {} : { details: error.details }),
    });
  }

  console.error(env.nodeEnv === "production" ? error.message : error);
  return res.status(500).json({
    message: "Internal server error",
  });
}
