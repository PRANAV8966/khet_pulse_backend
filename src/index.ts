import "dotenv/config";
import { prisma } from "./db/prisma";
import { getConfigService } from "./config/ConfigService";
import { createServer } from "./api/server";
import { MqttClient } from "./mqtt/MqttClient";
import { CommandManager } from "./commands/CommandManager";
import { DeviceStatusService } from "./devices/DeviceStatusService";
import { AlertManager } from "./alerts/AlertManager";
import { NotificationDispatcher } from "./notifications/NotificationDispatcher";

const COMMAND_SWEEP_INTERVAL_MS = 10_000;
const OUTBOX_DRAIN_INTERVAL_MS = 5_000;

async function main() {
  const config = getConfigService();
  await config.init();

  const commandManager = new CommandManager(config);
  const deviceStatusService = new DeviceStatusService(config);
  const alertManager = new AlertManager(config);
  const notificationDispatcher = new NotificationDispatcher(config);
  const mqttClient = new MqttClient(config);

  commandManager.setPublisher(mqttClient);

  // Inbound MQTT message routing - deliberately kept here (the composition
  // root) rather than inside MqttClient, so MqttClient never depends on the
  // other modules' APIs (see MqttClient's own header comment).
  mqttClient.on("telemetry", (deviceId, payload) => {
    deviceStatusService.applyTelemetry(deviceId, payload).catch((err) => console.error("[telemetry]", err));
  });
  mqttClient.on("state", (deviceId, payload) => {
    deviceStatusService.applyStateMessage(deviceId, payload).catch((err) => console.error("[state]", err));
  });
  mqttClient.on("lwt", (deviceId) => {
    deviceStatusService.applyLwt(deviceId).catch((err) => console.error("[lwt]", err));
  });
  mqttClient.on("cmdResponse", (deviceId, payload) => {
    commandManager.handleCommandResponse(deviceId, payload).catch((err) => console.error("[cmdResponse]", err));
  });
  mqttClient.on("alert", (deviceId, payload) => {
    // Convention: a type ending in _CLEARED resolves the matching
    // unresolved fault instead of recording a new one.
    if (payload.type.endsWith("_CLEARED")) {
      const type = payload.type.replace(/_CLEARED$/, "");
      alertManager.resolveFault(deviceId, type).catch((err) => console.error("[alert:resolve]", err));
    } else {
      alertManager.recordFault(deviceId, payload.type, payload.detail).catch((err) => console.error("[alert:record]", err));
    }
  });

  await mqttClient.connect();

  const app = createServer(config, { commandManager, deviceStatusService });
  const port = Number(process.env.PORT ?? 3000);
  const server = app.listen(port, () => {
    console.log(`[backend] listening on :${port}`);
  });

  const sweepTimer = setInterval(() => {
    commandManager.sweepExpiredCommands().catch((err) => console.error("[sweep]", err));
  }, COMMAND_SWEEP_INTERVAL_MS);

  const drainTimer = setInterval(() => {
    notificationDispatcher.drainOutbox().catch((err) => console.error("[drain]", err));
  }, OUTBOX_DRAIN_INTERVAL_MS);

  const shutdown = async (signal: string) => {
    console.log(`[backend] received ${signal}, shutting down`);
    clearInterval(sweepTimer);
    clearInterval(drainTimer);
    server.close();
    await mqttClient.shutdown();
    await config.shutdown();
    await prisma.$disconnect();
    process.exit(0);
  };
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

main().catch((err) => {
  console.error("[backend] fatal startup error:", err);
  process.exit(1);
});
