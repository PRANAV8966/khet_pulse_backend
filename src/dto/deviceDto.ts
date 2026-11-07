import { z } from "zod";

export const createDeviceRequestSchema = z.object({
  name: z.string().trim().min(1).max(200),
  deviceType: z.string().trim().min(1).max(100).optional(),
  id: z.string().uuid().optional(), // client-supplied idempotency key, same pattern as commandId
});
export type CreateDeviceRequestDto = z.infer<typeof createDeviceRequestSchema>;

export interface DeviceSummary {
  id: string;
  name: string;
  deviceType: string;
  createdAt: string;
}

/** Only returned from the create endpoint - hmacSecret is never included in
 * any other response (list/get), and is not retrievable again afterward.
 * null specifically means "this was an idempotent replay of an earlier
 * create - the secret was already shown once and is deliberately not
 * re-exposed," distinct from the normal case where it's always present. */
export interface DeviceCreated extends DeviceSummary {
  hmacSecret: string | null;
}

export interface TelemetryPoint {
  voltageA: number | null;
  voltageB: number | null;
  voltageC: number | null;
  currentA: number | null;
  currentB: number | null;
  currentC: number | null;
  recordedAt: string;
}

export interface FaultEventSummary {
  id: string;
  type: string;
  detail: unknown;
  createdAt: string;
  resolvedAt: string | null;
}
