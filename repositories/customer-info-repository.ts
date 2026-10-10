import { createHash } from 'node:crypto';
import type { PoolClient } from 'pg';
import { pool, query, queryOne } from '@/lib/db';
import {
  buildCards,
  findBlockedClaims,
  requiresClaimBlocklist,
  type ContentLanguage,
  type CustomerInfoCard,
  type CustomerInfoRow,
  type CustomerLanguage,
  type FieldKey,
  type IngestPayload,
  type ProductCardSource,
  type ProductType,
  type ReviewAction,
  type RiskClass,
  type RowStatus,
} from '@/domain/customer-info/customer-info';
import type { DraftRequestProduct } from '@/domain/customer-info/hermes';

export function hashJaBody(body: string): string {
  return createHash('sha256').update(body, 'utf8').digest('hex');
}

type DbRow = {
  id: string;
  product_id: string;
  language: ContentLanguage;
  field_key: FieldKey;
  body: string;
  status: RowStatus;
  ja_source_hash: string | null;
  content_version: string;
  reviewed_at: Date | string | null;
};

type DbProduct = { id: string; product_name: string; product_type: ProductType; risk_class: RiskClass | null };

function toRow(row: DbRow): CustomerInfoRow {
  return {
    id: Number(row.id),
    product_id: Number(row.product_id),
    language: row.language,
    field_key: row.field_key,
    body: row.body,
    status: row.status,
    ja_source_hash: row.ja_source_hash,
    content_version: Number(row.content_version),
    reviewed_at: row.reviewed_at ? new Date(row.reviewed_at).toISOString() : null,
  };
}

const ROW_COLUMNS = 'id, product_id, language, field_key, body, status, ja_source_hash, content_version, reviewed_at';

// Only active global (shared) products can carry a customer card (FR-2).
const CARD_PRODUCT_FILTER = 'p.is_active = TRUE AND p.user_id IS NULL';

async function loadCardSources(productIds: number[]): Promise<ProductCardSource[]> {
  if (productIds.length === 0) return [];
  const [products, rows] = await Promise.all([
    query<DbProduct>(
      `SELECT p.id, p.product_name, p.product_type, p.risk_class
       FROM products p
       WHERE p.id = ANY($1::bigint[]) AND ${CARD_PRODUCT_FILTER}`,
      [productIds],
    ),
    query<DbRow>(
      `SELECT ${ROW_COLUMNS} FROM product_customer_info
       WHERE product_id = ANY($1::bigint[]) AND status = 'published' AND language <> 'ja'`,
      [productIds],
    ),
  ]);
  return products.map((product) => ({
    product_id: Number(product.id),
    product_name: product.product_name,
    product_type: product.product_type,
    risk_class: product.risk_class,
    rows: rows.filter((row) => row.product_id === product.id).map(toRow),
  }));
}

export type CardLookup =
  | { status: 'not_found' }
  | { status: 'unavailable'; available_languages: CustomerLanguage[] }
  | { status: 'ok'; card: CustomerInfoCard };

export async function getCustomerInfoCard(productId: number, language: CustomerLanguage): Promise<CardLookup> {
  const [source] = await loadCardSources([productId]);
  if (!source) return { status: 'not_found' };
  const cards = buildCards(source);
  const card = cards[language];
  if (!card) return { status: 'unavailable', available_languages: Object.keys(cards) as CustomerLanguage[] };
  return { status: 'ok', card };
}

export type CustomerInfoBundle = {
  version: number;
  products: Array<{ product_id: number; cards: Partial<Record<CustomerLanguage, CustomerInfoCard>> }>;
  /** Every product that currently has a card; the client drops anything else. */
  carded_product_ids: number[];
};

export async function getCustomerInfoBundle(since: number): Promise<CustomerInfoBundle> {
  const versionRow = await queryOne<{ version: string }>(
    'SELECT COALESCE(MAX(content_version), 0)::text AS version FROM product_customer_info',
  );
  const version = Number(versionRow?.version ?? 0);
  const changed = await query<{ product_id: string }>(
    `SELECT DISTINCT pci.product_id
     FROM product_customer_info pci
     JOIN products p ON p.id = pci.product_id
     WHERE pci.content_version > $1 AND ${CARD_PRODUCT_FILTER}`,
    [since],
  );
  const changedSources = await loadCardSources(changed.map((row) => Number(row.product_id)));
  const products = changedSources.map((source) => ({ product_id: source.product_id, cards: buildCards(source) }));

  const publishedProducts = await query<{ product_id: string }>(
    `SELECT DISTINCT pci.product_id
     FROM product_customer_info pci
     JOIN products p ON p.id = pci.product_id
     WHERE pci.status = 'published' AND pci.language <> 'ja' AND ${CARD_PRODUCT_FILTER}`,
  );
  const allSources = since > 0
    ? await loadCardSources(publishedProducts.map((row) => Number(row.product_id)))
    : changedSources;
  const carded = allSources
    .filter((source) => Object.keys(buildCards(source)).length > 0)
    .map((source) => source.product_id);
  return { version, products: products.filter((product) => Object.keys(product.cards).length > 0), carded_product_ids: carded };
}

// ── Review queue ─────────────────────────────────────────────────────────────

export type ReviewQueueProduct = {
  product_id: number;
  product_name: string;
  product_type: ProductType;
  risk_class: RiskClass | null;
  oldest_pending_at: string;
  rows: Array<CustomerInfoRow & { source_ids: number[]; reject_reason: string | null; model_id: string | null; prompt_version: string | null }>;
  sources: Array<{ id: number; url: string; source_type: string; is_official: boolean }>;
};

export async function listReviewQueue(statuses: RowStatus[] = ['draft', 'stale']): Promise<ReviewQueueProduct[]> {
  const products = await query<DbProduct & { oldest_pending_at: Date }>(
    `SELECT p.id, p.product_name, p.product_type, p.risk_class, MIN(pci.updated_at) AS oldest_pending_at
     FROM product_customer_info pci
     JOIN products p ON p.id = pci.product_id
     WHERE pci.status = ANY($1::text[]) AND ${CARD_PRODUCT_FILTER}
     GROUP BY p.id
     ORDER BY oldest_pending_at ASC
     LIMIT 50`,
    [statuses],
  );
  if (products.length === 0) return [];
  const ids = products.map((product) => product.id);
  const [rows, sources] = await Promise.all([
    query<DbRow & { source_ids: string[]; reject_reason: string | null; model_id: string | null; prompt_version: string | null }>(
      `SELECT ${ROW_COLUMNS}, source_ids, reject_reason, model_id, prompt_version
       FROM product_customer_info WHERE product_id = ANY($1::bigint[])
       ORDER BY product_id, field_key, language`,
      [ids],
    ),
    query<{ id: string; product_id: string; url: string; source_type: string; is_official: boolean }>(
      `SELECT id, product_id, url, source_type, is_official
       FROM enrichment_sources WHERE product_id = ANY($1::bigint[]) ORDER BY id`,
      [ids],
    ),
  ]);
  return products.map((product) => ({
    product_id: Number(product.id),
    product_name: product.product_name,
    product_type: product.product_type,
    risk_class: product.risk_class,
    oldest_pending_at: new Date(product.oldest_pending_at).toISOString(),
    rows: rows.filter((row) => row.product_id === product.id).map((row) => ({
      ...toRow(row),
      source_ids: row.source_ids.map(Number),
      reject_reason: row.reject_reason,
      model_id: row.model_id,
      prompt_version: row.prompt_version,
    })),
    sources: sources.filter((source) => source.product_id === product.id).map((source) => ({
      id: Number(source.id),
      url: source.url,
      source_type: source.source_type,
      is_official: source.is_official,
    })),
  }));
}

// ── Writes ───────────────────────────────────────────────────────────────────

async function withTransaction<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

/**
 * FR-12: when a Japanese source changes, every translation of that field that
 * was made from a different Japanese text is hidden until it is re-reviewed.
 */
async function markTranslationsStale(client: PoolClient, productId: number, fieldKey: FieldKey, jaHash: string): Promise<number[]> {
  const result = await client.query<{ id: string }>(
    `UPDATE product_customer_info
     SET status = 'stale',
         content_version = nextval('customer_info_content_version_seq'),
         updated_at = now()
     WHERE product_id = $1 AND field_key = $2 AND language <> 'ja'
       AND status IN ('draft', 'published')
       AND ja_source_hash IS DISTINCT FROM $3
     RETURNING id`,
    [productId, fieldKey, jaHash],
  );
  return result.rows.map((row) => Number(row.id));
}

async function writeAudit(client: PoolClient, productId: number, event: string, actor: string, details: Record<string, unknown>) {
  await client.query(
    `INSERT INTO enrichment_audit (product_id, event, actor, details) VALUES ($1, $2, $3, $4::jsonb)`,
    [productId, event, actor, JSON.stringify(details)],
  );
}

export type ReviewResult =
  | { ok: true; status: RowStatus; product_id: number; language: ContentLanguage; field_key: FieldKey; staled_row_ids: number[] }
  | { ok: false; code: 'not_found' | 'ja_not_published' | 'ja_source_changed' | 'blocked_claims'; blocked?: string[] };

export async function reviewCustomerInfoRow(
  rowId: number,
  action: ReviewAction,
  reviewer: { id: number; username: string },
): Promise<ReviewResult> {
  return withTransaction(async (client) => {
    const found = await client.query<DbRow & { product_type: ProductType }>(
      `SELECT pci.id, pci.product_id, pci.language, pci.field_key, pci.body, pci.status,
              pci.ja_source_hash, pci.content_version, pci.reviewed_at, p.product_type
       FROM product_customer_info pci
       JOIN products p ON p.id = pci.product_id
       WHERE pci.id = $1 AND ${CARD_PRODUCT_FILTER}
       FOR UPDATE OF pci`,
      [rowId],
    );
    const current = found.rows[0];
    if (!current) return { ok: false, code: 'not_found' };
    const productId = Number(current.product_id);
    const nextBody = action.action === 'reject' ? current.body : (action.body ?? current.body);

    if (action.action === 'approve') {
      if (current.language !== 'ja') {
        const ja = await client.query<{ status: RowStatus; ja_source_hash: string | null }>(
          `SELECT status, ja_source_hash FROM product_customer_info
           WHERE product_id = $1 AND field_key = $2 AND language = 'ja'`,
          [productId, current.field_key],
        );
        if (ja.rows[0]?.status !== 'published') return { ok: false, code: 'ja_not_published' };
        if (ja.rows[0].ja_source_hash !== current.ja_source_hash) return { ok: false, code: 'ja_source_changed' };
      }
      if (current.field_key !== 'claim') {
        const claim = await client.query(
          `SELECT 1 FROM product_customer_info
           WHERE product_id = $1 AND language = $2 AND field_key = 'claim' AND status = 'published'`,
          [productId, current.language],
        );
        if (requiresClaimBlocklist(current.product_type, (claim.rowCount ?? 0) > 0)) {
          const blocked = findBlockedClaims(nextBody);
          if (blocked.length > 0) return { ok: false, code: 'blocked_claims', blocked };
        }
      }
    }

    const nextStatus: RowStatus = action.action === 'approve' ? 'published' : action.action === 'reject' ? 'rejected' : 'draft';
    const jaHash = current.language === 'ja' ? hashJaBody(nextBody) : current.ja_source_hash;
    await client.query(
      `UPDATE product_customer_info
       SET body = $2,
           status = $3,
           ja_source_hash = $4,
           reject_reason = $5,
           reviewed_by = CASE WHEN $3 = 'draft' THEN reviewed_by ELSE $6::bigint END,
           reviewed_at = CASE WHEN $3 = 'draft' THEN reviewed_at ELSE now() END,
           content_version = nextval('customer_info_content_version_seq'),
           updated_at = now()
       WHERE id = $1`,
      [rowId, nextBody, nextStatus, jaHash, action.action === 'reject' ? action.reason : null, reviewer.id],
    );

    const staled = current.language === 'ja' && jaHash
      ? await markTranslationsStale(client, productId, current.field_key, jaHash)
      : [];

    await writeAudit(client, productId, `customer_info_${action.action}`, reviewer.username, {
      row_id: rowId,
      reviewer_id: reviewer.id,
      field_key: current.field_key,
      language: current.language,
      status_before: current.status,
      status_after: nextStatus,
      body_before: current.body,
      body_after: nextBody,
      reason: action.action === 'reject' ? action.reason : null,
      staled_row_ids: staled,
    });

    return { ok: true, status: nextStatus, product_id: productId, language: current.language, field_key: current.field_key, staled_row_ids: staled };
  });
}

export type IngestResult =
  | { ok: true; written: Array<{ language: ContentLanguage; field_key: FieldKey; outcome: 'drafted' | 'unchanged' | 'kept_published' }>; staled_row_ids: number[] }
  | { ok: false; code: 'not_found' | 'invalid_sources' | 'ja_missing' | 'ja_source_changed'; detail?: string };

export async function ingestCustomerInfo(payload: IngestPayload): Promise<IngestResult> {
  return withTransaction(async (client) => {
    const product = await client.query(
      `SELECT p.id FROM products p WHERE p.id = $1 AND ${CARD_PRODUCT_FILTER} FOR UPDATE`,
      [payload.product_id],
    );
    if (product.rowCount === 0) return { ok: false, code: 'not_found' };

    const cited = [...new Set(payload.rows.flatMap((row) => row.source_ids))];
    const sources = await client.query<{ id: string }>(
      `SELECT id FROM enrichment_sources
       WHERE product_id = $1 AND id = ANY($2::bigint[])
         AND is_official = TRUE AND source_type <> 'review_aggregate' AND fetch_status = 'ok'`,
      [payload.product_id, cited],
    );
    if ((sources.rowCount ?? 0) !== cited.length) {
      return { ok: false, code: 'invalid_sources', detail: 'sources must belong to the product, be official, fetched, and not review aggregates' };
    }

    const written: Array<{ language: ContentLanguage; field_key: FieldKey; outcome: 'drafted' | 'unchanged' | 'kept_published' }> = [];
    const staled: number[] = [];
    // Japanese first, so translations in the same payload can match its hash.
    const ordered = [...payload.rows].sort((a, b) => Number(b.language === 'ja') - Number(a.language === 'ja'));
    for (const row of ordered) {
      const jaHash = row.language === 'ja' ? hashJaBody(row.body) : row.ja_source_hash;
      if (row.language !== 'ja') {
        const ja = await client.query<{ ja_source_hash: string | null }>(
          `SELECT ja_source_hash FROM product_customer_info WHERE product_id = $1 AND field_key = $2 AND language = 'ja'`,
          [payload.product_id, row.field_key],
        );
        if (!ja.rows[0]) return { ok: false, code: 'ja_missing', detail: row.field_key };
        if (ja.rows[0].ja_source_hash !== jaHash) return { ok: false, code: 'ja_source_changed', detail: `${row.language}:${row.field_key}` };
      }

      const existing = await client.query<{ body: string; status: RowStatus; ja_source_hash: string | null }>(
        `SELECT body, status, ja_source_hash FROM product_customer_info
         WHERE product_id = $1 AND language = $2 AND field_key = $3 FOR UPDATE`,
        [payload.product_id, row.language, row.field_key],
      );
      const current = existing.rows[0];
      if (current && current.body === row.body && current.ja_source_hash === jaHash && current.status !== 'rejected') {
        written.push({ language: row.language, field_key: row.field_key, outcome: 'unchanged' });
        continue;
      }
      // A live card is only changed by a reviewer; Hermes never replaces it.
      if (current?.status === 'published') {
        written.push({ language: row.language, field_key: row.field_key, outcome: 'kept_published' });
        continue;
      }
      await client.query(
        `INSERT INTO product_customer_info
           (product_id, language, field_key, body, status, source_ids, ja_source_hash, generated_by, model_id, prompt_version)
         VALUES ($1, $2, $3, $4, 'draft', $5::bigint[], $6, 'hermes', $7, $8)
         ON CONFLICT (product_id, language, field_key) DO UPDATE SET
           body = EXCLUDED.body,
           status = 'draft',
           reject_reason = NULL,
           source_ids = EXCLUDED.source_ids,
           ja_source_hash = EXCLUDED.ja_source_hash,
           generated_by = EXCLUDED.generated_by,
           model_id = EXCLUDED.model_id,
           prompt_version = EXCLUDED.prompt_version,
           content_version = nextval('customer_info_content_version_seq'),
           updated_at = now()`,
        [payload.product_id, row.language, row.field_key, row.body, row.source_ids, jaHash, row.model_id, row.prompt_version],
      );
      written.push({ language: row.language, field_key: row.field_key, outcome: 'drafted' });
      if (row.language === 'ja' && jaHash) staled.push(...await markTranslationsStale(client, payload.product_id, row.field_key, jaHash));
    }

    await writeAudit(client, payload.product_id, 'customer_info_ingested', 'hermes', {
      rows: written,
      staled_row_ids: staled,
    });
    return { ok: true, written, staled_row_ids: staled };
  });
}

export async function setProductClassification(
  productId: number,
  productType: ProductType,
  riskClass: RiskClass | null,
  actor: { id: number; username: string },
): Promise<boolean> {
  return withTransaction(async (client) => {
    const before = await client.query<{ product_type: string; risk_class: string | null }>(
      `SELECT p.product_type, p.risk_class FROM products p WHERE p.id = $1 AND ${CARD_PRODUCT_FILTER} FOR UPDATE`,
      [productId],
    );
    if (!before.rows[0]) return false;
    await client.query(
      'UPDATE products SET product_type = $2, risk_class = $3, updated_at = now() WHERE id = $1',
      [productId, productType, riskClass],
    );
    // The badge is part of every cached card, so cached cards must re-sync.
    await client.query(
      `UPDATE product_customer_info SET content_version = nextval('customer_info_content_version_seq')
       WHERE product_id = $1 AND status = 'published'`,
      [productId],
    );
    await writeAudit(client, productId, 'customer_info_classified', actor.username, {
      reviewer_id: actor.id,
      before: before.rows[0],
      after: { product_type: productType, risk_class: riskClass },
    });
    return true;
  });
}

// ── Hermes draft requests ────────────────────────────────────────────────────

export async function getDraftRequestProduct(productId: number): Promise<DraftRequestProduct | null> {
  const product = await queryOne<DbProduct & { category: string | null }>(
    `SELECT p.id, p.product_name, p.category, p.product_type, p.risk_class
     FROM products p WHERE p.id = $1 AND ${CARD_PRODUCT_FILTER}`,
    [productId],
  );
  if (!product) return null;
  const [existing, sources] = await Promise.all([
    query<{ language: string; field_key: string; status: RowStatus; ja_source_hash: string | null; body: string | null }>(
      `SELECT language, field_key, status, ja_source_hash,
              CASE WHEN language = 'ja' THEN body END AS body
       FROM product_customer_info
       WHERE product_id = $1 ORDER BY field_key, language`,
      [productId],
    ),
    query<{ id: string; url: string; source_type: string }>(
      `SELECT id, url, source_type FROM enrichment_sources
       WHERE product_id = $1 AND is_official = TRUE AND source_type <> 'review_aggregate' AND fetch_status = 'ok'
       ORDER BY id`,
      [productId],
    ),
  ]);
  return {
    product_id: Number(product.id),
    product_name: product.product_name,
    category: product.category,
    product_type: product.product_type,
    risk_class: product.risk_class,
    existing,
    sources: sources.map((source) => ({ id: Number(source.id), url: source.url, source_type: source.source_type })),
  };
}

export async function recordDraftRequest(productId: number, actor: { id: number; username: string }, details: Record<string, unknown>) {
  await query(
    `INSERT INTO enrichment_audit (product_id, event, actor, details) VALUES ($1, 'customer_info_draft_requested', $2, $3::jsonb)`,
    [productId, actor.username, JSON.stringify({ requested_by_id: actor.id, ...details })],
  );
}
