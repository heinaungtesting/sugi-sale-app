import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = (path: string) => readFileSync(join(process.cwd(), path), 'utf8');

describe('sale queue user isolation', () => {
  it('binds every queued tap to the user who made it', () => {
    const queue = source('lib/sale-queue.ts');
    expect(queue).toContain('ownerUserId: number');
    expect(queue).toContain('ownerUserId: input.ownerUserId');
    expect(queue).toContain('entry.ownerUserId === activeUserId');
    expect(queue).toContain('owner_user_id: entry.ownerUserId');
  });

  it('rejects replay when the queued owner differs from the authenticated user', () => {
    const route = source('app/api/sales/route.ts');
    expect(route).toContain('validation.command.idempotencyKey');
    expect(route).toContain('owner_user_id');
    expect(route).toContain('queued sale owner mismatch');
    expect(route.indexOf('queued sale owner mismatch')).toBeLessThan(route.indexOf('createSale(user.id'));
  });

  it('keeps the service-worker replay bound to the original owner', () => {
    const worker = source('public/sw.js');
    expect(worker).toContain('owner_user_id: entry.ownerUserId');
    expect(worker).toContain("entry.status = response.status === 409 ? 'failed'");
  });

  it('passes the authenticated user id through every queue entry point', () => {
    const home = source('components/HomeShiftLoggerClient.tsx');
    const search = source('components/SearchProductLogger.tsx');
    const calendar = source('components/SalesCalendarClient.tsx');
    const header = source('components/AppHeader.tsx');
    expect(home).toContain('initSaleQueue(user.id)');
    expect(home).toContain('userId={user.id}');
    expect(search).toContain('ownerUserId: userId');
    expect(calendar).toContain('initSaleQueue(userId)');
    expect(calendar).toContain('ownerUserId: userId');
    expect(header).toContain('<ConnectivityIndicator userId={user.id}');
  });
});
