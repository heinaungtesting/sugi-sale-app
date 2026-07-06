'use client';

import { useMemo, useState, type FormEvent } from 'react';

import { csrfFetch } from '@/lib/csrf-client';
type AdminVariant = { id: number; product_id: number; variant_label: string; display_shortcut: string | null; unit_count: number; point_value: number; nicknames: string[]; is_active: boolean };
type AdminProduct = { id: number; product_name: string; category: string | null; point_value: number; nicknames: string[]; is_active: boolean; variants: AdminVariant[] };
type AdminUser = { id: number; username: string; display_name: string; role: string; is_active: boolean };
type AdminActivity = { id: string; created_at: string; user_id: number | null; username: string | null; display_name: string | null; action: string; summary: string; details: Record<string, unknown> };

const JSON_EXAMPLE = `[
  {
    "product_name": "商品名",
    "category": "カテゴリ",
    "point_value": 0,
    "nicknames": ["alias1", "alias2"],
    "variants": [
      { "variant_label": "7枚", "display_shortcut": "7枚", "unit_count": 7, "point_value": 50, "nicknames": ["alias7"] }
    ]
  }
]`;

type AdminFormAction = (form: FormData) => Promise<void>;

function submitAdminForm(event: FormEvent<HTMLFormElement>, action: AdminFormAction) {
 event.preventDefault();
 const form = event.currentTarget;
 void action(new FormData(form)).catch((error) => {
 console.error('Admin mutation failed', error);
 });
}

export function AdminClient({ initialUsers, initialProducts, initialActivity }: { initialUsers: AdminUser[]; initialProducts: AdminProduct[]; initialActivity: AdminActivity[] }) {
 const [users, setUsers] = useState(initialUsers);
 const [products, setProducts] = useState(initialProducts);
 const [activity, setActivity] = useState(initialActivity);
 const [activityUserFilter, setActivityUserFilter] = useState('all');
  const [selectedProductId, setSelectedProductId] = useState<number | null>(initialProducts[0]?.id ?? null);
  const [productQuery, setProductQuery] = useState('');
  const [bulkInput, setBulkInput] = useState('');
  const [bulkResult, setBulkResult] = useState<any[] | null>(null);
  const [jsonInput, setJsonInput] = useState(JSON_EXAMPLE);
  const [jsonResult, setJsonResult] = useState<any[] | null>(null);
  const [stagedCampaign, setStagedCampaign] = useState<{ campaign_month?: string; results?: any[] } | null>(null);
  const [jsonError, setJsonError] = useState('');

  const selectedProduct = useMemo(
    () => products.find((product) => product.id === selectedProductId) ?? products[0] ?? null,
    [products, selectedProductId]
  );

  async function reload(query = productQuery) {
    setUsers(await (await fetch('/api/admin/users')).json());
    const url = query.trim() ? `/api/admin/products?q=${encodeURIComponent(query.trim())}` : '/api/admin/products';
    const nextProducts = await (await fetch(url)).json();
    setProducts(nextProducts);
    if (!nextProducts.some((product: AdminProduct) => product.id === selectedProductId)) {
      setSelectedProductId(nextProducts[0]?.id ?? null);
    }
  }

  async function searchProducts() {
  await reload(productQuery);
  }

  async function reloadActivity(nextUserId = activityUserFilter) {
  const params = new URLSearchParams({ limit: '80' });
  if (nextUserId !== 'all') params.set('user_id', nextUserId);
  const res = await fetch(`/api/admin/activity?${params.toString()}`);
  setActivity(await res.json());
  }

  async function saveUser(form: FormData) {
    const obj = Object.fromEntries(form);
    await csrfFetch('/api/admin/users', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...obj, is_active: obj.is_active === 'on' }) });
    await reload();
  }

  async function saveProduct(form: FormData) {
    const obj = Object.fromEntries(form);
    await csrfFetch('/api/admin/products', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...obj, is_active: obj.is_active === 'on' }) });
    await reload();
  }

  async function saveVariant(form: FormData) {
  const obj = Object.fromEntries(form);
  await csrfFetch('/api/admin/variants', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...obj, is_active: obj.is_active === 'on' }) });
  await reload();
  }

  async function deleteProduct(id: number) {
  await csrfFetch(`/api/admin/products?id=${encodeURIComponent(String(id))}`, { method: 'DELETE' });
  await reload();
  }

  async function deleteUser(user: AdminUser) {
  const ok = window.confirm(`Delete user ${user.display_name} (${user.username})? This cannot be undone for unused accounts.`);
  if (!ok) return;
  await csrfFetch(`/api/admin/users?id=${encodeURIComponent(String(user.id))}`, { method: 'DELETE' });
  await reload();
  }

  async function applyBulk() {
    const raw = bulkInput.trim();
    if (!raw) return;
    const parts = raw.split(/[\n,]+/).map((p) => p.trim()).filter(Boolean);
    const updates: Array<{ query: string; point_value: number }> = [];
    for (const part of parts) {
      const m = part.match(/^(.+?)\s*[=:\s]\s*(\d+)\s*$/);
      if (m) {
        updates.push({ query: m[1].trim(), point_value: parseInt(m[2], 10) });
        continue;
      }
      const words = part.split(/\s+/);
      const pts = parseInt(words[words.length - 1], 10);
      if (!Number.isNaN(pts) && pts >= 0) {
        const q = words.slice(0, -1).join(' ').trim();
        if (q) updates.push({ query: q, point_value: pts });
      }
    }
    if (updates.length === 0) return;
    const res = await csrfFetch('/api/admin/points', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ updates }) });
    const data = await res.json();
    setBulkResult(data.results || []);
    setBulkInput('');
    await reload();
  }

  async function importJson() {
  setJsonError('');
  setJsonResult(null);
  let parsed: unknown;
  try {
  parsed = JSON.parse(jsonInput);
  } catch (error) {
  setJsonError(error instanceof Error ? error.message : 'Invalid JSON');
  return;
  }
  const res = await csrfFetch('/api/admin/import', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(parsed) });
  const data = await res.json();
  setJsonResult(data.results || []);
  if (!res.ok && data.error) setJsonError(data.error);
  await reload();
  }

  async function stageNextMonthJson() {
  setJsonError('');
  setStagedCampaign(null);
  let parsed: unknown;
  try {
  parsed = JSON.parse(jsonInput);
  } catch (error) {
  setJsonError(error instanceof Error ? error.message : 'Invalid JSON');
  return;
  }
  const res = await csrfFetch('/api/admin/point-campaigns/next-month', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(parsed) });
  const data = await res.json();
  setStagedCampaign({ campaign_month: data.campaign_month, results: data.results || [] });
  if (!res.ok && data.error) setJsonError(data.error);
  await reload();
  }

  return (
    <section className="admin-page">
      <div className="admin-desktop-workspace">
        <aside className="admin-sidebar page-card">
          <div>
            <span className="admin-kicker">Products</span>
            <h2>Search & edit</h2>
          </div>
          <div className="admin-search-row">
            <input
              value={productQuery}
              onChange={(event) => setProductQuery(event.target.value)}
              onKeyDown={(event) => event.key === 'Enter' && searchProducts()}
              placeholder="Search product / alias"
              aria-label="Search product to edit"
            />
            <button type="button" onClick={searchProducts}>Search</button>
          </div>
          <div className="admin-product-list" aria-label="Product search results">
            {products.map((product) => (
              <button
                type="button"
                key={product.id}
                className={product.id === selectedProduct?.id ? 'selected' : ''}
                onClick={() => setSelectedProductId(product.id)}
              >
                <strong>{product.product_name}</strong>
                <span>{product.category || 'その他'} · {product.variants.length} variants · {product.is_active ? 'active' : 'inactive'}</span>
              </button>
            ))}
          </div>
        </aside>

        <main className="admin-editor-column">
          <section className="admin-card admin-panel-card">
            <div className="admin-section-header">
              <div>
                <span className="admin-kicker">Selected product</span>
                <h2>{selectedProduct ? selectedProduct.product_name : 'No product selected'}</h2>
              </div>
            </div>
            {selectedProduct && (
              <>
                <form key={`product-editor-${selectedProduct.id}-${selectedProduct.product_name}`} onSubmit={(event) => submitAdminForm(event, saveProduct)} className="admin-product-form admin-wide-grid">
                  <input type="hidden" name="id" value={selectedProduct.id} />
                  <label>Product name<input name="product_name" defaultValue={selectedProduct.product_name} /></label>
                  <label>Category<input name="category" defaultValue={selectedProduct.category ?? ''} /></label>
                  <label>Fallback points<input name="point_value" type="number" defaultValue={selectedProduct.point_value} /></label>
                  <label className="span-2">Aliases<input name="nicknames" defaultValue={(selectedProduct.nicknames ?? []).join(', ')} /></label>
                  <label className="admin-checkbox"><input type="checkbox" name="is_active" defaultChecked={selectedProduct.is_active} /> active</label>
                  <button className="primary">Save product</button>
                  <button type="button" className="danger-button" onClick={() => deleteProduct(selectedProduct.id)}>Delete product</button>
                  </form>

                <div className="admin-variant-table" role="table" aria-label="Product variants">
                  <div className="admin-variant-head" role="row">
                    <span>Label</span><span>Shortcut</span><span>Unit</span><span>Points</span><span>Aliases</span><span>Active</span><span></span>
                  </div>
                  {selectedProduct.variants.map((variant) => (
                    <form key={`variant-editor-${variant.id}-${variant.variant_label}`} onSubmit={(event) => submitAdminForm(event, saveVariant)} className="admin-variant-row" role="row">
                      <input type="hidden" name="id" value={variant.id} />
                      <input type="hidden" name="product_id" value={selectedProduct.id} />
                      <input name="variant_label" defaultValue={variant.variant_label} />
                      <input name="display_shortcut" defaultValue={variant.display_shortcut ?? ''} />
                      <input name="unit_count" type="number" defaultValue={variant.unit_count} />
                      <input name="point_value" type="number" defaultValue={variant.point_value} />
                      <input name="nicknames" defaultValue={(variant.nicknames ?? []).join(', ')} />
                      <label><input type="checkbox" name="is_active" defaultChecked={variant.is_active} /> active</label>
                      <button>Save</button>
                    </form>
                  ))}
                  <form onSubmit={(event) => submitAdminForm(event, saveVariant)} className="admin-variant-row new-variant-row">
                    <input type="hidden" name="product_id" value={selectedProduct.id} />
                    <input name="variant_label" placeholder="温7枚" />
                    <input name="display_shortcut" placeholder="温7枚" />
                    <input name="unit_count" type="number" defaultValue="1" />
                    <input name="point_value" type="number" placeholder="points" />
                    <input name="nicknames" placeholder="aliases" />
                    <label><input type="checkbox" name="is_active" defaultChecked /> active</label>
                    <button>+ Variant</button>
                  </form>
                </div>
              </>
            )}
          </section>

          <section className="admin-tools-grid">
            <div className="admin-card admin-panel-card">
              <span className="admin-kicker">Create</span>
              <h2>Add product</h2>
              <form onSubmit={(event) => submitAdminForm(event, saveProduct)} className="admin-wide-grid">
                <label>Product name<input name="product_name" placeholder="Product family / base product" required /></label>
                <label>Category<input name="category" placeholder="category" /></label>
                <label>Fallback points<input name="point_value" type="number" defaultValue="0" /></label>
                <label>Aliases<input name="nicknames" placeholder="aliases comma-separated" /></label>
                <label className="admin-checkbox"><input type="checkbox" name="is_active" defaultChecked /> active</label>
                <button className="primary">Add product</button>
              </form>
            </div>

            <div className="admin-card admin-panel-card admin-import-tool">
              <span className="admin-kicker">JSON import</span>
              <h2>Import products</h2>
              <textarea className="admin-json-input" value={jsonInput} onChange={(event) => setJsonInput(event.target.value)} spellCheck={false} />
              {jsonError && <p className="error">{jsonError}</p>}
              <button type="button" onClick={importJson} className="primary">Import JSON</button>
              <p className="admin-help">Next-month staging: current points expire at Tokyo month change; the staged JSON becomes active automatically on the first app use next month.</p>
              <button type="button" onClick={stageNextMonthJson} className="primary">Stage for next month</button>
              {stagedCampaign && (
              <div className="admin-result-box">
              <div>✅ {stagedCampaign.campaign_month} campaign staged. Current points expire after this month.</div>
              {(stagedCampaign.results ?? []).map((result, index) => (
              <div key={index}>{result.kind === 'error' ? '⚠️' : '✅'} {result.product_name || result.error} {result.variants ? `(${result.variants.length} variants)` : result.point_value !== undefined ? `→ ${result.point_value}pt` : ''}</div>
              ))}
              </div>
              )}
              {jsonResult && (
                <div className="admin-result-box">
                  {jsonResult.map((result, index) => (
                    <div key={index}>{result.kind === 'error' ? '⚠️' : '✅'} {result.product_name || result.error} {result.variants ? `(${result.variants.length} variants)` : ''}</div>
                  ))}
                </div>
              )}
            </div>
          </section>

          <section className="admin-card admin-panel-card admin-bulk-tool">
            <span className="admin-kicker">Monthly campaign</span>
            <h2>Bulk point update</h2>
            <p className="admin-help">Enter one per line or comma-separated: <code>alias 120</code>, <code>kuchi 80</code>, <code>fetasgel 120</code>. Historical sales keep their logged points.</p>
            <textarea className="admin-bulk-input" value={bulkInput} onChange={(event) => setBulkInput(event.target.value)} placeholder="kuchi 80&#10;hibi 50&#10;hibi35 100&#10;pripink 200&#10;fetiasgel 120" rows={5} />
            <button type="button" onClick={applyBulk} className="primary">Apply bulk points</button>
            {bulkResult && bulkResult.length > 0 && (
              <div className="admin-result-box">
                {bulkResult.map((result, index) => (
                  <div key={index}>{result.kind === 'created' ? '🆕' : '✅'} {result.product_name}{result.variant_label ? ` (${result.variant_label})` : ''} → {result.point_value}pt</div>
                ))}
              </div>
            )}
          </section>

          <section className="admin-card admin-panel-card admin-activity-panel">
            <div className="admin-section-header">
              <div>
                <span className="admin-kicker">Activity</span>
                <h2>User activity</h2>
              </div>
              <div className="admin-activity-controls">
                <select
                  className="activity-user-filter"
                  value={activityUserFilter}
                  onChange={(event) => {
                    const value = event.target.value;
                    setActivityUserFilter(value);
                    void reloadActivity(value);
                  }}
                  aria-label="Filter activity by user"
                >
                  <option value="all">All users</option>
                  {users.map((user) => (
                    <option key={user.id} value={user.id}>{user.display_name} ({user.username})</option>
                  ))}
                </select>
                <button type="button" onClick={() => reloadActivity()}>Refresh</button>
              </div>
            </div>
            <div className="admin-activity-list" aria-label="User activity feed">
              {activity.length === 0 && <p className="admin-help">No activity yet.</p>}
              {activity.map((item) => (
                <article key={item.id} className="admin-activity-row">
                  <time dateTime={item.created_at}>{new Date(item.created_at).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' })}</time>
                  <strong>{item.display_name || item.username || 'Unknown user'}</strong>
                  <span className="admin-activity-action">{item.action}</span>
                  <span>{item.summary}</span>
                </article>
              ))}
            </div>
          </section>

          <section className="admin-card admin-panel-card">
            <span className="admin-kicker">Users</span>
            <h2>Staff accounts</h2>
            <form onSubmit={(event) => submitAdminForm(event, saveUser)} className="admin-user-create">
              <input name="username" placeholder="username" required />
              <input name="display_name" placeholder="display name" required />
              <input name="pin" placeholder="PIN" required />
              <select name="role"><option value="user">user</option><option value="admin">admin</option></select>
              <button className="primary">Create user</button>
            </form>
            <div className="admin-user-list">
              {users.map((user) => (
                <form key={user.id} onSubmit={(event) => submitAdminForm(event, saveUser)} className="admin-user-row">
                  <input type="hidden" name="id" value={user.id} />
                  <input name="username" defaultValue={user.username} />
                  <input name="display_name" defaultValue={user.display_name} />
                  <input name="pin" placeholder="new PIN blank=keep" />
                  <select name="role" defaultValue={user.role}><option value="user">user</option><option value="admin">admin</option></select>
                  <label><input type="checkbox" name="is_active" defaultChecked={user.is_active} /> active</label>
                  <button>Save</button>
                  <button type="button" className="danger-button" onClick={() => deleteUser(user)}>Delete user</button>
                  </form>
              ))}
            </div>
          </section>
        </main>
      </div>
    </section>
  );
}
