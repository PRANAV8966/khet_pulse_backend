/** An old command must never execute after a late reconnect (architecture v2
 * §4) - pulled out as a pure function so the boundary condition is testable
 * without a database. */
export function computeExpiresAt(issuedAt: Date, expirySeconds: number): Date {
  return new Date(issuedAt.getTime() + expirySeconds * 1000);
}

export function isExpired(expiresAt: Date, now: Date = new Date()): boolean {
  return now.getTime() > expiresAt.getTime();
}
