import { createHmac, timingSafeEqual } from "crypto";

/**
 * HMAC-SHA256 over the exact field set from architecture v2 §4/§5 - bound to
 * device id, action, desired state, sequence and expiry (not a raw payload
 * hash), so a signature can't be replayed against a different field
 * combination. This gives authentication/integrity only, never
 * confidentiality (see §5) - it does not hide payload contents on the wire.
 */
export interface SignableCommand {
  deviceId: string;
  action: string;
  desiredState: string;
  sequence: number;
  expiresAt: number; // unix seconds
}

function canonicalPayload(cmd: SignableCommand): string {
  return `${cmd.deviceId}|${cmd.action}|${cmd.desiredState}|${cmd.sequence}|${cmd.expiresAt}`;
}

export function sign(cmd: SignableCommand, secret: string): string {
  return createHmac("sha256", secret).update(canonicalPayload(cmd)).digest("hex");
}

/** Timing-safe verification - never short-circuit on a byte mismatch. */
export function verify(cmd: SignableCommand, secret: string, signature: string): boolean {
  const expected = Buffer.from(sign(cmd, secret), "hex");
  let provided: Buffer;
  try {
    provided = Buffer.from(signature, "hex");
  } catch {
    return false;
  }
  if (expected.length !== provided.length) return false;
  return timingSafeEqual(expected, provided);
}
