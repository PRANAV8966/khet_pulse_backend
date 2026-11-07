import express, { Express } from "express";
import { ConfigService } from "../config/ConfigService";

/**
 * REST API module - kept separate from bootstrap (index.ts) and from the
 * MQTT/command/notification modules so each can be tested or swapped
 * independently.
 */
export function createServer(config: ConfigService): Express {
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

  return app;
}
