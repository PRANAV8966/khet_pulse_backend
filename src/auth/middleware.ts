import { Request, Response, NextFunction } from "express";
import { getAuth } from "firebase-admin/auth";
import { getApps, initializeApp, cert } from "firebase-admin/app";

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

/**
 * Firebase ID-token verification middleware (architecture v2 §2, §8). Auth
 * is email/password or custom token - not Firebase phone-OTP (no free SMS
 * allowance since Sept 2024). Ownership/authorization is enforced
 * separately per-route (see requireDeviceOwnership) against Postgres, not
 * via Postgres RLS.
 */
export async function requireAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  const header = req.header("authorization");
  const token = header?.startsWith("Bearer ") ? header.slice("Bearer ".length) : null;
  if (!token) {
    res.status(401).json({ error: "missing bearer token" });
    return;
  }

  try {
    ensureFirebaseApp();
    const decoded = await getAuth().verifyIdToken(token);
    req.userId = decoded.uid;
    next();
  } catch (err) {
    // Never leak verification internals (expired vs malformed vs
    // misconfigured) to the client - log server-side only.
    console.error("[auth] token verification failed:", err instanceof Error ? err.message : err);
    res.status(401).json({ error: "invalid or expired token" });
  }
}
