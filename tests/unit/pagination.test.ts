import { describe, it, expect } from "vitest";
import { resolvePageSize, nextCursor, paginationQuerySchema } from "../../src/dto/pagination";

describe("resolvePageSize", () => {
  it("defaults to 50 when no take is given", () => {
    expect(resolvePageSize(undefined)).toBe(50);
  });

  it("honors a take within bounds", () => {
    expect(resolvePageSize(10)).toBe(10);
  });

  it("clamps to the max page size of 200", () => {
    expect(resolvePageSize(10_000)).toBe(200);
  });
});

describe("nextCursor", () => {
  const items = [{ ts: new Date("2026-01-03") }, { ts: new Date("2026-01-02") }, { ts: new Date("2026-01-01") }];

  it("returns null when the page is short (no more results)", () => {
    expect(nextCursor(items, 10, (i) => i.ts)).toBeNull();
  });

  it("returns the last item's timestamp when the page is full (more results likely)", () => {
    expect(nextCursor(items, 3, (i) => i.ts)).toBe(new Date("2026-01-01").toISOString());
  });

  it("returns null for an empty page", () => {
    expect(nextCursor([], 50, (i: { ts: Date }) => i.ts)).toBeNull();
  });
});

describe("paginationQuerySchema", () => {
  it("accepts an empty query", () => {
    const result = paginationQuerySchema.safeParse({});
    expect(result.success).toBe(true);
  });

  it("coerces take and before from query-string strings", () => {
    const result = paginationQuerySchema.safeParse({ take: "25", before: "2026-01-01T00:00:00.000Z" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.take).toBe(25);
      expect(result.data.before).toBeInstanceOf(Date);
    }
  });

  it("rejects a take over the max page size", () => {
    const result = paginationQuerySchema.safeParse({ take: "99999" });
    expect(result.success).toBe(false);
  });

  it("rejects a non-positive take", () => {
    const result = paginationQuerySchema.safeParse({ take: "0" });
    expect(result.success).toBe(false);
  });

  it("rejects a malformed before date rather than coercing to Invalid Date silently", () => {
    const result = paginationQuerySchema.safeParse({ before: "not-a-date" });
    expect(result.success).toBe(false);
  });
});
