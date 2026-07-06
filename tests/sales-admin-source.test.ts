import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = (path: string) => readFileSync(join(process.cwd(), path), 'utf8');

describe('sales calendar and admin build source contracts', () => {
  it('keeps the fast logger toast passive without undo/repeat actions', () => {
    const component = source('components/SearchProductLogger.tsx');
    expect(component).toContain('setToast(null)');
    expect(component).not.toContain('loggedSuffix');
    expect(component).not.toContain('/api/sales/latest');
    expect(component).not.toContain('Undo latest');
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

  it('adds admin delete buttons for products and users with CSRF-protected delete APIs', () => {
    const admin = source('components/AdminClient.tsx');
    const adminDb = source('lib/sugi-admin-db.ts');
    const productsRoute = source('app/api/admin/products/route.ts');
    const usersRoute = source('app/api/admin/users/route.ts');

    expect(admin).toContain('deleteProduct(selectedProduct.id)');
    expect(admin).toContain('Delete product');
    expect(admin).toContain('deleteUser(user)');
    expect(admin).toContain('Delete user');
    expect(admin).toContain('window.confirm');
    expect(admin).toContain('/api/admin/products');
    expect(admin).toContain('/api/admin/users');

    expect(adminDb).toContain('deleteProductForAdmin');
    expect(adminDb).toContain('deleteSugiUserForAdmin');
    expect(productsRoute).toContain('export async function DELETE');
    expect(productsRoute).toContain('requireCsrf(req)');
    expect(usersRoute).toContain('export async function DELETE');
    expect(usersRoute).toContain('requireCsrf(req)');
  });

  it('keeps admin and bulk-created product categories inside the two reporting buckets', () => {
    const adminDb = source('lib/sugi-admin-db.ts');
    const migrate = source('scripts/migrate.ts');
    const quick = source('lib/sugi-db.ts');
    expect(adminDb).toContain('normalizeProductCategory(input.category)');
    expect(adminDb).toContain("category: pickString(item, ['category'], 'ヘルスケア')");
    expect(adminDb).toContain("VALUES ($1, 'ヘルスケア', $2, $3, TRUE, NULL)");
    expect(quick).toContain("VALUES ($1, 'ヘルスケア', $2, $3, TRUE, NULL)");
    expect(migrate).toContain("THEN '化粧品'");
    expect(migrate).toContain("ELSE 'ヘルスケア'");
  });

  it('remounts admin edit forms after product and variant names change so saved names appear immediately', () => {
    const admin = source('components/AdminClient.tsx');
    expect(admin).toContain('key={`product-editor-${selectedProduct.id}-${selectedProduct.product_name}`}');
    expect(admin).toContain('key={`variant-editor-${variant.id}-${variant.variant_label}`}');
  });

  it('keeps inactive products and variants visible in admin so they can be reactivated', () => {
    const adminDb = source('lib/sugi-admin-db.ts');
    expect(adminDb).toMatch(/FROM products\s+WHERE \(/);
    expect(adminDb).toMatch(/FROM product_variants\s+WHERE product_id = ANY\(\$1::bigint\[\]\)/);
    expect(adminDb).not.toContain('FROM products\n WHERE is_active = TRUE AND (');
    expect(adminDb).not.toContain('WHERE product_id = ANY($1::bigint[]) AND is_active = TRUE');
  });

  it('ships a responsive admin workspace with product search and JSON import available on mobile', () => {
    const admin = source('components/AdminClient.tsx');
    const css = source('app/globals.css');
    expect(admin).toContain('Search & edit');
    expect(admin).toContain('/api/admin/products?q=');
    expect(admin).toContain('/api/admin/import');
    expect(admin).toContain('JSON import');
    expect(admin).not.toContain('PC only admin');
    expect(admin).not.toContain('admin-mobile-blocker');
    expect(source('lib/sugi-admin-db.ts')).toContain('importProductsFromJson');
    expect(source('app/api/admin/import/route.ts')).toContain('requireAdmin');
    expect(css).toContain('@media (min-width: 900px)');
    expect(css).not.toContain('.admin-desktop-workspace { display: none; }');
    expect(css).toContain('.admin-variant-row { min-width: 720px;');
  });

  it('adds an admin-only user activity feed backed by real sales, session, and audit rows', () => {
    const adminPage = source('app/admin/page.tsx');
    const adminClient = source('components/AdminClient.tsx');
    const route = source('app/api/admin/activity/route.ts');
    const activityDb = source('lib/sugi-activity.ts');
    const migrate = source('scripts/migrate.ts');

    expect(adminPage).toContain('listAdminActivity');
    expect(adminClient).toContain('User activity');
    expect(adminClient).toContain('/api/admin/activity');
    expect(adminClient).toContain('activity-user-filter');
    expect(route).toContain('requireAdmin');
    expect(route).toContain('listAdminActivity');
    expect(activityDb).toContain('export async function listAdminActivity');
    expect(activityDb).toContain('sales_logs');
    expect(activityDb).toContain('sugi_sessions');
    expect(activityDb).toContain('sugi_activity_logs');
    expect(migrate).toContain('CREATE TABLE IF NOT EXISTS sugi_activity_logs');
  });
});
