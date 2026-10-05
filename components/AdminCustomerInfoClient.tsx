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

type HermesSettings = { endpoint_url: string | null; token_set: boolean; updated_at: string | null; updated_by: string | null };

const HERMES_ERRORS: Record<string, string> = {
  hermes_not_configured: '先にHermesのAPIエンドポイントを保存してください。',
  hermes_timeout: 'Hermesが10秒以内に応答しませんでした。',
  hermes_unreachable: 'Hermesに接続できませんでした。URLとネットワークを確認してください。',
  hermes_rejected: 'Hermesが依頼を拒否しました。',
};

function HermesSettingsCard({ settings, onSaved }: { settings: HermesSettings; onSaved: (next: HermesSettings) => void }) {
  const [endpoint, setEndpoint] = useState(settings.endpoint_url ?? '');
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  async function save(extra: Record<string, unknown> = {}) {
    setBusy(true);
    setMessage(null);
    const response = await csrfFetch('/api/admin/customer-info/hermes', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ endpoint_url: endpoint, token: token || undefined, ...extra }),
    }).catch(() => null);
    setBusy(false);
    const data = await response?.json().catch(() => null) as (HermesSettings & { error?: string }) | null;
    if (!response?.ok || !data) {
      setMessage({ ok: false, text: data?.error ?? '保存できませんでした。' });
      return;
    }
    setToken('');
    setEndpoint(data.endpoint_url ?? '');
    onSaved(data);
    setMessage({ ok: true, text: '保存しました' });
  }

  return (
    <form
      className="ci-hermes"
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
    >
      <h2>Hermes 連携</h2>
      <label>
        Hermes APIエンドポイント
        <input
          type="url"
          inputMode="url"
          value={endpoint}
          onChange={(event) => setEndpoint(event.target.value)}
          placeholder="http://100.64.0.5:8787/customer-info/drafts"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          maxLength={500}
        />
      </label>
      <label>
        APIトークン（任意）
        <input
          type="password"
          value={token}
          onChange={(event) => setToken(event.target.value)}
          placeholder={settings.token_set ? '設定済み（変更する場合のみ入力）' : '未設定'}
          autoComplete="off"
          maxLength={512}
        />
      </label>
      <p className="muted">
        「下書きを依頼」を押すと、このURLに商品情報をPOSTします。Hermesは下書きを
        <code>/api/admin/customer-info/ingest</code> に送り返します。
        {settings.updated_at && ` 最終更新: ${new Date(settings.updated_at).toLocaleString('ja-JP')}${settings.updated_by ? `（${settings.updated_by}）` : ''}`}
      </p>
      <div className="ci-actions">
        <button type="submit" disabled={busy}>保存</button>
        {settings.token_set && <button type="button" className="secondary" disabled={busy} onClick={() => void save({ clear_token: true })}>トークンを削除</button>}
      </div>
      {message && <p className={message.ok ? 'muted' : 'ci-error'} role={message.ok ? 'status' : 'alert'}>{message.text}</p>}
    </form>
  );
}

function DraftRequestButton({ productId, disabled }: { productId: number; disabled: boolean }) {
  const [state, setState] = useState<{ busy: boolean; text: string | null; ok: boolean }>({ busy: false, text: null, ok: true });

  async function request() {
    setState({ busy: true, text: null, ok: true });
    const response = await csrfFetch(`/api/admin/customer-info/products/${productId}/draft-request`, { method: 'POST' }).catch(() => null);
    const data = await response?.json().catch(() => null) as { error?: string; job_id?: string | null; source_count?: number; hermes_status?: number | null } | null;
    if (!response?.ok) {
      const base = HERMES_ERRORS[data?.error ?? ''] ?? '依頼できませんでした。';
      setState({ busy: false, ok: false, text: data?.hermes_status ? `${base}（HTTP ${data.hermes_status}）` : base });
      return;
    }
    const sources = data?.source_count === 0 ? ' 公式出典がまだありません。' : '';
    setState({ busy: false, ok: true, text: `依頼しました${data?.job_id ? `（ID: ${data.job_id}）` : ''}。下書きが届くとこの一覧に表示されます。${sources}` });
  }

  return (
    <span className="ci-draft-request">
      <button type="button" className="secondary" disabled={disabled || state.busy} onClick={() => void request()}>
        {state.busy ? '依頼中…' : 'Hermesに下書きを依頼'}
      </button>
      {state.text && <span className={state.ok ? 'muted' : 'ci-error'} role={state.ok ? 'status' : 'alert'}>{state.text}</span>}
    </span>
  );
}

function ProductDraftSearch({ hermesReady }: { hermesReady: boolean }) {
  const [term, setTerm] = useState('');
  const [results, setResults] = useState<Array<{ id: number; product_name: string; is_active: boolean }>>([]);
  const [searched, setSearched] = useState(false);

  async function search() {
    const query = term.trim();
    if (!query) return;
    const response = await fetch(`/api/admin/products?q=${encodeURIComponent(query)}`, { cache: 'no-store' }).catch(() => null);
    const data = response?.ok ? await response.json() as Array<{ id: number; product_name: string; is_active: boolean }> : [];
    setResults(data.filter((product) => product.is_active).slice(0, 20));
    setSearched(true);
  }

  return (
    <div className="ci-draft-search">
      <h2>新しい商品の下書きを依頼</h2>
      <form
        className="ci-classification"
        onSubmit={(event) => {
          event.preventDefault();
          void search();
        }}
      >
        <label>
          商品名
          <input value={term} onChange={(event) => setTerm(event.target.value)} placeholder="葛根湯" maxLength={120} />
        </label>
        <button type="submit" className="secondary">検索</button>
      </form>
      {!hermesReady && <p className="muted">HermesのAPIエンドポイントを保存すると依頼できます。</p>}
      {searched && results.length === 0 && <p className="muted">該当する商品はありません。</p>}
      <ul className="ci-draft-results">
        {results.map((product) => (
          <li key={product.id}>
            <span>{product.product_name}</span>
            <DraftRequestButton productId={product.id} disabled={!hermesReady} />
          </li>
        ))}
      </ul>
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

export function AdminCustomerInfoClient({ initialQueue, initialHermes }: { initialQueue: QueueProduct[]; initialHermes: HermesSettings }) {
  const [queue, setQueue] = useState(initialQueue);
  const [hermes, setHermes] = useState(initialHermes);
  const hermesReady = Boolean(hermes.endpoint_url);
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
      <HermesSettingsCard settings={hermes} onSaved={setHermes} />
      <ProductDraftSearch hermesReady={hermesReady} />
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
            <DraftRequestButton productId={product.product_id} disabled={!hermesReady} />
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
