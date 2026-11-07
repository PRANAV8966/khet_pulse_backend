import { PrismaClient } from "@prisma/client";

// Single Prisma client for the whole process - Postgres is the source of
// truth, nothing load-bearing should live only in memory outside this layer.
export const prisma = new PrismaClient();
