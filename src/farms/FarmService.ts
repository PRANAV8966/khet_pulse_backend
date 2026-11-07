import { randomUUID } from "crypto";
import { prisma } from "../db/prisma";
import { ConflictError } from "../errors";
import { FarmSummary } from "../dto/farmDto";
import { isUniqueViolation } from "../db/errors";

function toSummary(row: { id: string; name: string; location: string | null; createdAt: Date }): FarmSummary {
  return { id: row.id, name: row.name, location: row.location, createdAt: row.createdAt.toISOString() };
}

export interface CreateFarmInput {
  ownerUserId: string;
  name: string;
  location?: string;
  id?: string; // client-supplied idempotency key
}

/** Farm management (create/list). Ownership is always `ownerUserId` from the
 * authenticated caller - never client-supplied, so a farm can never be
 * created on someone else's behalf. */
export class FarmService {
  async createFarm(input: CreateFarmInput): Promise<FarmSummary> {
    const id = input.id ?? randomUUID();

    if (input.id) {
      const existing = await prisma.farm.findUnique({ where: { id } });
      if (existing) {
        if (existing.ownerUserId !== input.ownerUserId) {
          throw new ConflictError("id already used for a different owner");
        }
        return toSummary(existing); // idempotent replay
      }
    }

    try {
      const created = await prisma.farm.create({
        data: { id, ownerUserId: input.ownerUserId, name: input.name, location: input.location },
      });
      return toSummary(created);
    } catch (err) {
      if (!isUniqueViolation(err)) throw err;
      // Lost a race against a concurrent request with the same client-supplied
      // id - the winner's row is now visible, return it instead of erroring.
      const existing = await prisma.farm.findUnique({ where: { id } });
      if (existing) return toSummary(existing);
      throw err;
    }
  }

  async listFarms(ownerUserId: string): Promise<FarmSummary[]> {
    const rows = await prisma.farm.findMany({ where: { ownerUserId }, orderBy: { createdAt: "asc" } });
    return rows.map(toSummary);
  }
}
