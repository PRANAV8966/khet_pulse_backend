-- Run this once against the database after the first `prisma migrate dev`
-- (Prisma's schema doesn't express triggers, so this stays a plain SQL file).
-- It makes every INSERT/UPDATE/DELETE on system_config broadcast the changed
-- key over Postgres LISTEN/NOTIFY, which ConfigService listens for.

CREATE OR REPLACE FUNCTION notify_system_config_change() RETURNS trigger AS $$
BEGIN
  PERFORM pg_notify('system_config_changed', COALESCE(NEW.key, OLD.key));
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS system_config_notify ON system_config;
CREATE TRIGGER system_config_notify
AFTER INSERT OR UPDATE OR DELETE ON system_config
FOR EACH ROW EXECUTE FUNCTION notify_system_config_change();
