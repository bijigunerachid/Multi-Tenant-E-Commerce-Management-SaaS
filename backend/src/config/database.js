import { PrismaClient } from '@prisma/client';

export function createPrismaClient({ databaseUrl }) {
  return new PrismaClient({ datasourceUrl: databaseUrl });
}
