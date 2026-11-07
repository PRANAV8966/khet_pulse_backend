import { ConfigService } from "../config/ConfigService";

/**
 * Command Manager (architecture v2 §4). Desired-state commands, not
 * toggles - a retried/duplicated delivery is a safe no-op. Expiry and HMAC
 * replay-window length come from ConfigService (command.expiry_seconds,
 * command.replay_window_seconds), never hardcoded, so they're tunable live.
 *
 * TODO (Phase 1, next step): createCommand() -> persist via Prisma
 * (DeviceCommand, id = UUID = idempotency key), sign with per-device HMAC,
 * publish via MqttClient; handleCommandResponse() -> update status/
 * CommandEvent from the device's cmd/resp.
 */
export class CommandManager {
  constructor(private config: ConfigService) {}
}
