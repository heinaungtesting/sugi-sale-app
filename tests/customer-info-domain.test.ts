import { describe, expect, it } from 'vitest';
import {
  availableLanguages,
  badgeText,
  buildCards,
  CARD_SECTION_ORDER,
  findBlockedClaims,
  REQUIRED_FIELDS,
  requiresClaimBlocklist,
  validateIngestPayload,
  validateReviewAction,
  type CustomerInfoRow,
  type FieldKey,
} from '@/domain/customer-info/customer-info';

let nextId = 1;
function row(language: CustomerInfoRow['language'], field_key: FieldKey, status: CustomerInfoRow['status'] = 'published', body = `${language} ${field_key}`): CustomerInfoRow {
  return { id: nextId++, product_id: 12, language, field_key, body, status, ja_source_hash: 'h', content_version: nextId, reviewed_at: '2026-10-20T03:12:00.000Z' };
}
const complete = (language: 'en' | 'zh-Hans') => REQUIRED_FIELDS.map((key) => row(language, key));

describe('customer info cards', () => {
  it('orders sections as unique features, purpose, risks, ingredients', () => {
    expect(CARD_SECTION_ORDER.slice(0, 4)).toEqual(['unique_features', 'purpose', 'risks', 'ingredients']);
    expect(REQUIRED_FIELDS).toEqual(['display_name', 'unique_features', 'purpose', 'risks', 'ingredients']);
  });

  it('shows a language only when every required field is published in it', () => {
    const rows = [...complete('en'), ...complete('zh-Hans').map((r) => (r.field_key === 'risks' ? { ...r, status: 'draft' as const } : r))];
    expect(availableLanguages(rows)).toEqual(['en']);
  });

  it('hides stale and rejected rows', () => {
    const rows = complete('en').map((r) => (r.field_key === 'purpose' ? { ...r, status: 'stale' as const } : r));
    expect(availableLanguages(rows)).toEqual([]);
    expect(buildCards({ product_id: 12, product_name: '葛根湯', product_type: 'kampo', risk_class: 'class2', rows })).toEqual({});
  });

  it('builds a card with the Japanese name and only the fields its type allows', () => {
    const rows = [...complete('en'), row('en', 'kampo_formula'), row('en', 'claim')];
    const cards = buildCards({ product_id: 12, product_name: '葛根湯', product_type: 'kampo', risk_class: 'class2', rows });
    expect(cards.en?.product_name).toBe('葛根湯');
    expect(cards.en?.fields.kampo_formula).toBe('en kampo_formula');
    expect(cards.en?.fields.claim).toBeUndefined();
    expect(cards.en?.available_languages).toEqual(['en']);
    expect(cards['zh-Hans']).toBeUndefined();
  });

  it('describes the risk class in plain words', () => {
    expect(badgeText({ language: 'en', product_type: 'medicine', risk_class: 'class2' })).toBe('Pharmacy medicine (Class 2)');
    expect(badgeText({ language: 'zh-Hans', product_type: 'supplement', risk_class: null })).toBe('保健食品');
  });
});

describe('effect-claim blocklist', () => {
  it('flags effect words in Japanese, English, and Chinese', () => {
    expect(findBlockedClaims('Boosts immunity and is anti-aging')).toEqual(['anti-aging', 'boosts immunity']);
    expect(findBlockedClaims('風邪を予防します')).toEqual(['予防']);
    expect(findBlockedClaims('可以抗衰老')).toEqual(['抗衰老']);
  });

  it('does not flag words that only contain a blocked English word', () => {
    expect(findBlockedClaims('Secure cap. Treatsy snack.')).toEqual([]);
  });

  it('applies only to plain health foods', () => {
    expect(requiresClaimBlocklist('supplement', false)).toBe(true);
    expect(requiresClaimBlocklist('supplement', true)).toBe(false);
    expect(requiresClaimBlocklist('medicine', false)).toBe(false);
  });
});

describe('ingest validation', () => {
  const valid = {
    product_id: 12,
    rows: [
      { language: 'ja', field_key: 'purpose', body: '風邪のひきはじめに', source_ids: [3] },
      { language: 'en', field_key: 'purpose', body: 'For early colds', source_ids: [3], ja_source_hash: 'abc' },
    ],
  };

  it('accepts drafts that cite sources', () => {
    const result = validateIngestPayload(valid);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.rows[0].ja_source_hash).toBeNull();
  });

  it('refuses any review field, at the top level or in a row', () => {
    expect(validateIngestPayload({ ...valid, status: 'published' })).toEqual({ ok: false, error: 'review fields are not accepted' });
    expect(validateIngestPayload({ ...valid, rows: [{ ...valid.rows[0], status: 'published' }] })).toEqual({ ok: false, error: 'review fields are not accepted' });
    expect(validateIngestPayload({ ...valid, rows: [{ ...valid.rows[0], reviewed_by: 1 }] })).toEqual({ ok: false, error: 'review fields are not accepted' });
  });

  it('requires sources, a known field and language, and a hash on translations', () => {
    expect(validateIngestPayload({ ...valid, rows: [{ ...valid.rows[0], source_ids: [] }] }).ok).toBe(false);
    expect(validateIngestPayload({ ...valid, rows: [{ ...valid.rows[0], field_key: 'how_to_take' }] }).ok).toBe(false);
    expect(validateIngestPayload({ ...valid, rows: [{ ...valid.rows[0], language: 'ko' }] }).ok).toBe(false);
    expect(validateIngestPayload({ ...valid, rows: [{ ...valid.rows[1], ja_source_hash: undefined }] })).toEqual({ ok: false, error: 'translations require ja_source_hash' });
    expect(validateIngestPayload({ ...valid, rows: [valid.rows[0], valid.rows[0]] }).ok).toBe(false);
  });
});

describe('review actions', () => {
  it('accepts approve, edit, and reject with a reason', () => {
    expect(validateReviewAction({ action: 'approve' })).toEqual({ action: 'approve', body: null });
    expect(validateReviewAction({ action: 'approve', body: ' fixed ' })).toEqual({ action: 'approve', body: 'fixed' });
    expect(validateReviewAction({ action: 'edit', body: 'new text' })).toEqual({ action: 'edit', body: 'new text' });
    expect(validateReviewAction({ action: 'reject', reason: 'wrong dose' })).toEqual({ action: 'reject', reason: 'wrong dose' });
  });

  it('refuses unknown actions, empty edits, and rejects without a reason', () => {
    expect(validateReviewAction({ action: 'publish_all' })).toBeNull();
    expect(validateReviewAction({ action: 'edit', body: '  ' })).toBeNull();
    expect(validateReviewAction({ action: 'reject' })).toBeNull();
  });
});
