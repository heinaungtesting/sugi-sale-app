import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const schema = readFileSync(join(process.cwd(), 'prisma/schema.prisma'), 'utf8');

describe('Prisma schema contract', () => {
  const models = [
    ['SugiUser', 'sugi_users'],
    ['SugiSession', 'sugi_sessions'],
    ['SugiRateLimit', 'sugi_rate_limits'],
    ['SugiPointCampaign', 'sugi_point_campaigns'],
    ['SugiPointCampaignItem', 'sugi_point_campaign_items'],
    ['SugiActivityLog', 'sugi_activity_logs'],
    ['SugiFeedback', 'sugi_feedback'],
    ['Product', 'products'],
    ['ProductVariant', 'product_variants'],
    ['SalesLog', 'sales_logs'],
    ['SaleIdempotencyReceipt', 'sale_idempotency_receipts'],
  ] as const;

  it.each(models)('maps %s to %s', (model, table) => {
    expect(schema).toMatch(new RegExp(`model ${model} \\{[\\s\\S]*?@@map\\("${table}"\\)[\\s\\S]*?\\}`));
  });

  it('uses PostgreSQL-native date, timestamp, JSON, arrays, and bigint IDs', () => {
    expect(schema).toContain('schemas  = ["sugi"]');
    expect(schema.match(/@@schema\("sugi"\)/g)?.length).toBe(models.length);
    expect(schema).toContain('@db.Timestamptz(6)');
    expect(schema).toContain('@db.Date');
    expect(schema).toMatch(/details\s+Json/);
    expect(schema).toMatch(/nicknames\s+String\[\]/);
    expect(schema).toMatch(/id\s+BigInt\s+@id\s+@default\(autoincrement\(\)\)/);
  });
});
