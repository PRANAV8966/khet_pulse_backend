import { describe, it, expect } from "vitest";
import { computeExpiresAt, isExpired } from "../../src/commands/expiry";

describe("command expiry", () => {
  it("computes expiresAt as issuedAt + expirySeconds", () => {
    const issuedAt = new Date("2026-01-01T00:00:00.000Z");
    const expiresAt = computeExpiresAt(issuedAt, 60);
    expect(expiresAt.toISOString()).toBe("2026-01-01T00:01:00.000Z");
  });

  it("is not expired before expiresAt", () => {
    const expiresAt = new Date("2026-01-01T00:01:00.000Z");
    expect(isExpired(expiresAt, new Date("2026-01-01T00:00:59.000Z"))).toBe(false);
  });

  it("is not expired exactly at expiresAt (strict greater-than)", () => {
    const expiresAt = new Date("2026-01-01T00:01:00.000Z");
    expect(isExpired(expiresAt, expiresAt)).toBe(false);
  });

  it("is expired just after expiresAt", () => {
    const expiresAt = new Date("2026-01-01T00:01:00.000Z");
    expect(isExpired(expiresAt, new Date("2026-01-01T00:01:00.001Z"))).toBe(true);
  });
});
