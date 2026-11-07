import "dotenv/config";
import mqtt from "mqtt";
import { randomUUID } from "crypto";
import { verify } from "../security/hmac";
import { topics, commandRequestSchema, CommandResponsePayload, CommandRequestPayload } from "../mqtt/payloads";
import { DEMO_DEVICE_ID, DEMO_HMAC_SECRET } from "../../prisma/seed";

/**
 * Phase 1 simulated device - speaks the same MQTT contract the real
 * STM32F401 + A7670C firmware will (architecture v2 §1, §4), so the whole
 * backend/app pipeline is provable before any hardware exists. Deliberately
 * delays every Nth command's response past a plausible ack window so the
 * backend's UNKNOWN state is actually exercisable, not just the happy path.
 */
const deviceId = process.env.SIMULATOR_DEVICE_ID ?? DEMO_DEVICE_ID;
const hmacSecret = process.env.SIMULATOR_HMAC_SECRET ?? DEMO_HMAC_SECRET;
const telemetryIntervalMs = Number(process.env.SIMULATOR_TELEMETRY_INTERVAL_MS ?? 15_000);

let currentState: "IDLE" | "STARTING" | "RUNNING" | "STOPPING" | "FAULT" = "IDLE";
let commandCount = 0;

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

function publishState(client: mqtt.MqttClient, state: typeof currentState) {
  currentState = state;
  client.publish(topics.state(deviceId), JSON.stringify({ state, ts: nowSeconds() }), { qos: 1 });
}

function publishTelemetry(client: mqtt.MqttClient) {
  const base = currentState === "RUNNING" ? 8 : 0.1; // plausible running vs idle current draw
  client.publish(
    topics.telemetry(deviceId),
    JSON.stringify({
      voltageA: 228 + Math.random() * 4,
      voltageB: 229 + Math.random() * 4,
      voltageC: 227 + Math.random() * 4,
      currentA: base + Math.random(),
      currentB: base + Math.random(),
      currentC: base + Math.random(),
      ts: nowSeconds(),
    }),
    { qos: 1 }
  );
}

function publishCmdResponse(client: mqtt.MqttClient, commandId: string, status: CommandResponsePayload["status"], note?: string) {
  client.publish(
    topics.cmdResp(deviceId),
    JSON.stringify({ command_id: commandId, status, note, ts: nowSeconds() } satisfies CommandResponsePayload),
    { qos: 1 }
  );
}

async function handleCommand(client: mqtt.MqttClient, raw: CommandRequestPayload) {
  commandCount += 1;

  const nowTs = nowSeconds();
  if (nowTs > raw.expires_at) {
    // Firmware must reject an expired command outright, no execution
    // (architecture v2 §4, §10).
    publishCmdResponse(client, raw.command_id, "REJECTED", "expired");
    return;
  }

  const valid = verify(
    { deviceId: raw.device_id, action: raw.action, desiredState: raw.desired_state, sequence: raw.sequence, expiresAt: raw.expires_at },
    hmacSecret,
    raw.hmac
  );
  if (!valid) {
    publishCmdResponse(client, raw.command_id, "REJECTED", "bad hmac");
    return;
  }

  publishCmdResponse(client, raw.command_id, "ACCEPTED");
  publishState(client, raw.desired_state === "ON" ? "STARTING" : "STOPPING");
  publishCmdResponse(client, raw.command_id, "ACTUATING");

  // Every 5th command takes long enough to exercise the backend's
  // ack-timeout -> UNKNOWN path deliberately, not just the happy path.
  const slow = commandCount % 5 === 0;
  const delayMs = slow ? 70_000 : 2_000 + Math.random() * 2000;

  setTimeout(() => {
    publishState(client, raw.desired_state === "ON" ? "RUNNING" : "IDLE");
    publishCmdResponse(client, raw.command_id, "SUCCEEDED");
  }, delayMs);
}

async function main() {
  const url = process.env.MQTT_URL;
  if (!url) throw new Error("MQTT_URL is not set");

  const client = mqtt.connect(url, {
    username: process.env.MQTT_USERNAME,
    password: process.env.MQTT_PASSWORD,
    will: { topic: topics.lwt(deviceId), payload: JSON.stringify({ ts: nowSeconds() }), qos: 1, retain: false },
  });

  client.on("connect", () => {
    console.log(`[simulator] ${deviceId} connected`);
    client.subscribe(topics.cmdReq(deviceId), { qos: 1 });
    // Reconcile to actual state on connect/reconnect (architecture v2 §5 -
    // this IS the "online" signal, see src/mqtt/payloads.ts header comment).
    publishState(client, currentState);
    publishTelemetry(client);
  });

  client.on("message", (topic, message) => {
    if (!topic.endsWith("/cmd/req")) return;
    try {
      const parsed = commandRequestSchema.safeParse(JSON.parse(message.toString("utf8")));
      if (!parsed.success) {
        console.error("[simulator] bad command payload:", parsed.error.message);
        return;
      }
      void handleCommand(client, parsed.data);
    } catch (err) {
      console.error("[simulator] failed to handle command:", err);
    }
  });

  client.on("error", (err) => console.error("[simulator] mqtt error:", err));

  setInterval(() => publishTelemetry(client), telemetryIntervalMs);

  const shutdown = () => {
    console.log("[simulator] shutting down");
    // A clean MQTT disconnect does not fire the broker's LWT (only an
    // ungraceful loss does) - the backend's staleness detection on
    // lastHeartbeatAt covers this gap (architecture v2 §6), so nothing
    // extra is published here deliberately.
    client.end(false, {}, () => process.exit(0));
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((err) => {
  console.error("[simulator] fatal error:", err);
  process.exit(1);
});
