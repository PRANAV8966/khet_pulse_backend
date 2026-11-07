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
  devices/       Device status/presence + device management (create/list/history)
  farms/         Farm management (create/list)
  alerts/        Alert Manager - fault_events + notification_outbox (durable)
  notifications/ Notification Dispatcher - FCM / WhatsApp / SMS
  middleware/    requireDeviceOwnership / requireFarmOwnership / errorHandler
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
psql "$DATABASE_URL" -f prisma/sql/fault_events_unresolved_unique.sql
npm run prisma:seed       # also creates a demo user/farm/device fixture
npm run dev               # starts the API on :3000
npm run simulate           # in a second terminal
```

Needs a real, free Supabase (Postgres) project and HiveMQ Cloud Serverless
cluster to actually run against - `.env` has nothing to point at until those
exist. A Firebase project (free) is also needed for `requireAuth` and the
FCM notification channel; WhatsApp (MSG91/WhatsApp Cloud API) credentials
are optional - those channels run as a logged dry-run until configured.

## API

`POST/GET /farms`, `POST/GET /farms/:farmId/devices` (device creation returns
the HMAC secret exactly once, never again), `GET /devices/:deviceId/status`,
`GET /devices/:deviceId/telemetry` and `/faults` (cursor-paginated),
`POST /devices/:deviceId/commands`, `POST /me/fcm-token`. Every authenticated
request auto-provisions the caller's `users` row on first sight (see
`requireAuth` in `src/auth/middleware.ts`) - no separate signup endpoint.

## Status

Phase 1 is functionally complete: config system, DB schema, all module
business logic, auth/user-provisioning, and farm/device management are
implemented, unit-tested, and wired together in `src/index.ts`. See
`tests/unit` (runs with no DB) and `tests/integration` (concurrency/race
tests - needs `TEST_DATABASE_URL`, currently unrun since no live Postgres
exists yet). Phase 2 is the real STM32F401 + A7670C firmware and field
hardware - see the Hardware & Protection Addendum.
