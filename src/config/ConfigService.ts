import { Client } from "pg";
import { prisma } from "../db/prisma";

type ConfigValue = string | number | boolean | Record<string, unknown> | unknown[];

/**
 * The adaptive-architecture piece: every tunable value lives in the
 * `system_config` table, not in code or env vars. This service loads it
 * into memory at boot and keeps it live via Postgres LISTEN/NOTIFY (see
 * prisma/sql/config_notify_trigger.sql), with a periodic poll as a safety
 * net in case a notification is ever missed. Editing a row in the DB takes
 * effect without a redeploy.
 */
export class ConfigService {
  private cache = new Map<string, ConfigValue>();
  private listenClient: Client | null = null;
  private ready = false;
  private refreshTimer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private databaseUrl: string,
    private refreshIntervalMs: number = 60_000
  ) {}

  async init(): Promise<void> {
    await this.reloadAll();
    await this.startListening();
    this.refreshTimer = setInterval(() => {
      this.reloadAll().catch((err) => console.error("[config] periodic refresh failed:", err));
    }, this.refreshIntervalMs);
    this.ready = true;
    console.log(`[config] loaded ${this.cache.size} key(s), live-reload active`);
  }

  async shutdown(): Promise<void> {
    if (this.refreshTimer) clearInterval(this.refreshTimer);
    if (this.listenClient) await this.listenClient.end();
  }

  /** Read a config value, falling back to `fallback` if the key isn't set. */
  get<T = ConfigValue>(key: string, fallback: T): T {
    if (!this.cache.has(key)) return fallback;
    return this.cache.get(key) as T;
  }

  isReady(): boolean {
    return this.ready;
  }

  private async reloadAll(): Promise<void> {
    const rows = await prisma.systemConfig.findMany();
    for (const row of rows) {
      this.cache.set(row.key, row.value as ConfigValue);
    }
  }

  private async reloadOne(key: string): Promise<void> {
    const row = await prisma.systemConfig.findUnique({ where: { key } });
    if (row) {
      this.cache.set(key, row.value as ConfigValue);
      console.log(`[config] reloaded "${key}" ->`, row.value);
    } else {
      this.cache.delete(key);
      console.log(`[config] "${key}" deleted, removed from cache`);
    }
  }

  private async startListening(): Promise<void> {
    this.listenClient = new Client({ connectionString: this.databaseUrl });
    await this.listenClient.connect();
    await this.listenClient.query("LISTEN system_config_changed");
    this.listenClient.on("notification", (msg) => {
      if (msg.channel === "system_config_changed" && msg.payload) {
        this.reloadOne(msg.payload).catch((err) =>
          console.error(`[config] failed to reload key "${msg.payload}":`, err)
        );
      }
    });
    this.listenClient.on("error", (err) => {
      console.error("[config] LISTEN connection error - relying on the periodic refresh until it recovers:", err);
    });
  }
}

/** Default values, used only to seed system_config (prisma/seed.ts) - never
 * read directly by application code, so changing a seeded value later in
 * the DB is the only thing that matters at runtime. */
export const configDefaults: Record<string, { value: ConfigValue; description: string }> = {
  "command.expiry_seconds": { value: 60, description: "How long a signed command is valid for before firmware must reject it" },
  "command.replay_window_seconds": { value: 300, description: "HMAC timestamp freshness window (+/-)" },
  "mqtt.keepalive_seconds": { value: 60, description: "MQTT keep-alive interval; LWT can lag up to 1.5x this" },
  "notification.fault_cooldown_seconds": { value: 600, description: "Minimum gap between repeat notifications for the same ongoing fault" },
  "notification.channel_priority": { value: ["fcm", "whatsapp", "sms"], description: "Dispatch order for alerts" },
  "device.heartbeat_interval_seconds": { value: 60, description: "Expected device heartbeat/telemetry cadence" },
};

let instance: ConfigService | null = null;

export function getConfigService(): ConfigService {
  if (!instance) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL is not set");
    instance = new ConfigService(url);
  }
  return instance;
}
