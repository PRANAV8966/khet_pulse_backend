-- Run this once against the database after the matching `prisma migrate dev`
-- (Prisma's schema doesn't express partial/filtered unique indexes).
--
-- Guarantees at the database level that a device can have at most one
-- UNRESOLVED fault_event per fault type at a time, so two concurrent
-- AlertManager.recordFault() calls for the same new fault can race the
-- "does an unresolved one already exist?" check and still only ever produce
-- one row - the loser's INSERT is rejected by Postgres, not by hoping the
-- application-level transaction isolation caught it.

CREATE UNIQUE INDEX IF NOT EXISTS fault_events_unresolved_unique
ON fault_events (device_id, type)
WHERE resolved_at IS NULL;
