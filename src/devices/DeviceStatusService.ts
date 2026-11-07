import { prisma } from "../db/prisma";
import { ConfigService } from "../config/ConfigService";
import { TelemetryPayload, StatePayload } from "../mqtt/payloads";
import { NotFoundError } from "../errors";
import { isAtLeastAsNew } from "./timeGuard";

export interface DisplayStatus {
  deviceId: string;
  state: string;
  isConnected: boolean;
  lastHeartbeatAt: string | null;
  ageSeconds: number | null;
  /** True once last-seen is older than ~1.5x the expected heartbeat interval,
   * even if no LWT has fired yet (architecture v2 §6 - LWT can lag). */
  stale: boolean;
}

/**
 * Device status / presence (architecture v2 §3, §6). `state` always holds
 * the last VERIFIED physical/command state - never the literal "OFFLINE".
 * Connectivity is tracked separately via `isConnected` so a disconnected
 * device still shows its last known state with its age, never a bare state
 * with no freshness context.
 */
export class DeviceStatusService {
  constructor(private config: ConfigService) {}

  async applyTelemetry(deviceId: string, payload: TelemetryPayload): Promise<void> {
    const ts = new Date(payload.ts * 1000);

    await prisma.telemetry.create({
      data: {
        deviceId,
        voltageA: payload.voltageA,
        voltageB: payload.voltageB,
        voltageC: payload.voltageC,
        currentA: payload.currentA,
        currentB: payload.currentB,
        currentC: payload.currentC,
        recordedAt: ts,
      },
    });

    // Telemetry doubles as the heartbeat signal (see payloads.ts header
    // comment) - connected is always set true (any telemetry means the
    // device is reachable right now), but lastHeartbeatAt/lastTelemetryAt
    // only advance if this message is at least as new as what's already
    // recorded - otherwise a delayed/duplicate telemetry delivery with an
    // older timestamp would regress the freshness clock backward and make
    // a currently-live device look stale.
    const existing = await prisma.deviceStatus.findUnique({ where: { deviceId } });
    if (isAtLeastAsNew(ts, existing?.lastHeartbeatAt ?? null)) {
      await prisma.deviceStatus.upsert({
        where: { deviceId },
        create: { deviceId, isConnected: true, lastHeartbeatAt: ts, lastTelemetryAt: ts },
        update: { isConnected: true, lastHeartbeatAt: ts, lastTelemetryAt: ts },
      });
    } else {
      await prisma.deviceStatus.upsert({
        where: { deviceId },
        create: { deviceId, isConnected: true },
        update: { isConnected: true },
      });
    }
  }

  async applyStateMessage(deviceId: string, payload: StatePayload): Promise<void> {
    const ts = new Date(payload.ts * 1000);

    const existing = await prisma.deviceStatus.findUnique({ where: { deviceId } });
    if (!isAtLeastAsNew(ts, existing?.stateAt ?? null)) {
      // Stale/out-of-order message - drop it, never regress a newer state.
      return;
    }

    await prisma.deviceStatus.upsert({
      where: { deviceId },
      create: {
        deviceId,
        state: payload.state,
        stateAt: ts,
        isConnected: true,
        lastHeartbeatAt: ts,
      },
      update: {
        state: payload.state,
        stateAt: ts,
        isConnected: true,
        lastHeartbeatAt: ts,
      },
    });
  }

  /** LWT fired - the broker believes the device disconnected. Only flips
   * connectivity; the last verified `state` is left untouched so the UI can
   * still show it (architecture v2 §6). */
  async applyLwt(deviceId: string): Promise<void> {
    await prisma.deviceStatus.upsert({
      where: { deviceId },
      create: { deviceId, isConnected: false },
      update: { isConnected: false },
    });
  }

  async getDisplayStatus(deviceId: string): Promise<DisplayStatus> {
    const row = await prisma.deviceStatus.findUnique({ where: { deviceId } });
    if (!row) {
      const device = await prisma.device.findUnique({ where: { id: deviceId } });
      if (!device) throw new NotFoundError(`Device ${deviceId} not found`);
      return { deviceId, state: "UNKNOWN", isConnected: false, lastHeartbeatAt: null, ageSeconds: null, stale: true };
    }

    const heartbeatIntervalSeconds = this.config.get<number>("device.heartbeat_interval_seconds", 60);
    const ageSeconds = row.lastHeartbeatAt ? (Date.now() - row.lastHeartbeatAt.getTime()) / 1000 : null;
    // LWT can lag the real disconnect by up to 1.5x the keep-alive interval
    // (architecture v2 §6) - treat staleness past that window as offline
    // even if the broker hasn't fired LWT yet.
    const stale = ageSeconds === null || ageSeconds > heartbeatIntervalSeconds * 1.5;

    return {
      deviceId,
      state: row.state,
      isConnected: row.isConnected && !stale,
      lastHeartbeatAt: row.lastHeartbeatAt ? row.lastHeartbeatAt.toISOString() : null,
      ageSeconds,
      stale,
    };
  }
}
