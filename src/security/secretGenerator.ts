import { randomBytes } from "crypto";

/** Cryptographically secure device secret - never derived from client input,
 * never predictable. 32 bytes (256 bits) hex-encoded. */
export function generateDeviceSecret(): string {
  return randomBytes(32).toString("hex");
}
