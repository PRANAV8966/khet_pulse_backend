/** Integration tests need a real reachable Postgres (TEST_DATABASE_URL, or
 * DATABASE_URL as a fallback) - they exercise actual transactions and DB
 * constraints, which cannot be faked with mocks. Exported so every
 * integration test file reports the same clear skip reason instead of
 * failing with an opaque connection error. */
export const hasTestDatabase = Boolean(process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL);

if (!hasTestDatabase) {
  console.warn(
    "[integration tests] SKIPPED: no TEST_DATABASE_URL or DATABASE_URL configured. " +
      "Provision Supabase (or any reachable Postgres), run `prisma migrate dev` and the two " +
      "prisma/sql/*.sql files against it, then set TEST_DATABASE_URL to run these for real."
  );
}

if (process.env.TEST_DATABASE_URL) {
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
}
