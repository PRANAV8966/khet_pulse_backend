import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { hasTestDatabase } from "./setup";

describe.skipIf(!hasTestDatabase)("CommandManager concurrency (requires a real database)", () => {
  // Imports deferred until after ./setup has had a chance to point
  // DATABASE_URL at TEST_DATABASE_URL, since the Prisma client reads it at
  // module-load time.
  let prisma: typeof import("../../src/db/prisma").prisma;
  let CommandManager: typeof import("../../src/commands/CommandManager").CommandManager;
  let getConfigService: typeof import("../../src/config/ConfigService").getConfigService;

  const deviceId = `test-device-${Date.now()}`;
  const userId = `test-user-${Date.now()}`;
  const farmId = `test-farm-${Date.now()}`;

  beforeAll(async () => {
    ({ prisma } = await import("../../src/db/prisma"));
    ({ CommandManager } = await import("../../src/commands/CommandManager"));
    ({ getConfigService } = await import("../../src/config/ConfigService"));

    await prisma.user.create({ data: { id: userId } });
    await prisma.farm.create({ data: { id: farmId, ownerUserId: userId, name: "test farm" } });
    await prisma.device.create({ data: { id: deviceId, farmId, name: "test device", hmacSecretRef: "test-secret" } });
  });

  afterAll(async () => {
    await prisma.commandEvent.deleteMany({ where: { command: { deviceId } } });
    await prisma.deviceCommand.deleteMany({ where: { deviceId } });
    await prisma.auditLog.deleteMany({ where: { deviceId } });
    await prisma.device.deleteMany({ where: { id: deviceId } });
    await prisma.farm.deleteMany({ where: { id: farmId } });
    await prisma.user.deleteMany({ where: { id: userId } });
    await prisma.$disconnect();
  });

  it("is idempotent for a repeated commandId - no duplicate row, no new sequence consumed", async () => {
    const config = getConfigService();
    await config.init();
    const manager = new CommandManager(config);

    const commandId = "11111111-1111-1111-1111-111111111111";
    const first = await manager.createCommand({ deviceId, issuedByUserId: userId, action: "SET_MOTOR_STATE", desiredState: "ON", commandId });
    const second = await manager.createCommand({ deviceId, issuedByUserId: userId, action: "SET_MOTOR_STATE", desiredState: "ON", commandId });

    expect(second.id).toBe(first.id);
    expect(second.sequence).toBe(first.sequence);

    const count = await prisma.deviceCommand.count({ where: { id: commandId } });
    expect(count).toBe(1);
  });

  it("never assigns a colliding sequence under concurrent requests for the same device", async () => {
    const config = getConfigService();
    const manager = new CommandManager(config);

    const results = await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        manager.createCommand({
          deviceId,
          issuedByUserId: userId,
          action: "SET_MOTOR_STATE",
          desiredState: i % 2 === 0 ? "ON" : "OFF",
        })
      )
    );

    const sequences = results.map((r) => r.sequence);
    expect(new Set(sequences).size).toBe(sequences.length); // all unique
  });
});
