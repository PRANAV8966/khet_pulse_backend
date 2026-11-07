import { ConfigService } from "../config/ConfigService";

/**
 * MQTT client module (architecture v2 §1, §7). Owns the connection to
 * HiveMQ Cloud and the telemetry/state/alert/lwt subscribers + cmd/req
 * publisher. Takes ConfigService so keep-alive and topic behaviour are
 * DB-tunable, not hardcoded.
 *
 * TODO (Phase 1, next step): connect, subscribe to dt/farm/+/{telemetry,
 * state,alert,lwt}, wire messages into DeviceStatusService / AlertManager,
 * expose publishCommand() for CommandManager.
 */
export class MqttClient {
  constructor(private config: ConfigService) {}

  async connect(): Promise<void> {
    throw new Error("not yet implemented");
  }
}
