import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { hasTestDatabase } from "./setup";

describe.skipIf(!hasTestDatabase)("FarmService / DeviceService (requires a real database)", () => {
  let prisma: typeof import("../../src/db/prisma").prisma;
  let FarmService: typeof import("../../src/farms/FarmService").FarmService;
  let DeviceService: typeof import("../../src/devices/DeviceService").DeviceService;

  const userId = `test-user-${Date.now()}`;
  const otherUserId = `test-other-user-${Date.now()}`;

  beforeAll(async () => {
    ({ prisma } = await import("../../src/db/prisma"));
    ({ FarmService } = await import("../../src/farms/FarmService"));
    ({ DeviceService } = await import("../../src/devices/DeviceService"));
    await prisma.user.create({ data: { id: userId } });
    await prisma.user.create({ data: { id: otherUserId } });
  });

  afterAll(async () => {
    await prisma.device.deleteMany({ where: { farm: { ownerUserId: { in: [userId, otherUserId] } } } });
    await prisma.farm.deleteMany({ where: { ownerUserId: { in: [userId, otherUserId] } } });
    await prisma.user.deleteMany({ where: { id: { in: [userId, otherUserId] } } });
    await prisma.$disconnect();
  });

  it("creates exactly one farm under 10 concurrent requests with the same client-supplied id", async () => {
    const farms = new FarmService();
    const id = "22222222-2222-2222-2222-222222222222";

    const results = await Promise.all(
      Array.from({ length: 10 }, () => farms.createFarm({ ownerUserId: userId, name: "Demo Farm", id }))
    );

    expect(new Set(results.map((r) => r.id)).size).toBe(1);
    const count = await prisma.farm.count({ where: { id } });
    expect(count).toBe(1);
  });

  it("returns the hmac secret only on first create, never on an idempotent replay", async () => {
    const devices = new DeviceService();
    const farm = await prisma.farm.create({ data: { ownerUserId: userId, name: "Secret Test Farm" } });
    const id = "33333333-3333-3333-3333-333333333333";

    const first = await devices.createDevice({ farmId: farm.id, name: "Pump", id });
    const replay = await devices.createDevice({ farmId: farm.id, name: "Pump", id });

    expect(first.hmacSecret).toMatch(/^[0-9a-f]{64}$/);
    expect(replay.hmacSecret).toBeNull();
    expect(replay.id).toBe(first.id);
  });

  it("never includes the hmac secret in the device list", async () => {
    const devices = new DeviceService();
    const farm = await prisma.farm.create({ data: { ownerUserId: userId, name: "List Test Farm" } });
    await devices.createDevice({ farmId: farm.id, name: "Pump A" });

    const list = await devices.listDevices(farm.id);
    for (const device of list) {
      expect(device).not.toHaveProperty("hmacSecret");
      expect(device).not.toHaveProperty("hmacSecretRef");
    }
  });
});
