import { describe, it, expect } from "vitest";
import { createFarmRequestSchema } from "../../src/dto/farmDto";
import { createDeviceRequestSchema } from "../../src/dto/deviceDto";

describe("createFarmRequestSchema", () => {
  it("accepts a minimal valid body", () => {
    expect(createFarmRequestSchema.safeParse({ name: "My Farm" }).success).toBe(true);
  });

  it("rejects an empty name", () => {
    expect(createFarmRequestSchema.safeParse({ name: "" }).success).toBe(false);
  });

  it("rejects a missing name", () => {
    expect(createFarmRequestSchema.safeParse({}).success).toBe(false);
  });

  it("rejects a non-uuid client-supplied id", () => {
    expect(createFarmRequestSchema.safeParse({ name: "x", id: "not-a-uuid" }).success).toBe(false);
  });

  it("accepts a valid client-supplied id", () => {
    expect(createFarmRequestSchema.safeParse({ name: "x", id: "11111111-1111-1111-1111-111111111111" }).success).toBe(true);
  });
});

describe("createDeviceRequestSchema", () => {
  it("accepts a minimal valid body", () => {
    expect(createDeviceRequestSchema.safeParse({ name: "Pump 1" }).success).toBe(true);
  });

  it("rejects an empty name", () => {
    expect(createDeviceRequestSchema.safeParse({ name: "" }).success).toBe(false);
  });

  it("accepts an optional deviceType", () => {
    expect(createDeviceRequestSchema.safeParse({ name: "Pump 1", deviceType: "motor_controller" }).success).toBe(true);
  });
});
