import { randomUUID } from "crypto";
import { prisma } from "../db/prisma";
import { isUniqueViolation } from "../db/errors";
import { ConflictError } from "../errors";
import { DeviceSummary, DeviceCreated, TelemetryPoint, FaultEventSummary } from "../dto/deviceDto";
import { resolvePageSize, nextCursor } from "../dto/pagination";
import { generateDeviceSecret } from "../security/secretGenerator";

function toSummary(row: { id: string; name: string; deviceType: string; createdAt: Date }): DeviceSummary {
  return { id: row.id, name: row.name, deviceType: row.deviceType, createdAt: row.createdAt.toISOString() };
}

export interface CreateDeviceInput {
  farmId: string;
  name: string;
  deviceType?: string;
  id?: string; // client-supplied idempotency key
}

/**
 * Device management (create/list/history) - distinct from DeviceStatusService,
 * which owns live state/presence. hmacSecretRef is generated here with
 * crypto.randomBytes, never accepted as client input (a client could
 * otherwise register a device with a guessable/attacker-known secret), and
 * is returned exactly once, in the create response - never again afterward.
 */
export class DeviceService {
  async createDevice(input: CreateDeviceInput): Promise<DeviceCreated> {
    const id = input.id ?? randomUUID();

    if (input.id) {
      const existing = await prisma.device.findUnique({ where: { id } });
      if (existing) {
        if (existing.farmId !== input.farmId) {
          throw new ConflictError("id already used for a different farm");
        }
        // Idempotent replay - the secret was already shown once on the
        // original create and is deliberately NOT re-returned here, even to
        // the same caller, since we can't distinguish "lost the response,
        // safe to resend" from "secret already flashed to hardware, must
        // not be re-exposed." The client must treat a replay as "already
        // registered" and should not expect the secret a second time.
        return { ...toSummary(existing), hmacSecret: null };
      }
    }

    const hmacSecretRef = generateDeviceSecret();

    try {
      const created = await prisma.device.create({
        data: { id, farmId: input.farmId, name: input.name, deviceType: input.deviceType ?? "motor_controller", hmacSecretRef },
      });
      return { ...toSummary(created), hmacSecret: hmacSecretRef };
    } catch (err) {
      if (!isUniqueViolation(err)) throw err;
      const existing = await prisma.device.findUnique({ where: { id } });
      if (existing) return { ...toSummary(existing), hmacSecret: null };
      throw err;
    }
  }

  async listDevices(farmId: string): Promise<DeviceSummary[]> {
    const rows = await prisma.device.findMany({ where: { farmId }, orderBy: { createdAt: "asc" } });
    return rows.map(toSummary);
  }

  async getTelemetryPage(deviceId: string, take?: number, before?: Date): Promise<{ items: TelemetryPoint[]; nextCursor: string | null }> {
    const pageSize = resolvePageSize(take);
    const rows = await prisma.telemetry.findMany({
      where: { deviceId, ...(before ? { recordedAt: { lt: before } } : {}) },
      orderBy: { recordedAt: "desc" },
      take: pageSize,
    });
    const items: TelemetryPoint[] = rows.map((r) => ({
      voltageA: r.voltageA,
      voltageB: r.voltageB,
      voltageC: r.voltageC,
      currentA: r.currentA,
      currentB: r.currentB,
      currentC: r.currentC,
      recordedAt: r.recordedAt.toISOString(),
    }));
    return { items, nextCursor: nextCursor(rows, pageSize, (r) => r.recordedAt) };
  }

  async getFaultsPage(deviceId: string, take?: number, before?: Date): Promise<{ items: FaultEventSummary[]; nextCursor: string | null }> {
    const pageSize = resolvePageSize(take);
    const rows = await prisma.faultEvent.findMany({
      where: { deviceId, ...(before ? { createdAt: { lt: before } } : {}) },
      orderBy: { createdAt: "desc" },
      take: pageSize,
    });
    const items: FaultEventSummary[] = rows.map((r) => ({
      id: r.id.toString(),
      type: r.type,
      detail: r.detail,
      createdAt: r.createdAt.toISOString(),
      resolvedAt: r.resolvedAt ? r.resolvedAt.toISOString() : null,
    }));
    return { items, nextCursor: nextCursor(rows, pageSize, (r) => r.createdAt) };
  }
}
