import 'dotenv/config';
import { defineConfig, env } from 'prisma/config';
import { requireDirectUrl } from './lib/database-url';

const directUrl = requireDirectUrl({ DIRECT_URL: env("DIRECT_URL") });

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
    seed: 'tsx prisma/seed.ts',
  },
  datasource: {
    url: directUrl,
  },
});
