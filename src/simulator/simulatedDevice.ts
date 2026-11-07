/**
 * Phase 1 simulated device - speaks the same MQTT contract the real
 * STM32F401 + A7670C firmware will (architecture v2 §1, §4), so the whole
 * backend/app pipeline is provable before any hardware exists.
 *
 * TODO (Phase 1, next step): connect to the same MQTT broker as a fake
 * device id, publish periodic telemetry + heartbeat, respond to cmd/req
 * with a believable ACCEPTED -> ACTUATING -> SUCCEEDED sequence (with a
 * deliberate delay so the UNKNOWN state is actually exercisable), publish
 * LWT on disconnect.
 */
async function main() {
  console.log("simulator: not yet implemented");
}

main();
