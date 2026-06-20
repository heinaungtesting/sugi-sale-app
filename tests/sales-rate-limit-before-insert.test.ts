import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = (path: string) => readFileSync(join(process.cwd(), path), 'utf8');

/**
 * Regression for the offline/slow-internet beta test on 2026-06-19:
 * BUG-001 — Rate-limit check happened AFTER logSale, so 429 responses
 * left orphan rows in sales_logs. The user saw "failed" in the queue
 * pill even though the sale was already in the DB.
 *
 * Fix contract: the rate-limit guard must run BEFORE the DB insert,
 * and idempotent replays (from the offline queue) must not consume
 * the rate budget.
 */
describe('rate-limit-before-insert (BUG-001 regression)', () => {
  const route = source('app/api/sales/route.ts');

  it('checks the rate limit before calling logSale (no orphan rows on 429)', () => {
    // The CALL of recordSaleWrite (not the function definition) must come
    // before the await logSale call. Find the call site via `recordSaleWrite(user.id)`.
    const rateLimitCallIdx = route.indexOf('recordSaleWrite(user.id)');
    const logSaleIdx = route.indexOf('await logSale(');
    expect(rateLimitCallIdx).toBeGreaterThan(0);
    expect(logSaleIdx).toBeGreaterThan(0);
    expect(rateLimitCallIdx).toBeLessThan(logSaleIdx);
  });

  it('returns 429 before reaching logSale when the rate budget is exhausted', () => {
    // The 429 branch must be reachable without logSale having been called.
    // Concretely: the 429 string literal must appear before the logSale call.
    const tooManyIdx = route.indexOf("'too many sales'");
    const logSaleIdx = route.indexOf('await logSale(');
    expect(tooManyIdx).toBeGreaterThan(0);
    expect(logSaleIdx).toBeGreaterThan(0);
    expect(tooManyIdx).toBeLessThan(logSaleIdx);
  });

  it('does not consume the rate budget for idempotent replays', () => {
    // The fix moves the rate-limit check before logSale, so we need a
    // release path for replays (sale.idempotent_replay === true) to
    // keep the offline-queue retry path uncounted.
    expect(route).toMatch(/idempotent_replay/);
    // The release function must exist and be wired up to the replay branch.
    expect(route).toMatch(/idempotent_replay[\s\S]{0,200}releaseSaleWrite/);
  });

  it('refunds the rate budget when the insert fails (e.g. DB error -> 500)', () => {
    // If logSale throws, the counter must not be left incremented.
    // Look for a release call inside the catch block.
    expect(route).toMatch(/catch\s*\(error\)[\s\S]{0,400}releaseSaleWrite/);
  });

  it('exports a releaseSaleWrite helper that decrements the per-user counter', () => {
    expect(route).toMatch(/function\s+releaseSaleWrite/);
    // The release function must be safe against double-decrement / negative counts.
    expect(route).toMatch(/current\.count\s*[-]=\s*1/);
  });
});
