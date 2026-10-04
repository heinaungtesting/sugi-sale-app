'use client';

import { useState } from 'react';
import { csrfFetch } from '@/lib/csrf-client';
import {
  CONTENT_LANGUAGES,
  FIELD_KEYS,
  PRODUCT_TYPES,
  RISK_CLASSES,
  findBlockedClaims,
  type ContentLanguage,
  type FieldKey,
  type ProductType,
  type RiskClass,
  type RowStatus,
} from '@/domain/customer-info/customer-info';

type QueueRow = {
  id: number;
  language: ContentLanguage;
  field_key: FieldKey;
  body: string;
  status: RowStatus;
  reject_reason: string | null;
  source_ids: number[];
  model_id: string | null;
  prompt_version: string | null;
};

type QueueProduct = {
  product_id: number;
  product_name: string;
  product_type: ProductType;
  risk_class: RiskClass | null;
  rows: QueueRow[];
  sources: Array<{ id: number; url: string; source_type: string; is_official: boolean }>;
};

const FIELD_LABELS: Record<FieldKey, string> = {
  display_name: '表示名',
  unique_features: '特徴（他商品との違い）',
  purpose: '用途',
  risks: 'リスク・注意',
  ingredients: '成分',
  kampo_formula: '処方（漢方）',
  claim: '表示制度の届出表示',
};

const LANGUAGE_LABELS: Record<ContentLanguage, string> = { ja: '日本語（原文）', en: 'English', 'zh-Hans': '简体中文' };
const STATUS_LABELS: Record<RowStatus, string> = { draft: '下書き', published: '公開中', rejected: '差し戻し', stale: '要再確認' };
const ERROR_LABELS: Record<string, string> = {
  ja_not_published: '先に日本語の原文を承認してください。',
  ja_source_changed: '日本語の原文が変わっています。再翻訳が必要です。',
  blocked_claims: '健康食品に効能表現は使えません。',
};

function RowEditor({ row, productType, hasClaim, onChanged }: { row: QueueRow; productType: ProductType; hasClaim: boolean; onChanged: () => Promise<void> }) {
  const [body, setBody] = useState(row.body);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const blocked = productType === 'supplement' && !hasClaim && row.field_key !== 'claim' ? findBlockedClaims(body) : [];

  async function send(payload: Record<string, unknown>) {
    setBusy(true);
    setError(null);
    const response = await csrfFetch(`/api/admin/customer-info/${row.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }).catch(() => null);
    setBusy(false);
    if (!response?.ok) {
      const data = await response?.json().catch(() => null) as { error?: string; blocked?: string[] } | null;
      setError(`${ERROR_LABELS[data?.error ?? ''] ?? '保存できませんでした。'}${data?.blocked?.length ? `（${data.blocked.join('、')}）` : ''}`);
      return;
    }
    await onChanged();
  }

  const edited = body.trim() !== row.body;
  return (
    <div className={`ci-row ci-row-${row.status}`}>
      <div className="ci-row-meta">
        <span className={`ci-status ci-status-${row.status}`}>{STATUS_LABELS[row.status]}</span>
        {row.reject_reason && <span className="ci-reject-reason">理由: {row.reject_reason}</span>}
      </div>
      <textarea value={body} onChange={(event) => setBody(event.target.value)} rows={4} lang={row.language} disabled={busy} />
      {blocked.length > 0 && <p className="ci-blocked" role="alert">効能表現: {blocked.join('、')}</p>}
      {error && <p className="ci-error" role="alert">{error}</p>}
      <div className="ci-actions">
        <button type="button" disabled={busy || blocked.length > 0} onClick={() => send({ action: 'approve', body: edited ? body : undefined })}>
          {edited ? '編集して承認' : '承認'}
        </button>
        {edited && <button type="button" className="secondary" disabled={busy} onClick={() => send({ action: 'edit', body })}>下書き保存</button>}
        <button
          type="button"
          className="secondary"
          disabled={busy}
          onClick={() => {
            const reason = window.prompt('差し戻しの理由');
            if (reason?.trim()) void send({ action: 'reject', reason: reason.trim() });
          }}
        >
          差し戻し
        </button>
      </div>
    </div>
  );
}

function Classification({ product, onChanged }: { product: QueueProduct; onChanged: () => Promise<void> }) {
  const [productType, setProductType] = useState(product.product_type);
  const [riskClass, setRiskClass] = useState(product.risk_class ?? '');
  const [message, setMessage] = useState<string | null>(null);

  async function save() {
    const response = await csrfFetch(`/api/admin/customer-info/products/${product.product_id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ product_type: productType, risk_class: riskClass || null }),
    }).catch(() => null);
    setMessage(response?.ok ? '分類を保存しました' : '分類を保存できませんでした');
    if (response?.ok) await onChanged();
  }

  return (
    <div className="ci-classification">
      <label>
        種類
        <select value={productType} onChange={(event) => setProductType(event.target.value as ProductType)}>
          {PRODUCT_TYPES.map((type) => <option key={type} value={type}>{type}</option>)}
        </select>
      </label>
      <label>
        リスク区分
        <select value={riskClass} onChange={(event) => setRiskClass(event.target.value)}>
          <option value="">なし</option>
          {RISK_CLASSES.map((value) => <option key={value} value={value}>{value}</option>)}
        </select>
      </label>
      <button type="button" className="secondary" onClick={() => void save()}>分類を保存</button>
      {message && <span className="muted">{message}</span>}
    </div>
  );
}

export function AdminCustomerInfoClient({ initialQueue }: { initialQueue: QueueProduct[] }) {
  const [queue, setQueue] = useState(initialQueue);
  const [statusFilter, setStatusFilter] = useState<'pending' | 'published' | 'rejected'>('pending');

  async function reload(filter = statusFilter) {
    const query = filter === 'pending' ? '' : `?status=${filter}`;
    const response = await fetch(`/api/admin/customer-info/queue${query}`, { cache: 'no-store' });
    if (response.ok) setQueue(await response.json());
  }

  return (
    <section className="page-card admin-customer-info" aria-label="お客様向け商品情報のレビュー">
      <h1>お客様向け商品情報のレビュー</h1>
      <p className="muted">項目ごとに承認します。一括承認はありません。英語・中国語は日本語の原文を承認した後に承認できます。</p>
      <div className="ci-filter" role="group" aria-label="表示">
        {(['pending', 'published', 'rejected'] as const).map((filter) => (
          <button
            key={filter}
            type="button"
            className={filter === statusFilter ? '' : 'secondary'}
            aria-pressed={filter === statusFilter}
            onClick={() => {
              setStatusFilter(filter);
              void reload(filter);
            }}
          >
            {filter === 'pending' ? '未承認' : filter === 'published' ? '公開中' : '差し戻し'}
          </button>
        ))}
      </div>

      {queue.length === 0 && <p className="muted">対象の商品はありません。</p>}

      {queue.map((product) => {
        const byKey = new Map(product.rows.map((row) => [`${row.language}:${row.field_key}`, row]));
        return (
          <article key={product.product_id} className="ci-product">
            <h2>{product.product_name}</h2>
            <Classification product={product} onChanged={() => reload()} />
            {product.sources.length > 0 && (
              <details className="ci-sources">
                <summary>出典 {product.sources.length}件</summary>
                <ul>
                  {product.sources.map((source) => (
                    <li key={source.id}>
                      #{source.id} <a href={source.url} target="_blank" rel="noreferrer noopener">{source.url}</a> ({source.source_type}{source.is_official ? '' : ', 非公式'})
                    </li>
                  ))}
                </ul>
              </details>
            )}
            {FIELD_KEYS.filter((key) => CONTENT_LANGUAGES.some((language) => byKey.has(`${language}:${key}`))).map((key) => (
              <section key={key} className="ci-field">
                <h3>{FIELD_LABELS[key]}</h3>
                <div className="ci-columns">
                  {CONTENT_LANGUAGES.map((language) => {
                    const row = byKey.get(`${language}:${key}`);
                    const hasClaim = byKey.get(`${language}:claim`)?.status === 'published';
                    return (
                      <div key={language} className="ci-column">
                        <h4>{LANGUAGE_LABELS[language]}</h4>
                        {row
                          ? <RowEditor key={`${row.id}:${row.status}:${row.body}`} row={row} productType={product.product_type} hasClaim={hasClaim} onChanged={() => reload()} />
                          : <p className="muted">未作成</p>}
                      </div>
                    );
                  })}
                </div>
              </section>
            ))}
          </article>
        );
      })}
    </section>
  );
}
