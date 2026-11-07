/** Typed errors mapped to HTTP responses by src/middleware/errorHandler.ts.
 * Keeps services free of any knowledge of HTTP status codes. */
export class ValidationError extends Error {}
export class NotFoundError extends Error {}
export class ForbiddenError extends Error {}
export class ConflictError extends Error {}
