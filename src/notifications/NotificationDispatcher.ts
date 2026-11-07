import { ConfigService } from "../config/ConfigService";

/**
 * Notification Dispatcher (architecture v2 §9, §12). Drains
 * notification_outbox and sends via FCM (free, primary), WhatsApp Cloud API
 * (paid/message) or SMS (paid, requires DLT registration in India), in the
 * order given by ConfigService's notification.channel_priority - channel
 * order and cooldown are DB-tunable, not hardcoded.
 *
 * Acknowledging a notification in the app is handled entirely client-side
 * and must never call back into this module to clear a fault - resolving a
 * FAULT is a separate, explicit action (see architecture v2 §9).
 *
 * TODO (Phase 1, next step): one adapter per channel under
 * src/notifications/channels/{fcm,whatsapp,sms}.ts, a drainOutbox() loop.
 */
export class NotificationDispatcher {
  constructor(private config: ConfigService) {}
}
