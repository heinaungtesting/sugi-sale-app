import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { getNextTokyoMonthKey, getTokyoMonthKey } from '../lib/sugi-admin-db';

const source = (path: string) => readFileSync(join(process.cwd(), path), 'utf8');

describe('monthly point campaign staging', () => {
  it('calculates Tokyo campaign months, including UTC month-boundary drift', () => {
    expect(getTokyoMonthKey(new Date('2026-06-30T14:59:00Z'))).toBe('2026-06');
    expect(getTokyoMonthKey(new Date('2026-06-30T15:00:00Z'))).toBe('2026-07');
    expect(getNextTokyoMonthKey(new Date('2026-06-30T14:59:00Z'))).toBe('2026-07');
    expect(getNextTokyoMonthKey(new Date('2026-12-15T00:00:00Z'))).toBe('2027-01');
  });

  it('has schema and lazy activation for next-month point campaigns', () => {
    const migrate = source('scripts/migrate.ts');
    const adminDb = source('lib/sugi-admin-db.ts');
    const sugiDb = source('lib/sugi-db.ts');

    expect(migrate).toContain('sugi_point_campaigns');
    expect(migrate).toContain('sugi_point_campaign_items');
    expect(adminDb).toContain('stageNextMonthPointCampaignFromJson');
    expect(adminDb).toContain('applyDueMonthlyPointCampaigns');
    expect(adminDb).toContain('UPDATE product_variants SET point_value = 0');
    expect(adminDb).toContain('UPDATE products SET point_value = 0');
    expect(sugiDb).toContain('applyDueMonthlyPointCampaigns');
  });

  it('falls back to display shortcut for campaign variants with blank labels', () => {
    const adminDb = source('lib/sugi-admin-db.ts');
    expect(adminDb).toContain("const shortcut = pickString(variant, ['display_shortcut', 'shortcut', 'displayShortcut'], '通常')");
    expect(adminDb).toContain("const variant_label = pickString(variant, ['variant_label', 'label', 'name', 'variantLabel'], shortcut)");
  });

  it('exposes admin-only next-month JSON staging UI and API', () => {
    expect(existsSync(join(process.cwd(), 'app/api/admin/point-campaigns/next-month/route.ts'))).toBe(true);
    const route = source('app/api/admin/point-campaigns/next-month/route.ts');
    const admin = source('components/AdminClient.tsx');

    expect(route).toContain('requireAdmin');
    expect(route).toContain('requireCsrf(req)');
    expect(route).toContain('campaignService.stageNextMonth');
    expect(source('domain/campaigns/campaign-service.ts')).toContain('stageNextMonthPointCampaignFromJson');
    expect(admin).toContain('/api/admin/point-campaigns/next-month');
    expect(admin).toContain('Stage for next month');
    expect(admin).toContain('current points expire');
  });
});
