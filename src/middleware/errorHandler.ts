import { Request, Response, NextFunction } from "express";
import { ValidationError, NotFoundError, ForbiddenError, ConflictError } from "../errors";

/** Centralized error -> HTTP mapping. Every API response goes through this
 * (or an explicit res.json in the route) - never a raw error/stack trace to
 * the client. Must be registered last, after all routes. */
export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction): void {
  if (err instanceof ValidationError) {
    res.status(400).json({ error: err.message });
    return;
  }
  if (err instanceof NotFoundError) {
    res.status(404).json({ error: err.message });
    return;
  }
  if (err instanceof ForbiddenError) {
    res.status(403).json({ error: err.message });
    return;
  }
  if (err instanceof ConflictError) {
    res.status(409).json({ error: err.message });
    return;
  }
  console.error("[api] unhandled error:", err);
  res.status(500).json({ error: "internal server error" });
}
