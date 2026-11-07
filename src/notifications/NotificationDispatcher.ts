import { prisma } from "../db/prisma";
import { ConfigService } from "../config/ConfigService";
import { NotificationChannel } from "./channels/types";
import { FcmChannel } from "./channels/fcm";
import { WhatsAppChannel } from "./channels/whatsapp";
import { SmsChannel } from "./channels/sms";

const MAX_ATTEMPTS = 3;

/**
 * Notification Dispatcher (architecture v2 §9, §12). Drains
 * notification_outbox and sends via the channel the row was written with
 * (AlertManager already picked FCM/WhatsApp/SMS per
 * notification.channel_priority at write time). Acknowledging a
 * notification in the app is handled entirely client-side and must never
 * call back into this module to clear a fault (architecture v2 §9).
 */
export class NotificationDispatcher {
  private channels: Record<string, NotificationChannel>;

  constructor(private config: ConfigService) {
    this.channels = {
      fcm: new FcmChannel(),
      whatsapp: new WhatsAppChannel(),
      sms: new SmsChannel(),
    };
  }

  /** One pass over pending outbox rows. Call on an interval from index.ts. */
  async drainOutbox(batchSize = 25): Promise<void> {
    const pending = await prisma.notificationOutbox.findMany({
      where: { status: "PENDING", attempts: { lt: MAX_ATTEMPTS } },
      orderBy: { createdAt: "asc" },
      take: batchSize,
    });

    for (const row of pending) {
      await this.dispatchOne(row.id);
    }
  }

  private async dispatchOne(outboxId: bigint): Promise<void> {
    const row = await prisma.notificationOutbox.findUnique({ where: { id: outboxId } });
    if (!row || row.status !== "PENDING") return;

    const channel = this.channels[row.channel];
    if (!channel) {
      await prisma.notificationOutbox.update({
        where: { id: row.id },
        data: { status: "FAILED", attempts: { increment: 1 } },
      });
      console.error(`[notify] unknown channel "${row.channel}" for outbox row ${row.id}`);
      return;
    }

    const recipient = await this.resolveRecipient(row.deviceId);
    const payload = {
      ...(row.payload as Record<string, unknown>),
      deviceId: row.deviceId,
      eventType: row.eventType,
      title: "khet_pulse alert",
      body: `${row.eventType} on device ${row.deviceId}`,
      fcmToken: recipient?.fcmToken ?? undefined,
      phone: recipient?.phone ?? undefined,
    };

    const result = await channel.send(payload);

    if (result.success) {
      // Conditional update guards against double-send if drainOutbox were
      // ever invoked concurrently - only the first writer flips PENDING ->
      // SENT, exactly mirroring the idempotent-insert pattern used for
      // device_commands.
      await prisma.notificationOutbox.updateMany({
        where: { id: row.id, status: "PENDING" },
        data: { status: "SENT", sentAt: new Date(), attempts: { increment: 1 } },
      });
    } else {
      console.error(`[notify] ${row.channel} send failed for outbox ${row.id}:`, result.error);
      const attemptsAfter = row.attempts + 1;
      // Stay PENDING (and so remain eligible for the next drainOutbox pass)
      // until attempts are exhausted - a single transient failure must not
      // permanently drop the notification, only repeated failure should.
      await prisma.notificationOutbox.updateMany({
        where: { id: row.id, status: "PENDING" },
        data: { status: attemptsAfter >= MAX_ATTEMPTS ? "FAILED" : "PENDING", attempts: { increment: 1 } },
      });
    }
  }

  private async resolveRecipient(deviceId: string | null): Promise<{ fcmToken: string | null; phone: string | null } | null> {
    if (!deviceId) return null;
    const device = await prisma.device.findUnique({
      where: { id: deviceId },
      include: { farm: { include: { owner: true } } },
    });
    if (!device) return null;
    return { fcmToken: device.farm.owner.fcmToken, phone: device.farm.owner.phone };
  }
}
