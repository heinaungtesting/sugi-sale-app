// Pure rules for customer-facing product info cards. No I/O here so the API,
// repository, and client cache can share one definition of "a complete card".

export const CUSTOMER_LANGUAGES = ['en', 'zh-Hans'] as const;
export const CONTENT_LANGUAGES = ['ja', ...CUSTOMER_LANGUAGES] as const;
export const PRODUCT_TYPES = ['medicine', 'kampo', 'supplement', 'other'] as const;
export const RISK_CLASSES = ['class2', 'designated2', 'class3', 'quasi_drug', 'food'] as const;
export const ROW_STATUSES = ['draft', 'published', 'rejected', 'stale'] as const;

// Card sections in display order: what makes it different, what it is for,
// who should not take it, then what is in it.
export const REQUIRED_FIELDS = ['display_name', 'unique_features', 'purpose', 'risks', 'ingredients'] as const;
export const OPTIONAL_FIELDS = ['kampo_formula', 'claim'] as const;
export const FIELD_KEYS = [...REQUIRED_FIELDS, ...OPTIONAL_FIELDS] as const;

export type CustomerLanguage = (typeof CUSTOMER_LANGUAGES)[number];
export type ContentLanguage = (typeof CONTENT_LANGUAGES)[number];
export type ProductType = (typeof PRODUCT_TYPES)[number];
export type RiskClass = (typeof RISK_CLASSES)[number];
export type RowStatus = (typeof ROW_STATUSES)[number];
export type FieldKey = (typeof FIELD_KEYS)[number];

export const MAX_BODY_LENGTH = 4000;
export const MAX_INGEST_ROWS = 64;

export type CustomerInfoRow = {
  id: number;
  product_id: number;
  language: ContentLanguage;
  field_key: FieldKey;
  body: string;
  status: RowStatus;
  ja_source_hash: string | null;
  content_version: number;
  reviewed_at: string | null;
};

export type CustomerInfoCard = {
  product_id: number;
  product_name: string;
  language: CustomerLanguage;
  available_languages: CustomerLanguage[];
  product_type: ProductType;
  risk_class: RiskClass | null;
  fields: Partial<Record<FieldKey, string>>;
  content_version: number;
  reviewed_at: string | null;
};

export type ProductCardSource = {
  product_id: number;
  product_name: string;
  product_type: ProductType;
  risk_class: RiskClass | null;
  rows: CustomerInfoRow[];
};

export function isCustomerLanguage(value: unknown): value is CustomerLanguage {
  return typeof value === 'string' && (CUSTOMER_LANGUAGES as readonly string[]).includes(value);
}

export function isContentLanguage(value: unknown): value is ContentLanguage {
  return typeof value === 'string' && (CONTENT_LANGUAGES as readonly string[]).includes(value);
}

export function isFieldKey(value: unknown): value is FieldKey {
  return typeof value === 'string' && (FIELD_KEYS as readonly string[]).includes(value);
}

export function isProductType(value: unknown): value is ProductType {
  return typeof value === 'string' && (PRODUCT_TYPES as readonly string[]).includes(value);
}

export function isRiskClass(value: unknown): value is RiskClass {
  return typeof value === 'string' && (RISK_CLASSES as readonly string[]).includes(value);
}

function publishedFields(rows: CustomerInfoRow[], language: CustomerLanguage) {
  const fields: Partial<Record<FieldKey, string>> = {};
  for (const row of rows) {
    if (row.language === language && row.status === 'published') fields[row.field_key] = row.body;
  }
  return fields;
}

/** A language is shown only when every required field is published in it (FR-4). */
export function availableLanguages(rows: CustomerInfoRow[]): CustomerLanguage[] {
  return CUSTOMER_LANGUAGES.filter((language) => {
    const fields = publishedFields(rows, language);
    return REQUIRED_FIELDS.every((key) => Boolean(fields[key]?.trim()));
  });
}

/** Builds every complete card for one product; an empty object means no card. */
export function buildCards(source: ProductCardSource): Partial<Record<CustomerLanguage, CustomerInfoCard>> {
  const languages = availableLanguages(source.rows);
  const cards: Partial<Record<CustomerLanguage, CustomerInfoCard>> = {};
  for (const language of languages) {
    const languageRows = source.rows.filter((row) => row.language === language && row.status === 'published');
    const fields = publishedFields(source.rows, language);
    // Optional sections only apply to their product type.
    if (source.product_type !== 'kampo') delete fields.kampo_formula;
    if (source.product_type !== 'supplement') delete fields.claim;
    cards[language] = {
      product_id: source.product_id,
      product_name: source.product_name,
      language,
      available_languages: languages,
      product_type: source.product_type,
      risk_class: source.risk_class,
      fields,
      content_version: Math.max(0, ...source.rows.map((row) => row.content_version)),
      reviewed_at: languageRows
        .map((row) => row.reviewed_at)
        .filter((value): value is string => Boolean(value))
        .sort()
        .at(-1) ?? null,
    };
  }
  return cards;
}

// Effect words that must never appear on a plain health food (健康食品 with no
// registered claim). The review screen highlights them; approval is refused.
export const EFFECT_CLAIM_BLOCKLIST = [
  '治る', '治す', '治療', '効く', '予防', '若返り', 'アンチエイジング', '免疫力',
  'cure', 'cures', 'heal', 'heals', 'treats', 'prevents', 'anti-aging', 'antiaging', 'boosts immunity',
  '治疗', '治愈', '预防', '抗衰老', '增强免疫',
] as const;

export function findBlockedClaims(text: string): string[] {
  const lower = text.toLowerCase();
  return EFFECT_CLAIM_BLOCKLIST.filter((word) => {
    if (!/^[a-z -]+$/.test(word)) return lower.includes(word);
    return new RegExp(`(^|[^a-z])${word.replace(/[-\s]/g, '[-\\s]?')}([^a-z]|$)`).test(lower);
  });
}

/** Plain 健康食品 = a supplement with no published registered claim in that language. */
export function requiresClaimBlocklist(productType: ProductType, hasRegisteredClaim: boolean): boolean {
  return productType === 'supplement' && !hasRegisteredClaim;
}

// ── Ingest validation ────────────────────────────────────────────────────────

const REVIEW_KEYS = ['status', 'reviewed_by', 'reviewed_at', 'reviewedBy', 'reviewedAt'];

export type IngestRow = {
  language: ContentLanguage;
  field_key: FieldKey;
  body: string;
  source_ids: number[];
  ja_source_hash: string | null;
  model_id: string | null;
  prompt_version: string | null;
};

export type IngestPayload = { product_id: number; rows: IngestRow[] };

export type IngestValidation = { ok: true; value: IngestPayload } | { ok: false; error: string };

function optionalText(value: unknown, max: number): string | null | undefined {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string' || value.length > max) return undefined;
  return value;
}

/** Hermes may only write drafts: any review field anywhere in the payload is refused. */
export function validateIngestPayload(input: unknown): IngestValidation {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return { ok: false, error: 'invalid payload' };
  const body = input as Record<string, unknown>;
  if (REVIEW_KEYS.some((key) => key in body)) return { ok: false, error: 'review fields are not accepted' };
  const productId = Number(body.product_id);
  if (!Number.isSafeInteger(productId) || productId <= 0) return { ok: false, error: 'invalid product_id' };
  if (!Array.isArray(body.rows) || body.rows.length === 0 || body.rows.length > MAX_INGEST_ROWS) {
    return { ok: false, error: `rows must contain 1-${MAX_INGEST_ROWS} items` };
  }

  const rows: IngestRow[] = [];
  const seen = new Set<string>();
  for (const raw of body.rows) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, error: 'invalid row' };
    const row = raw as Record<string, unknown>;
    if (REVIEW_KEYS.some((key) => key in row)) return { ok: false, error: 'review fields are not accepted' };
    if (!isContentLanguage(row.language)) return { ok: false, error: 'invalid language' };
    if (!isFieldKey(row.field_key)) return { ok: false, error: 'invalid field_key' };
    if (typeof row.body !== 'string' || !row.body.trim() || row.body.length > MAX_BODY_LENGTH) {
      return { ok: false, error: 'invalid body' };
    }
    const key = `${row.language}:${row.field_key}`;
    if (seen.has(key)) return { ok: false, error: `duplicate row ${key}` };
    seen.add(key);

    const sourceIds = Array.isArray(row.source_ids) ? row.source_ids.map(Number) : [];
    if (sourceIds.length === 0 || sourceIds.some((id) => !Number.isSafeInteger(id) || id <= 0)) {
      return { ok: false, error: 'every row must cite source_ids' };
    }

    const jaSourceHash = optionalText(row.ja_source_hash, 128);
    if (jaSourceHash === undefined) return { ok: false, error: 'invalid ja_source_hash' };
    if (row.language !== 'ja' && !jaSourceHash) return { ok: false, error: 'translations require ja_source_hash' };
    const modelId = optionalText(row.model_id, 200);
    const promptVersion = optionalText(row.prompt_version, 200);
    if (modelId === undefined || promptVersion === undefined) return { ok: false, error: 'invalid model metadata' };

    rows.push({
      language: row.language,
      field_key: row.field_key,
      body: row.body.trim(),
      source_ids: [...new Set(sourceIds)],
      ja_source_hash: row.language === 'ja' ? null : jaSourceHash,
      model_id: modelId,
      prompt_version: promptVersion,
    });
  }
  return { ok: true, value: { product_id: productId, rows } };
}

// ── Review actions ───────────────────────────────────────────────────────────

export type ReviewAction =
  | { action: 'approve'; body: string | null }
  | { action: 'edit'; body: string }
  | { action: 'reject'; reason: string };

export function validateReviewAction(input: unknown): ReviewAction | null {
  if (!input || typeof input !== 'object') return null;
  const body = input as Record<string, unknown>;
  const text = typeof body.body === 'string' ? body.body.trim() : null;
  if (text !== null && (!text || text.length > MAX_BODY_LENGTH)) return null;
  if (body.action === 'approve') return { action: 'approve', body: text };
  if (body.action === 'edit') return text ? { action: 'edit', body: text } : null;
  if (body.action === 'reject') {
    const reason = typeof body.reason === 'string' ? body.reason.trim() : '';
    return reason && reason.length <= 500 ? { action: 'reject', reason } : null;
  }
  return null;
}

// ── Customer-facing copy ─────────────────────────────────────────────────────

export const CARD_COPY = {
  en: {
    toggle: 'EN',
    close: 'Close',
    sections: {
      unique_features: 'What makes it different',
      purpose: 'What it is for',
      risks: 'Risks',
      ingredients: 'Ingredients',
      kampo_formula: 'Formula',
      claim: 'Registered claim',
    },
    productType: { medicine: 'Pharmacy medicine', kampo: 'Kampo medicine', supplement: 'Food supplement', other: 'Product' },
    riskClass: {
      class2: 'Class 2', designated2: 'Designated Class 2', class3: 'Class 3', quasi_drug: 'Quasi-drug', food: 'Food',
    },
    supplementNote: 'This is a food, not a medicine.',
    disclaimer: 'For reference. Read the package insert and ask staff if unsure.',
  },
  'zh-Hans': {
    toggle: '中文',
    close: '关闭',
    sections: {
      unique_features: '产品特点',
      purpose: '用途',
      risks: '风险与注意事项',
      ingredients: '成分',
      kampo_formula: '处方',
      claim: '注册功能声明',
    },
    productType: { medicine: '药店药品', kampo: '汉方药', supplement: '保健食品', other: '商品' },
    riskClass: {
      class2: '第2类', designated2: '指定第2类', class3: '第3类', quasi_drug: '医药部外品', food: '食品',
    },
    supplementNote: '本品为食品，不是药品。',
    disclaimer: '仅供参考。请阅读说明书，如有疑问请咨询店员。',
  },
} as const satisfies Record<CustomerLanguage, unknown>;

export const CARD_SECTION_ORDER: Exclude<FieldKey, 'display_name'>[] = ['unique_features', 'purpose', 'risks', 'ingredients', 'kampo_formula', 'claim'];

export function badgeText(card: Pick<CustomerInfoCard, 'language' | 'product_type' | 'risk_class'>): string {
  const copy = CARD_COPY[card.language];
  const type = copy.productType[card.product_type];
  return card.risk_class ? `${type} (${copy.riskClass[card.risk_class]})` : type;
}
