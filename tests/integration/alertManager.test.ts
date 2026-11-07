import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { hasTestDatabase } from "./setup";

describe.skipIf(!hasTestDatabase)("AlertManager fault dedup (requires a real database)", () => {
  let prisma: typeof import("../../src/db/prisma").prisma;
  let AlertManager: typeof import("../../src/alerts/AlertManager").AlertManager;
  let getConfigService: typeof import("../../src/config/ConfigService").getConfigService;

  const deviceId = `test-device-${Date.now()}`;
  const userId = `test-user-${Date.now()}`;
  const farmId = `test-farm-${Date.now()}`;
  const faultType = "DRY_RUN_DETECTED";

  beforeAll(async () => {
    ({ prisma } = await import("../../src/db/prisma"));
    ({ AlertManager } = await import("../../src/alerts/AlertManager"));
    ({ getConfigService } = await import("../../src/config/ConfigService"));

    await prisma.user.create({ data: { id: userId } });
    await prisma.farm.create({ data: { id: farmId, ownerUserId: userId, name: "test farm" } });
    await prisma.device.create({ data: { id: deviceId, farmId, name: "test device", hmacSecretRef: "test-secret" } });
  });

  afterAll(async () => {
    await prisma.notificationOutbox.deleteMany({ where: { deviceId } });
    await prisma.faultEvent.deleteMany({ where: { deviceId } });
    await prisma.device.deleteMany({ where: { id: deviceId } });
    await prisma.farm.deleteMany({ where: { id: farmId } });
    await prisma.user.deleteMany({ where: { id: userId } });
    await prisma.$disconnect();
  });

  it("creates exactly one fault_event under 10 concurrent first-time recordFault calls (partial unique index race)", async () => {
    const config = getConfigService();
    await config.init();
    const manager = new AlertManager(config);

    await Promise.all(Array.from({ length: 10 }, () => manager.recordFault(deviceId, faultType, { note: "concurrent" })));

    const faultEvents = await prisma.faultEvent.count({ where: { deviceId, type: faultType, resolvedAt: null } });
    expect(faultEvents).toBe(1);

    // Exactly one notification should have gone out for the first
    // occurrence, never delayed/dropped, and never duplicated by the race.
    const outboxRows = await prisma.notificationOutbox.count({ where: { deviceId } });
    expect(outboxRows).toBe(1);
  });

  it("dedupes a repeat within the cooldown window (no new outbox row)", async () => {
    const config = getConfigService();
    const manager = new AlertManager(config);

    const before = await prisma.notificationOutbox.count({ where: { deviceId } });
    await manager.recordFault(deviceId, faultType, { note: "repeat within cooldown" });
    const after = await prisma.notificationOutbox.count({ where: { deviceId } });

    expect(after).toBe(before); // default cooldown is 600s - this repeat is well within it
  });

  it("stops escalating once resolved - a fresh fault after resolution creates a new fault_event", async () => {
    const config = getConfigService();
    const manager = new AlertManager(config);

    await manager.resolveFault(deviceId, faultType);
    const unresolvedAfterResolve = await prisma.faultEvent.count({ where: { deviceId, type: faultType, resolvedAt: null } });
    expect(unresolvedAfterResolve).toBe(0);

    await manager.recordFault(deviceId, faultType, { note: "new episode" });
    const unresolvedAfterNew = await prisma.faultEvent.count({ where: { deviceId, type: faultType, resolvedAt: null } });
    expect(unresolvedAfterNew).toBe(1);
  });
});
