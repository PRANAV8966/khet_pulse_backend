import { z } from "zod";

/**
 * Wire contract between backend and device (architecture v2 §1, §4, §6).
 * Topic layout: dt/farm/{deviceId}/{telemetry|state|alert|lwt|cmd/req|cmd/resp}
 *
 * Simplifications vs. a literal reading of the doc, both to avoid inventing
 * topics beyond the four the doc names:
 *  - "Publish ONLINE (retained) on connect" is realized by the device
 *    publishing its current verified state on `state` immediately on
 *    connect/reconnect - that reconcile-to-actual-state message IS the
 *    online signal (matches the state diagram's "reconnect, reconcile to
 *    actual reported state" transition), no separate topic needed.
 *  - "Publish a periodic heartbeat even when telemetry has nothing new" is
 *    realized by treating every `telemetry` message as the heartbeat signal
 *    (lastHeartbeatAt and lastTelemetryAt are updated together) rather than
 *    a separate heartbeat topic.
 */

export const DEVICE_STATES = ["IDLE", "STARTING", "RUNNING", "STOPPING", "FAULT", "UNKNOWN"] as const;
export type DeviceState = (typeof DEVICE_STATES)[number];

export const COMMAND_RESPONSE_STATUSES = ["ACCEPTED", "ACTUATING", "SUCCEEDED", "REJECTED", "FAILED"] as const;
export type CommandResponseStatus = (typeof COMMAND_RESPONSE_STATUSES)[number];

export const telemetrySchema = z.object({
  voltageA: z.number().optional(),
  voltageB: z.number().optional(),
  voltageC: z.number().optional(),
  currentA: z.number().optional(),
  currentB: z.number().optional(),
  currentC: z.number().optional(),
  ts: z.number(), // unix seconds, device's own clock
});
export type TelemetryPayload = z.infer<typeof telemetrySchema>;

export const stateSchema = z.object({
  state: z.enum(DEVICE_STATES),
  ts: z.number(),
});
export type StatePayload = z.infer<typeof stateSchema>;

export const alertSchema = z.object({
  type: z.string().min(1),
  detail: z.record(z.unknown()).optional(),
  ts: z.number(),
});
export type AlertPayload = z.infer<typeof alertSchema>;

export const lwtSchema = z.object({
  ts: z.number().optional(),
});
export type LwtPayload = z.infer<typeof lwtSchema>;

export const commandResponseSchema = z.object({
  command_id: z.string().uuid(),
  status: z.enum(COMMAND_RESPONSE_STATUSES),
  note: z.string().optional(),
  ts: z.number(),
});
export type CommandResponsePayload = z.infer<typeof commandResponseSchema>;

export const commandRequestSchema = z.object({
  command_id: z.string().uuid(),
  device_id: z.string(),
  action: z.literal("SET_MOTOR_STATE"),
  desired_state: z.enum(["ON", "OFF"]),
  sequence: z.number().int().nonnegative(),
  issued_at: z.number(),
  expires_at: z.number(),
  hmac: z.string(),
});
export type CommandRequestPayload = z.infer<typeof commandRequestSchema>;

export const topics = {
  telemetry: (deviceId: string) => `dt/farm/${deviceId}/telemetry`,
  state: (deviceId: string) => `dt/farm/${deviceId}/state`,
  alert: (deviceId: string) => `dt/farm/${deviceId}/alert`,
  lwt: (deviceId: string) => `dt/farm/${deviceId}/lwt`,
  cmdReq: (deviceId: string) => `dt/farm/${deviceId}/cmd/req`,
  cmdResp: (deviceId: string) => `dt/farm/${deviceId}/cmd/resp`,
  // Subscription wildcards for the backend.
  telemetryWildcard: "dt/farm/+/telemetry",
  stateWildcard: "dt/farm/+/state",
  alertWildcard: "dt/farm/+/alert",
  lwtWildcard: "dt/farm/+/lwt",
  cmdRespWildcard: "dt/farm/+/cmd/resp",
};

/** Extracts the deviceId from a concrete (non-wildcard) topic of the form dt/farm/{id}/... */
export function deviceIdFromTopic(topic: string): string | null {
  const match = topic.match(/^dt\/farm\/([^/]+)\//);
  return match ? match[1] : null;
}
