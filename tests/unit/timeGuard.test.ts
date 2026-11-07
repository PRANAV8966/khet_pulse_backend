import { describe, it, expect } from "vitest";
import { isAtLeastAsNew } from "../../src/devices/timeGuard";

describe("isAtLeastAsNew (out-of-order MQTT guard)", () => {
  it("accepts the first message when nothing is recorded yet", () => {
    expect(isAtLeastAsNew(new Date("2026-01-01T00:00:00Z"), null)).toBe(true);
  });

  it("accepts a message newer than the current one", () => {
    expect(isAtLeastAsNew(new Date("2026-01-01T00:00:10Z"), new Date("2026-01-01T00:00:00Z"))).toBe(true);
  });

  it("accepts a message with the exact same timestamp (duplicate delivery)", () => {
    const t = new Date("2026-01-01T00:00:00Z");
    expect(isAtLeastAsNew(t, t)).toBe(true);
  });

  it("rejects a delayed/out-of-order message older than the current one", () => {
    expect(isAtLeastAsNew(new Date("2026-01-01T00:00:00Z"), new Date("2026-01-01T00:00:10Z"))).toBe(false);
  });
});
