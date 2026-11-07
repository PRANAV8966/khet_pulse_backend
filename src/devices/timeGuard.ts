/** Out-of-order guard: a message is only applied if its own timestamp is at
 * least as new as the one already recorded - a delayed/reordered MQTT
 * delivery can never regress a fresher known state (architecture v2 §6). */
export function isAtLeastAsNew(candidateTs: Date, currentTs: Date | null): boolean {
  if (!currentTs) return true;
  return candidateTs.getTime() >= currentTs.getTime();
}
