import { describe, it, expect } from "vitest";
import { isForwardTransition } from "../../src/commands/statuses";

describe("command status transitions", () => {
  it("allows the normal forward lifecycle", () => {
    expect(isForwardTransition("RECEIVED", "ACCEPTED")).toBe(true);
    expect(isForwardTransition("ACCEPTED", "ACTUATING")).toBe(true);
    expect(isForwardTransition("ACTUATING", "SUCCEEDED")).toBe(true);
  });

  it("allows skipping straight to a terminal status (e.g. REJECTED on bad hmac)", () => {
    expect(isForwardTransition("RECEIVED", "REJECTED")).toBe(true);
  });

  it("rejects a late/duplicate response that would regress an already-terminal command", () => {
    expect(isForwardTransition("SUCCEEDED", "ACCEPTED")).toBe(false);
    expect(isForwardTransition("SUCCEEDED", "ACTUATING")).toBe(false);
    expect(isForwardTransition("FAILED", "ACCEPTED")).toBe(false);
  });

  it("rejects a duplicate of the same status (idempotent no-op, not an error)", () => {
    expect(isForwardTransition("ACCEPTED", "ACCEPTED")).toBe(false);
  });

  it("rejects a backward transition between non-terminal statuses", () => {
    expect(isForwardTransition("ACTUATING", "ACCEPTED")).toBe(false);
  });
});
