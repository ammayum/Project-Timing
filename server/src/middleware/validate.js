import { AppError } from "../lib/app-error.js";

export function validate(schema) {
  return (req, _res, next) => {
    const result = schema.safeParse({
      body: req.body,
      query: req.query,
      params: req.params,
      headers: req.headers,
    });

    if (!result.success) {
      return next(new AppError(400, "Validation failed", result.error.flatten()));
    }

    req.validated = result.data;
    return next();
  };
}
