import { describe, it, expect } from "vitest";
import { channelForAttempt } from "../../src/notifications/channelPriority";

const priority = ["fcm", "whatsapp", "sms"];

describe("channelForAttempt (notification escalation)", () => {
  it("starts at the first configured channel", () => {
    expect(channelForAttempt(priority, 0)).toBe("fcm");
  });

  it("escalates one step per repeat notification", () => {
    expect(channelForAttempt(priority, 1)).toBe("whatsapp");
    expect(channelForAttempt(priority, 2)).toBe("sms");
  });

  it("stays on the last channel once the priority list is exhausted", () => {
    expect(channelForAttempt(priority, 3)).toBe("sms");
    expect(channelForAttempt(priority, 100)).toBe("sms");
  });

  it("throws rather than silently picking nothing for an empty config", () => {
    expect(() => channelForAttempt([], 0)).toThrow();
  });
});
