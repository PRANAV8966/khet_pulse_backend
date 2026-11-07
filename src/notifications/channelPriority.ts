/** Picks the channel for the Nth notification attempt on a given fault,
 * stepping through notification.channel_priority (e.g. FCM -> WhatsApp ->
 * SMS) and staying on the last channel once exhausted, rather than erroring
 * or wrapping back to the start. */
export function channelForAttempt(priority: string[], attemptIndex: number): string {
  if (priority.length === 0) throw new Error("notification.channel_priority is empty");
  return priority[Math.min(attemptIndex, priority.length - 1)];
}
