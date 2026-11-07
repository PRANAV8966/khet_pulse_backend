import { ConfigService } from "../config/ConfigService";

/**
 * Alert Manager (architecture v2 §9). Writes fault_events + a
 * notification_outbox row in the same transaction before any dispatch is
 * attempted, so a crash in between can't silently lose an alert. Cooldown
 * window comes from ConfigService (notification.fault_cooldown_seconds) -
 * dedupe repeats of the same ongoing fault, never delay/drop the first one.
 *
 * TODO (Phase 1, next step): recordFault(), cooldown check against the
 * most recent unresolved fault_event of the same type+device.
 */
export class AlertManager {
  constructor(private config: ConfigService) {}
}
