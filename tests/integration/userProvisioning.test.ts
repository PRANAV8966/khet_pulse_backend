import { describe, it, expect, afterAll } from "vitest";
import { hasTestDatabase } from "./setup";

// Tests the actual DB-level mechanism requireAuth's ensureUserProvisioned()
// relies on (prisma.user.upsert by id) directly, rather than mocking
// Firebase token verification just to exercise the same Postgres call -
// the concurrency property under test is Prisma+Postgres behavior, not
// anything Firebase-specific.
describe.skipIf(!hasTestDatabase)("user provisioning upsert race (requires a real database)", () => {
  let prisma: typeof import("../../src/db/prisma").prisma;
  const userId = `test-provision-user-${Date.now()}`;

  afterAll(async () => {
    const { prisma: p } = await import("../../src/db/prisma");
    await p.user.deleteMany({ where: { id: userId } });
    await p.$disconnect();
  });

  it("creates exactly one row under 10 concurrent first-time upserts for the same uid", async () => {
    ({ prisma } = await import("../../src/db/prisma"));

    await Promise.all(
      Array.from({ length: 10 }, () =>
        prisma.user.upsert({ where: { id: userId }, create: { id: userId }, update: {} })
      )
    );

    const count = await prisma.user.count({ where: { id: userId } });
    expect(count).toBe(1);
  });
});
