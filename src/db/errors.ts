/** Prisma maps a unique-constraint violation to P2002 generically from the
 * underlying Postgres SQLSTATE 23505 - including for indexes outside its own
 * schema knowledge (e.g. partial unique indexes added via raw SQL). Checked
 * defensively against both the Prisma code and the raw SQLSTATE/message,
 * since relying on ORM internals alone isn't something to assume blindly. */
export function isUniqueViolation(err: unknown): boolean {
  const e = err as { code?: string; message?: string } | null;
  if (!e) return false;
  return e.code === "P2002" || e.code === "23505" || (typeof e.message === "string" && e.message.includes("23505"));
}
