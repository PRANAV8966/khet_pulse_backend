import { Prisma } from "@prisma/client";
import { prisma } from "../db/prisma";
import { ConfigService } from "../config/ConfigService";
import { channelForAttempt } from "../notifications/channelPriority";
import { isUniqueViolation } from "../db/errors";

/**
 * Alert Manager (architecture v2 §9). Writes fault_events + a
 * notification_outbox row in the same transaction before any dispatch is
 * attempted, so a crash in between can't silently lose an alert.
 *
 * At most one UNRESOLVED fault_event per (deviceId, type) is enforced by a
 * Postgres partial unique index (prisma/sql/fault_events_unresolved_unique.sql)
 * - two concurrent recordFault() calls for a brand-new fault race the
 * database itself, not an application-level check, so exactly one wins.
 *
 * The first occurrence of a fault is always notified immediately, never
 * delayed by the cooldown. Repeat notifications for the same still-unresolved
 * fault are deduped within notification.fault_cooldown_seconds and escalate
 * one step through notification.channel_priority per repeat that does fire
 * (e.g. FCM -> WhatsApp -> SMS) - derived from existing notification_outbox
 * rows, no extra "last notified" column needed.
 */
export class AlertManager {
  constructor(private config: ConfigService) {}

  async recordFault(deviceId: string, type: string, detail?: Record<string, unknown>): Promise<void> {
    const priority = this.config.get<string[]>("notification.channel_priority", ["fcm", "whatsapp", "sms"]);

    try {
      await prisma.$transaction(async (tx) => {
        const created = await tx.faultEvent.create({
          data: { deviceId, type, detail: (detail ?? {}) as Prisma.InputJsonObject },
        });
        await tx.notificationOutbox.create({
          data: {
            eventType: type,
            deviceId,
            faultEventId: created.id,
            payload: { type, detail: detail ?? {} } as Prisma.InputJsonObject,
            channel: priority[0],
          },
        });
      });
      return; // first occurrence - handled
    } catch (err) {
      if (!isUniqueViolation(err)) throw err;
      // Lost the race (or a genuinely ongoing fault) - fall through to the
      // repeat/escalation path below.
    }

    const cooldownSeconds = this.config.get<number>("notification.fault_cooldown_seconds", 600);
    const faultEvent = await prisma.faultEvent.findFirst({
      where: { deviceId, type, resolvedAt: null },
      orderBy: { createdAt: "desc" },
    });
    if (!faultEvent) return; // resolved concurrently between our attempts - nothing to escalate

    await prisma.$transaction(async (tx) => {
      const priorCount = await tx.notificationOutbox.count({ where: { faultEventId: faultEvent.id } });
      const last = await tx.notificationOutbox.findFirst({
        where: { faultEventId: faultEvent.id },
        orderBy: { createdAt: "desc" },
      });
      if (last && (Date.now() - last.createdAt.getTime()) / 1000 < cooldownSeconds) {
        return; // dedupe within cooldown - never drop/delay the first occurrence, this isn't it
      }
      const channel = channelForAttempt(priority, priorCount);
      await tx.notificationOutbox.create({
        data: {
          eventType: type,
          deviceId,
          faultEventId: faultEvent.id,
          payload: { type, detail: detail ?? {} } as Prisma.InputJsonObject,
          channel,
        },
      });
    });
  }

  /** Explicit, separate from any notification acknowledgement in the app -
   * a farmer dismissing a push must never clear a FAULT (architecture v2
   * §9). Only the device reporting recovery (via DeviceStatusService) calls
   * this. */
  async resolveFault(deviceId: string, type: string): Promise<void> {
    await prisma.faultEvent.updateMany({
      where: { deviceId, type, resolvedAt: null },
      data: { resolvedAt: new Date() },
    });
  }
}
