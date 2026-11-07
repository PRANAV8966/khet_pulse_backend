import { Request, Response, NextFunction } from "express";
import { prisma } from "../db/prisma";

/**
 * Single reusable ownership check for every device-scoped route - device ->
 * farm -> owner must match the authenticated user. Enforced here in the
 * backend against Postgres (see auth/middleware.ts), not via Postgres RLS.
 */
export async function requireDeviceOwnership(req: Request, res: Response, next: NextFunction): Promise<void> {
  const deviceId = req.params.deviceId;
  const userId = req.userId;
  if (!userId) {
    res.status(401).json({ error: "unauthenticated" });
    return;
  }

  // Express 4 does not catch a rejected promise from an async middleware -
  // without this try/catch, a transient DB error here would leave the
  // request hanging with no response ever sent, instead of a clean 500.
  try {
    const device = await prisma.device.findUnique({ where: { id: deviceId }, include: { farm: true } });
    if (!device) {
      res.status(404).json({ error: "device not found" });
      return;
    }
    if (device.farm.ownerUserId !== userId) {
      res.status(403).json({ error: "not authorized for this device" });
      return;
    }
    next();
  } catch (err) {
    next(err);
  }
}
