/** Command lifecycle (architecture v2 §4). Rank is used to reject an
 * out-of-order/duplicate device response from regressing a command that has
 * already advanced further (e.g. a delayed ACCEPTED arriving after
 * SUCCEEDED already landed). */
export const COMMAND_STATUS_RANK: Record<string, number> = {
  RECEIVED: 0,
  ACCEPTED: 1,
  ACTUATING: 2,
  SUCCEEDED: 3,
  REJECTED: 3,
  FAILED: 3,
  TIMED_OUT: 3,
};

export const TERMINAL_COMMAND_STATUSES = new Set(["SUCCEEDED", "REJECTED", "FAILED", "TIMED_OUT"]);

export function isForwardTransition(current: string, next: string): boolean {
  const currentRank = COMMAND_STATUS_RANK[current] ?? -1;
  const nextRank = COMMAND_STATUS_RANK[next] ?? -1;
  if (TERMINAL_COMMAND_STATUSES.has(current)) return false; // terminal is final
  return nextRank > currentRank;
}
