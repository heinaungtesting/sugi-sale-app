import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@/generated/prisma/client';
import { requireDatabaseUrl, runtimeDatabasePoolOptions } from './database-url';

const connectionString = requireDatabaseUrl();

const adapter = new PrismaPg(
  runtimeDatabasePoolOptions(connectionString),
  { schema: 'sugi' },
);

declare global {
  // eslint-disable-next-line no-var
  var sugiSalePrisma: PrismaClient | undefined;
}

export const prisma = globalThis.sugiSalePrisma ?? new PrismaClient({ adapter });

if (process.env.NODE_ENV !== 'production') {
  globalThis.sugiSalePrisma = prisma;
}
