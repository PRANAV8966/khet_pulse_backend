# khet_pulse

Remote motor controller and farmer notification backend for the Farm Motor
Starter project. See `docs/` (architecture PDFs, not yet copied into this
repo) for the full design - this README covers the code structure only.

## Adaptive architecture - the one thing to understand first

Every tunable value (command expiry, HMAC replay window, notification
cooldown, MQTT keep-alive, notification channel order, ...) lives in the
`system_config` Postgres table, **not** in code or `.env`. `ConfigService`
loads it into memory at boot and keeps it live via Postgres `LISTEN/NOTIFY`
(see `prisma/sql/config_notify_trigger.sql`), with a 60s poll as a safety
net. Changing a value is a `UPDATE system_config SET value = ... WHERE key
= ...` - no redeploy.

Every module (`MqttClient`, `CommandManager`, `AlertManager`,
`NotificationDispatcher`, ...) takes `ConfigService` as a constructor
argument and reads values through `config.get(key, fallback)` - never a
hardcoded constant. This is also what keeps each module swappable/testable
in isolation.

## Structure

```
src/
  config/        ConfigService - the adaptive-config mechanism above
  db/            Prisma client singleton (Postgres = single source of truth)
  api/           REST API (Express) - thin, delegates to the modules below
  auth/          Firebase ID-token verification middleware
  mqtt/          MQTT client (HiveMQ Cloud) - telemetry/state/alert/lwt in, cmd/req out
  commands/      Command Manager - desired-state commands, idempotency, lifecycle
  devices/       Device status / presence (7-state model, LWT + heartbeat)
  alerts/        Alert Manager - fault_events + notification_outbox (durable)
  notifications/ Notification Dispatcher - FCM / WhatsApp / SMS
  simulator/     Fake device for Phase 1 (no hardware needed to test the pipeline)
prisma/
  schema.prisma  Full DB schema, expand-only (add, never drop/rename)
  sql/           Raw SQL that Prisma's schema can't express (the NOTIFY trigger)
  seed.ts        Seeds default system_config rows without overwriting tuned values
```

## Setup

```bash
cp .env.example .env     # fill in DATABASE_URL, MQTT_URL, Firebase creds
npm install
npx prisma migrate dev --name init
psql "$DATABASE_URL" -f prisma/sql/config_notify_trigger.sql
npm run prisma:seed
npm run dev               # starts the API on :3000
npm run simulate           # in a second terminal, once implemented
```

## Status

Phase 1 scaffolding: config system, DB schema, and module skeletons are in
place. Business logic inside each module (`MqttClient`, `CommandManager`,
`DeviceStatusService`, `AlertManager`, `NotificationDispatcher`, the
simulator) is the next increment - see the `TODO` comment at the top of
each file.
