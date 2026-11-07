import { Request, Response, NextFunction } from "express";

/**
 * Firebase ID-token verification middleware (architecture v2 §2, §8).
 * Auth is email/password or custom token - not Firebase phone-OTP (no free
 * SMS allowance since Sept 2024). Ownership/authorization is enforced here
 * in the backend against Postgres, not via Postgres RLS - simpler for a
 * small team, since Firebase identity doesn't automatically bridge into
 * Supabase's RLS helpers.
 *
 * TODO (Phase 1, next step): verify Firebase ID token via firebase-admin,
 * attach req.userId, 401 on failure.
 */
export function requireAuth(_req: Request, _res: Response, next: NextFunction) {
  next();
}
