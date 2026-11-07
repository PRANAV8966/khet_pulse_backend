import { describe, it, expect } from "vitest";
import { generateDeviceSecret } from "../../src/security/secretGenerator";

describe("generateDeviceSecret", () => {
  it("produces a 64-char hex string (32 bytes)", () => {
    const secret = generateDeviceSecret();
    expect(secret).toMatch(/^[0-9a-f]{64}$/);
  });

  it("is not deterministic/predictable across calls", () => {
    const a = generateDeviceSecret();
    const b = generateDeviceSecret();
    expect(a).not.toBe(b);
  });
});
