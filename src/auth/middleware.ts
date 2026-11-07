import { Request, Response, NextFunction } from "express";
import { getAuth } from "firebase-admin/auth";
import { getApps, initializeApp, cert } from "firebase-admin/app";
import { prisma } from "../db/prisma";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      userId?: string;
    }
  }
}

function ensureFirebaseApp(): void {
  if (getApps().length > 0) return;
  const projectId = process.env.FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const privateKey = process.env.FIREBASE_PRIVATE_KEY;
  if (!projectId || !clientEmail || !privateKey) {
    throw new Error("Firebase credentials are not configured (FIREBASE_PROJECT_ID/CLIENT_EMAIL/PRIVATE_KEY)");
  }
  initializeApp({
    credential: cert({ projectId, clientEmail, privateKey: privateKey.replace(/\\n/g, "\n") }),
  });
}

// Firebase UIDs already confirmed to have a Postgres `users` row in this
// process's lifetime - users are never deleted, so this can only ever go
// stale toward "performs a check it no longer strictly needs," never toward
// incorrectly skipping a real one. Avoids a DB write on every single
// authenticated request after the first for a given user.
const provisionedUserIds = new Set<string>();

async function ensureUserProvisioned(uid: string, email?: string, phone?: string): Promise<void> {
  if (provisionedUserIds.has(uid)) return;
  // Native Postgres upsert (single atomic INSERT ... ON CONFLICT) since
  // Prisma 4.6.0 for a single-unique-field, no-nested-write upsert like this
  // one - https://github.com/prisma/orm/releases/tag/4.6.0. Not relied on
  // blindly though: a known Prisma issue (prisma/orm#25967) reports a
  // unique-constraint error on an apparently-eligible upsert, so this still
  // doesn't assume it's race-free - update is `{}` (never overwrite) so a
  // losing concurrent writer converges to the same no-op result either way.
  await prisma.user.upsert({
    where: { id: uid },
    create: { id: uid, email, phone },
    update: {},
  });
  provisionedUserIds.add(uid);
}

/**
 * Firebase ID-token verification middleware (architecture v2 §2, §8). Auth
 * is email/password or custom token - not Firebase phone-OTP (no free SMS
 * allowance since Sept 2024). Ownership/authorization is enforced
 * separately per-route (see requireDeviceOwnership) against Postgres, not
 * via Postgres RLS.
 *
 * Also provisions the matching Postgres `users` row on first sight of a
 * Firebase UID - every FK relation (farms.owner_user_id, audit_logs.user_id,
 * ...) requires one to exist, and there is no separate signup step a client
 * could forget to call.
 */
export async function requireAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  const header = req.header("authorization");
  const token = header?.startsWith("Bearer ") ? header.slice("Bearer ".length) : null;
  if (!token) {
    res.status(401).json({ error: "missing bearer token" });
    return;
  }

  let uid: string, email: string | undefined, phone: string | undefined;
  try {
    ensureFirebaseApp();
    const decoded = await getAuth().verifyIdToken(token);
    uid = decoded.uid;
    email = decoded.email;
    phone = decoded.phone_number;
  } catch (err) {
    // Never leak verification internals (expired vs malformed vs
    // misconfigured) to the client - log server-side only.
    console.error("[auth] token verification failed:", err instanceof Error ? err.message : err);
    res.status(401).json({ error: "invalid or expired token" });
    return;
  }

  try {
    await ensureUserProvisioned(uid, email, phone);
  } catch (err) {
    // Distinct from the 401 above - the token was valid, provisioning
    // failed for an unrelated (DB) reason. Conflating the two would be a
    // misleading error for the client to act on.
    console.error("[auth] user provisioning failed:", err);
    res.status(500).json({ error: "internal server error" });
    return;
  }

  req.userId = uid;
  next();
}
