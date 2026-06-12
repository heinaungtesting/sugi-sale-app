import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = (path: string) => readFileSync(join(process.cwd(), path), 'utf8');

describe('sales calendar and admin build source contracts', () => {
  it('clears the undo toast after successful undo on the fast logger', () => {
    const component = source('components/SearchProductLogger.tsx');
    expect(component).toContain("setToast(null)");
    expect(component).toContain("setLastLogged(null)");
  });

  it('supports dated sale logging and exact sale deletion by id', () => {
    const db = source('lib/sugi-db.ts');
    const salesRoute = source('app/api/sales/route.ts');
    expect(db).toContain('soldDate?: string | null');
    expect(db).toContain('sold_date, user_id, product_id');
    expect(salesRoute).toContain('body.sold_date');
    expect(existsSync(join(process.cwd(), 'app/api/sales/[id]/route.ts'))).toBe(true);
  });

  it('adds calendar/history sales UI for checking selected-date logs', () => {
    expect(existsSync(join(process.cwd(), 'app/sales/page.tsx'))).toBe(true);
    expect(source('components/SalesCalendarClient.tsx')).toContain('選択日');
    expect(source('components/SalesCalendarClient.tsx')).not.toContain('Add product to');
    expect(source('app/api/sales/month/route.ts')).toContain('salesByMonth');
    expect(source('app/api/sales/date/route.ts')).toContain('salesByDate');
  });

  it('adds admin-only users/products/variants management', () => {
    expect(existsSync(join(process.cwd(), 'app/admin/page.tsx'))).toBe(true);
    expect(source('app/admin/page.tsx')).toContain("user.role !== 'admin'");
    expect(source('lib/sugi-admin-db.ts')).toContain('createSugiUser');
    expect(source('lib/sugi-admin-db.ts')).toContain('upsertProductVariant');
    expect(source('app/api/admin/users/route.ts')).toContain('requireAdmin');
    expect(source('app/api/admin/products/route.ts')).toContain('requireAdmin');
  });
});
