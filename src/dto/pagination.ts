import { z } from "zod";

const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 200;

export const paginationQuerySchema = z.object({
  take: z.coerce.number().int().positive().max(MAX_PAGE_SIZE).optional(),
  before: z.coerce.date().optional(),
});
export type PaginationQuery = z.infer<typeof paginationQuerySchema>;

/** Cursor pagination by a timestamp column, newest-first. `before` (if given)
 * returns items strictly older than that cursor - never an unbounded scan,
 * since `take` is always clamped. */
export function resolvePageSize(take?: number): number {
  return Math.min(take ?? DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE);
}

export function nextCursor<T>(items: T[], pageSize: number, getTimestamp: (item: T) => Date): string | null {
  if (items.length < pageSize) return null; // short page - no more results
  return getTimestamp(items[items.length - 1]).toISOString();
}
