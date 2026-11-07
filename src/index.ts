import "dotenv/config";
import { prisma } from "./db/prisma";
import { getConfigService } from "./config/ConfigService";
import { createServer } from "./api/server";

async function main() {
  const config = getConfigService();
  await config.init();

  const app = createServer(config);
  const port = Number(process.env.PORT ?? 3000);
  const server = app.listen(port, () => {
    console.log(`[backend] listening on :${port}`);
  });

  // MQTT client, Command Manager, Alert Manager and Notification Dispatcher
  // attach here as their own modules once built (Phase 1, next steps) -
  // each takes `config` as a constructor argument, never reads env/constants
  // directly, so every module stays swappable and DB-config-driven.

  const shutdown = async (signal: string) => {
    console.log(`[backend] received ${signal}, shutting down`);
    server.close();
    await config.shutdown();
    await prisma.$disconnect();
    process.exit(0);
  };
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

main().catch((err) => {
  console.error("[backend] fatal startup error:", err);
  process.exit(1);
});
