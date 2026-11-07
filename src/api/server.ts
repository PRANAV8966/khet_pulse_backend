import express, { Express } from "express";
import rateLimit from "express-rate-limit";
import { ConfigService } from "../config/ConfigService";
import { CommandManager } from "../commands/CommandManager";
import { DeviceStatusService } from "../devices/DeviceStatusService";
import { prisma } from "../db/prisma";
import { requireAuth } from "../auth/middleware";
import { requireDeviceOwnership } from "../middleware/requireDeviceOwnership";
import { errorHandler } from "../middleware/errorHandler";
import { createCommandRequestSchema } from "../dto/commandDto";
import { ValidationError } from "../errors";

export interface ServerDependencies {
  commandManager: CommandManager;
  deviceStatusService: DeviceStatusService;
}

/**
 * REST API module - kept separate from bootstrap (index.ts) and from the
 * MQTT/command/notification modules so each can be tested or swapped
 * independently. Every response is an explicit DTO (CommandSummary /
 * DisplayStatus) - never a raw Prisma row.
 */
export function createServer(config: ConfigService, deps: ServerDependencies): Express {
  const app = express();
  app.use(express.json());

  app.get("/health", (_req, res) => {
    res.json({ ok: true, configReady: config.isReady() });
  });

  // Read-only visibility into the live config cache - useful while wiring
  // this up, but never used by the app itself to decide behaviour (that's
  // always config.get() inside each module).
  app.get("/internal/config-snapshot", (_req, res) => {
    res.json({
      "command.expiry_seconds": config.get("command.expiry_seconds", null),
      "command.replay_window_seconds": config.get("command.replay_window_seconds", null),
      "mqtt.keepalive_seconds": config.get("mqtt.keepalive_seconds", null),
      "notification.fault_cooldown_seconds": config.get("notification.fault_cooldown_seconds", null),
      "notification.channel_priority": config.get("notification.channel_priority", null),
      "device.heartbeat_interval_seconds": config.get("device.heartbeat_interval_seconds", null),
    });
  });

  // In-memory limiter - sufficient for the "one always-on process" backend
  // this project is deliberately scoped to (architecture v2 §7); would need
  // a shared store if the backend were ever horizontally scaled.
  const commandRateLimiter = rateLimit({
    windowMs: 60_000,
    limit: 20,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => req.userId ?? req.ip ?? "unknown",
  });

  app.post(
    "/devices/:deviceId/commands",
    requireAuth,
    commandRateLimiter,
    requireDeviceOwnership,
    async (req, res, next) => {
      try {
        const parsed = createCommandRequestSchema.safeParse(req.body);
        if (!parsed.success) throw new ValidationError(parsed.error.message);

        const summary = await deps.commandManager.createCommand({
          deviceId: req.params.deviceId,
          issuedByUserId: req.userId!,
          action: parsed.data.action,
          desiredState: parsed.data.desiredState,
          commandId: parsed.data.commandId,
        });
        res.status(201).json(summary);
      } catch (err) {
        next(err);
      }
    }
  );

  app.get("/devices/:deviceId/status", requireAuth, requireDeviceOwnership, async (req, res, next) => {
    try {
      const status = await deps.deviceStatusService.getDisplayStatus(req.params.deviceId);
      res.json(status);
    } catch (err) {
      next(err);
    }
  });

  app.post("/me/fcm-token", requireAuth, async (req, res, next) => {
    try {
      const fcmToken = typeof req.body?.fcmToken === "string" ? req.body.fcmToken : null;
      if (!fcmToken) throw new ValidationError("fcmToken (string) is required");
      // upsert, not update - a Firebase-authenticated user may not have a
      // Postgres row yet (no separate "provision user" flow exists in
      // Phase 1), so the first authenticated call from a device creates it.
      await prisma.user.upsert({
        where: { id: req.userId! },
        create: { id: req.userId!, fcmToken },
        update: { fcmToken },
      });
      res.status(204).send();
    } catch (err) {
      next(err);
    }
  });

  app.use(errorHandler);

  return app;
}
