import { z } from "zod";

export const createCommandRequestSchema = z.object({
  action: z.literal("SET_MOTOR_STATE"),
  desiredState: z.enum(["ON", "OFF"]),
  commandId: z.string().uuid().optional(),
});
export type CreateCommandRequestDto = z.infer<typeof createCommandRequestSchema>;
