import { describe, it, expect } from "vitest";
import { sign, verify, SignableCommand } from "../../src/security/hmac";

const base: SignableCommand = {
  deviceId: "sim-device-001",
  action: "SET_MOTOR_STATE",
  desiredState: "ON",
  sequence: 42,
  expiresAt: 1_794_050_060,
};

describe("hmac sign/verify", () => {
  it("verifies a signature produced with the same secret and fields", () => {
    const sig = sign(base, "secret-a");
    expect(verify(base, "secret-a", sig)).toBe(true);
  });

  it("rejects a signature produced with a different secret", () => {
    const sig = sign(base, "secret-a");
    expect(verify(base, "secret-b", sig)).toBe(false);
  });

  it("rejects if any bound field is tampered with (mix-and-match replay)", () => {
    const sig = sign(base, "secret-a");
    expect(verify({ ...base, desiredState: "OFF" }, "secret-a", sig)).toBe(false);
    expect(verify({ ...base, sequence: 43 }, "secret-a", sig)).toBe(false);
    expect(verify({ ...base, expiresAt: base.expiresAt + 1 }, "secret-a", sig)).toBe(false);
    expect(verify({ ...base, deviceId: "other-device" }, "secret-a", sig)).toBe(false);
  });

  it("rejects a malformed (non-hex) signature instead of throwing", () => {
    expect(verify(base, "secret-a", "not-hex-!!")).toBe(false);
  });

  it("rejects a signature of the wrong length", () => {
    const sig = sign(base, "secret-a");
    expect(verify(base, "secret-a", sig.slice(0, -2))).toBe(false);
  });
});
