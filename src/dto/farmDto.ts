import { z } from "zod";

export const createFarmRequestSchema = z.object({
  name: z.string().trim().min(1).max(200),
  location: z.string().trim().max(500).optional(),
  id: z.string().uuid().optional(), // client-supplied idempotency key, same pattern as commandId
});
export type CreateFarmRequestDto = z.infer<typeof createFarmRequestSchema>;

export interface FarmSummary {
  id: string;
  name: string;
  location: string | null;
  createdAt: string;
}
