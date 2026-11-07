import { EventEmitter } from "events";
import mqtt, { MqttClient as MqttjsClient } from "mqtt";
import { ConfigService } from "../config/ConfigService";
import { CommandPublisher } from "../commands/CommandManager";
import {
  topics,
  deviceIdFromTopic,
  telemetrySchema,
  stateSchema,
  alertSchema,
  commandResponseSchema,
  CommandRequestPayload,
  TelemetryPayload,
  StatePayload,
  AlertPayload,
  CommandResponsePayload,
} from "./payloads";

export interface MqttClientEvents {
  telemetry: (deviceId: string, payload: TelemetryPayload) => void;
  state: (deviceId: string, payload: StatePayload) => void;
  alert: (deviceId: string, payload: AlertPayload) => void;
  lwt: (deviceId: string) => void;
  cmdResponse: (deviceId: string, payload: CommandResponsePayload) => void;
}

/**
 * MQTT client (architecture v2 §1, §7). Owns the connection to HiveMQ Cloud
 * and the telemetry/state/alert/lwt subscribers + cmd/req publisher.
 * Emits typed events for inbound messages rather than depending directly on
 * DeviceStatusService/AlertManager/CommandManager - the composition root
 * (index.ts) wires listeners, so every module stays swappable/testable in
 * isolation (this project's own stated design goal, see README).
 */
export class MqttClient extends EventEmitter implements CommandPublisher {
  private client: MqttjsClient | null = null;

  constructor(private config: ConfigService) {
    super();
  }

  async connect(): Promise<void> {
    const url = process.env.MQTT_URL;
    if (!url) throw new Error("MQTT_URL is not set");
    if (!url.startsWith("mqtts://") && !url.startsWith("wss://")) {
      // HMAC gives authentication/integrity only, never confidentiality
      // (architecture v2 §5) - refusing a plaintext broker URL here is the
      // one place we can enforce transport security isn't silently dropped
      // between backend and broker (the device-side modem limitation is a
      // separate, accepted gap documented in the architecture doc).
      throw new Error(`refusing to connect to a non-TLS MQTT_URL: ${url}`);
    }

    const keepalive = this.config.get<number>("mqtt.keepalive_seconds", 60);

    await new Promise<void>((resolve, reject) => {
      this.client = mqtt.connect(url, {
        username: process.env.MQTT_USERNAME,
        password: process.env.MQTT_PASSWORD,
        keepalive,
        reconnectPeriod: 5000,
      });

      let settled = false;
      this.client.once("connect", () => {
        settled = true;
        console.log("[mqtt] connected");
        this.subscribeAll();
        resolve();
      });
      // A persistent handler, not .once - mqtt.js's own reconnect logic
      // means errors can keep occurring for the life of the connection
      // (network drops, broker restarts); Node throws on an unhandled
      // 'error' event once a .once listener has already fired and detached
      // itself, which would crash the whole backend process on the second
      // connection error.
      this.client.on("error", (err) => {
        console.error("[mqtt] connection error:", err);
        if (!settled) {
          settled = true;
          reject(err);
        }
      });
      this.client.on("reconnect", () => console.log("[mqtt] reconnecting..."));
      this.client.on("message", (topic, message) => this.handleMessage(topic, message));
    });
  }

  async publishCommand(deviceId: string, payload: CommandRequestPayload): Promise<void> {
    if (!this.client) throw new Error("MQTT client not connected");
    await new Promise<void>((resolve, reject) => {
      this.client!.publish(topics.cmdReq(deviceId), JSON.stringify(payload), { qos: 1 }, (err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }

  async shutdown(): Promise<void> {
    if (this.client) await new Promise<void>((resolve) => this.client!.end(false, {}, () => resolve()));
  }

  private subscribeAll(): void {
    const wildcards = [
      topics.telemetryWildcard,
      topics.stateWildcard,
      topics.alertWildcard,
      topics.lwtWildcard,
      topics.cmdRespWildcard,
    ];
    for (const w of wildcards) {
      this.client!.subscribe(w, { qos: 1 }, (err) => {
        if (err) console.error(`[mqtt] subscribe failed for ${w}:`, err);
      });
    }
  }

  private handleMessage(topic: string, message: Buffer): void {
    const deviceId = deviceIdFromTopic(topic);
    if (!deviceId) return;

    let json: unknown;
    try {
      json = message.length > 0 ? JSON.parse(message.toString("utf8")) : {};
    } catch {
      console.error(`[mqtt] invalid JSON on ${topic}`);
      return;
    }

    if (topic.endsWith("/telemetry")) {
      const parsed = telemetrySchema.safeParse(json);
      if (parsed.success) this.emit("telemetry", deviceId, parsed.data);
      else console.error(`[mqtt] bad telemetry payload from ${deviceId}:`, parsed.error.message);
    } else if (topic.endsWith("/state")) {
      const parsed = stateSchema.safeParse(json);
      if (parsed.success) this.emit("state", deviceId, parsed.data);
      else console.error(`[mqtt] bad state payload from ${deviceId}:`, parsed.error.message);
    } else if (topic.endsWith("/alert")) {
      const parsed = alertSchema.safeParse(json);
      if (parsed.success) this.emit("alert", deviceId, parsed.data);
      else console.error(`[mqtt] bad alert payload from ${deviceId}:`, parsed.error.message);
    } else if (topic.endsWith("/lwt")) {
      this.emit("lwt", deviceId);
    } else if (topic.endsWith("/cmd/resp")) {
      const parsed = commandResponseSchema.safeParse(json);
      if (parsed.success) this.emit("cmdResponse", deviceId, parsed.data);
      else console.error(`[mqtt] bad cmd/resp payload from ${deviceId}:`, parsed.error.message);
    }
  }
}
