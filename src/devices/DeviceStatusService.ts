/**
 * Device status / presence (architecture v2 §3, §6). Owns the 7-state
 * model (IDLE/STARTING/RUNNING/STOPPING/FAULT/OFFLINE/UNKNOWN) and combines
 * LWT + last telemetry/heartbeat timestamp + retained state so the app
 * never shows a bare "RUNNING" with no freshness context.
 *
 * TODO (Phase 1, next step): applyTelemetry(), applyStateMessage(),
 * applyLwt() -> upsert DeviceStatus via Prisma; getDisplayStatus(deviceId)
 * -> combined state for the API/app.
 */
export class DeviceStatusService {}
