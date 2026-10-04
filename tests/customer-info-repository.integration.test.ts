import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';

// Runs the real SQL against a disposable PostgreSQL database that already has
// the Prisma migrations applied. Opt in with CUSTOMER_INFO_TEST_DATABASE_URL;
// the suite TRUNCATEs product tables, so never point it at a shared database.
const databaseUrl = process.env.CUSTOMER_INFO_TEST_DATABASE_URL;

describe.skipIf(!databaseUrl)('customer info repository (PostgreSQL)', () => {
  let repo: typeof import('@/repositories/customer-info-repository');
  let pool: Pool;
  let productId: number;
  let privateProductId: number;
  let officialSource: number;
  let reviewSource: number;
  const reviewer = { id: 0, username: 'reviewer' };

  async function rowId(language: string, field: string) {
    const result = await pool.query('SELECT id FROM product_customer_info WHERE product_id = $1 AND language = $2 AND field_key = $3', [productId, language, field]);
    return Number(result.rows[0].id);
  }

  const REQUIRED = ['display_name', 'unique_features', 'purpose', 'risks', 'ingredients'] as const;

  beforeAll(async () => {
    process.env.DATABASE_URL = databaseUrl;
    ({ pool } = await import('@/lib/db'));
    repo = await import('@/repositories/customer-info-repository');
    await pool.query('TRUNCATE product_customer_info, enrichment_audit, enrichment_sources, products, sugi_users RESTART IDENTITY CASCADE');
    const user = await pool.query(`INSERT INTO sugi_users (username, display_name, pin_hash, role) VALUES ('reviewer', 'Reviewer', 'x', 'admin') RETURNING id`);
    reviewer.id = Number(user.rows[0].id);
    const product = await pool.query(`INSERT INTO products (product_name, product_type, risk_class) VALUES ('葛根湯エキス錠', 'kampo', 'class2') RETURNING id`);
    productId = Number(product.rows[0].id);
    const privateProduct = await pool.query(`INSERT INTO products (product_name, user_id) VALUES ('私の商品', $1) RETURNING id`, [reviewer.id]);
    privateProductId = Number(privateProduct.rows[0].id);
    const sources = await pool.query(
      `INSERT INTO enrichment_sources (product_id, url, source_type, is_official, fetch_status)
       VALUES ($1, 'https://example.jp/insert.pdf', 'official_pdf', TRUE, 'ok'),
              ($1, 'https://example.jp/reviews', 'review_aggregate', FALSE, 'ok')
       RETURNING id`,
      [productId],
    );
    officialSource = Number(sources.rows[0].id);
    reviewSource = Number(sources.rows[1].id);
  });

  afterAll(async () => {
    await pool?.end();
  });

  it('refuses private products and non-official sources', async () => {
    const row = { language: 'ja' as const, field_key: 'purpose' as const, body: '風邪のひきはじめに', source_ids: [officialSource], ja_source_hash: null, model_id: null, prompt_version: null };
    expect(await repo.ingestCustomerInfo({ product_id: privateProductId, rows: [row] })).toEqual({ ok: false, code: 'not_found' });
    const bad = await repo.ingestCustomerInfo({ product_id: productId, rows: [{ ...row, source_ids: [reviewSource] }] });
    expect(bad).toMatchObject({ ok: false, code: 'invalid_sources' });
  });

  it('drafts Japanese and translations, and refuses a translation of a different source', async () => {
    const ja = REQUIRED.map((field) => ({ language: 'ja' as const, field_key: field, body: `JA ${field}`, source_ids: [officialSource], ja_source_hash: null, model_id: 'm', prompt_version: 'v1' }));
    const drafted = await repo.ingestCustomerInfo({ product_id: productId, rows: ja });
    expect(drafted.ok && drafted.written.every((row) => row.outcome === 'drafted')).toBe(true);

    const wrong = await repo.ingestCustomerInfo({ product_id: productId, rows: [{ language: 'en', field_key: 'purpose', body: 'EN purpose', source_ids: [officialSource], ja_source_hash: 'not-the-hash', model_id: null, prompt_version: null }] });
    expect(wrong).toMatchObject({ ok: false, code: 'ja_source_changed' });

    const en = REQUIRED.map((field) => ({ language: 'en' as const, field_key: field, body: `EN ${field}`, source_ids: [officialSource], ja_source_hash: repo.hashJaBody(`JA ${field}`), model_id: 'm', prompt_version: 'v1' }));
    expect((await repo.ingestCustomerInfo({ product_id: productId, rows: en })).ok).toBe(true);
    const status = await pool.query(`SELECT DISTINCT status FROM product_customer_info WHERE product_id = $1`, [productId]);
    expect(status.rows).toEqual([{ status: 'draft' }]);
  });

  it('will not publish a translation before its Japanese source', async () => {
    const result = await repo.reviewCustomerInfoRow(await rowId('en', 'purpose'), { action: 'approve', body: null }, reviewer);
    expect(result).toEqual({ ok: false, code: 'ja_not_published' });
  });

  it('publishes a card only when every required field is approved, with one audit row per approval', async () => {
    const before = Number((await pool.query('SELECT COUNT(*) FROM enrichment_audit WHERE event = $1', ['customer_info_approve'])).rows[0].count);
    for (const field of REQUIRED) {
      expect((await repo.reviewCustomerInfoRow(await rowId('ja', field), { action: 'approve', body: null }, reviewer)).ok).toBe(true);
    }
    for (const field of REQUIRED.slice(0, -1)) {
      expect((await repo.reviewCustomerInfoRow(await rowId('en', field), { action: 'approve', body: null }, reviewer)).ok).toBe(true);
    }
    expect(await repo.getCustomerInfoCard(productId, 'en')).toEqual({ status: 'unavailable', available_languages: [] });

    await repo.reviewCustomerInfoRow(await rowId('en', 'ingredients'), { action: 'approve', body: null }, reviewer);
    const lookup = await repo.getCustomerInfoCard(productId, 'en');
    expect(lookup.status).toBe('ok');
    if (lookup.status === 'ok') {
      expect(lookup.card.product_name).toBe('葛根湯エキス錠');
      expect(lookup.card.fields.unique_features).toBe('EN unique_features');
      expect(lookup.card.available_languages).toEqual(['en']);
    }
    expect(await repo.getCustomerInfoCard(productId, 'zh-Hans')).toMatchObject({ status: 'unavailable' });
    expect(await repo.getCustomerInfoCard(privateProductId, 'en')).toEqual({ status: 'not_found' });
    const after = Number((await pool.query('SELECT COUNT(*) FROM enrichment_audit WHERE event = $1', ['customer_info_approve'])).rows[0].count);
    expect(after - before).toBe(REQUIRED.length * 2);
  });

  it('puts published cards in the offline bundle', async () => {
    const bundle = await repo.getCustomerInfoBundle(0);
    expect(bundle.carded_product_ids).toEqual([productId]);
    expect(bundle.products[0].cards.en?.fields.purpose).toBe('EN purpose');
    expect(await repo.getCustomerInfoBundle(bundle.version)).toMatchObject({ products: [], carded_product_ids: [productId] });
  });

  it('marks translations stale and hides the card when the Japanese source changes', async () => {
    const { version } = await repo.getCustomerInfoBundle(0);
    const result = await repo.reviewCustomerInfoRow(await rowId('ja', 'purpose'), { action: 'approve', body: 'JA purpose (改訂)' }, reviewer);
    expect(result.ok && result.staled_row_ids).toEqual([await rowId('en', 'purpose')]);
    expect(await repo.getCustomerInfoCard(productId, 'en')).toMatchObject({ status: 'unavailable' });

    const bundle = await repo.getCustomerInfoBundle(version);
    expect(bundle.version).toBeGreaterThan(version);
    expect(bundle.carded_product_ids).toEqual([]);
  });

  it('rejects with a reason and audits it', async () => {
    const id = await rowId('en', 'purpose');
    const result = await repo.reviewCustomerInfoRow(id, { action: 'reject', reason: 'out of date' }, reviewer);
    expect(result).toMatchObject({ ok: true, status: 'rejected' });
    const audit = await pool.query(`SELECT details FROM enrichment_audit WHERE event = 'customer_info_reject' ORDER BY id DESC LIMIT 1`);
    expect(audit.rows[0].details).toMatchObject({ row_id: id, reason: 'out of date', status_after: 'rejected' });
  });

  it('blocks effect claims on a plain health food', async () => {
    expect(await repo.setProductClassification(productId, 'supplement', 'food', reviewer)).toBe(true);
    const result = await repo.reviewCustomerInfoRow(await rowId('ja', 'unique_features'), { action: 'approve', body: '免疫力を高める' }, reviewer);
    expect(result).toEqual({ ok: false, code: 'blocked_claims', blocked: ['免疫力'] });
  });

  it('enforces that a published row has a reviewer', async () => {
    await expect(pool.query(`UPDATE product_customer_info SET status = 'published', reviewed_by = NULL WHERE id = $1`, [await rowId('en', 'risks')]))
      .rejects.toThrow(/product_customer_info_published_reviewed/);
  });
});
