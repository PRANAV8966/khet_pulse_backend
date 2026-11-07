import { Request, Response, NextFunction } from "express";
import { prisma } from "../db/prisma";

/** Same pattern as requireDeviceOwnership.ts - resolves ownership from
 * Postgres on every request, never trusts a client-supplied claim. */
export async function requireFarmOwnership(req: Request, res: Response, next: NextFunction): Promise<void> {
  const farmId = req.params.farmId;
  const userId = req.userId;
  if (!userId) {
    res.status(401).json({ error: "unauthenticated" });
    return;
  }

  // Express 4 does not catch a rejected promise from an async middleware -
  // without this try/catch, a transient DB error here would leave the
  // request hanging with no response ever sent, instead of a clean 500.
  try {
    const farm = await prisma.farm.findUnique({ where: { id: farmId } });
    if (!farm) {
      res.status(404).json({ error: "farm not found" });
      return;
    }
    if (farm.ownerUserId !== userId) {
      res.status(403).json({ error: "not authorized for this farm" });
      return;
    }
    next();
  } catch (err) {
    next(err);
  }
}
