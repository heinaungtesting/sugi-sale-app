import { CONTENT_LANGUAGES, FIELD_KEYS, REQUIRED_FIELDS, type ProductType, type RiskClass, type RowStatus } from './customer-info';

// Settings for the Hermes agent that drafts customer info. The app calls the
// endpoint to ask for drafts; Hermes answers later through the ingest route.

export const HERMES_SETTINGS_KEY = 'hermes.customer_info';
export const MIN_HERMES_TOKEN_LENGTH = 16;

export type HermesSettingsInput = {
  endpoint_url: string | null;
  /** undefined = keep the stored token, null = clear it, string = replace it. */
  token: string | null | undefined;
};

export type HermesSettingsValidation = { ok: true; value: HermesSettingsInput } | { ok: false; error: string };

export function normalizeHermesEndpoint(raw: unknown): { ok: true; value: string | null } | { ok: false; error: string } {
  if (raw === null || raw === undefined || (typeof raw === 'string' && !raw.trim())) return { ok: true, value: null };
  if (typeof raw !== 'string' || raw.length > 500) return { ok: false, error: 'invalid endpoint_url' };
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return { ok: false, error: 'endpoint_url must be a full URL, e.g. http://100.64.0.5:8787/drafts' };
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return { ok: false, error: 'endpoint_url must use http or https' };
  if (url.username || url.password) return { ok: false, error: 'put the token in the token field, not in the URL' };
  if (url.hash) url.hash = '';
  return { ok: true, value: url.toString() };
}

export function validateHermesSettings(input: unknown): HermesSettingsValidation {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return { ok: false, error: 'invalid request' };
  const body = input as Record<string, unknown>;
  const endpoint = normalizeHermesEndpoint(body.endpoint_url);
  if (!endpoint.ok) return endpoint;

  let token: string | null | undefined;
  if (body.clear_token === true) token = null;
  else if (typeof body.token === 'string' && body.token.trim()) {
    token = body.token.trim();
    if (token.length < MIN_HERMES_TOKEN_LENGTH || token.length > 512 || /\s/.test(token)) {
      return { ok: false, error: `token must be ${MIN_HERMES_TOKEN_LENGTH}-512 characters with no spaces` };
    }
  } else if (body.token !== undefined && body.token !== null && body.token !== '') {
    return { ok: false, error: 'invalid token' };
  }
  return { ok: true, value: { endpoint_url: endpoint.value, token } };
}

export type DraftRequestProduct = {
  product_id: number;
  product_name: string;
  category: string | null;
  product_type: ProductType;
  risk_class: RiskClass | null;
  existing: Array<{ language: string; field_key: string; status: RowStatus; ja_source_hash: string | null }>;
  sources: Array<{ id: number; url: string; source_type: string }>;
};

/** The body the app POSTs to Hermes. Hermes replies by calling `callback.url`. */
export function buildDraftRequest(product: DraftRequestProduct, callbackUrl: string, requestedBy: string) {
  return {
    kind: 'customer_info_draft_request',
    product_id: product.product_id,
    product_name: product.product_name,
    category: product.category,
    product_type: product.product_type,
    risk_class: product.risk_class,
    languages: CONTENT_LANGUAGES,
    required_fields: REQUIRED_FIELDS,
    allowed_fields: FIELD_KEYS,
    existing_rows: product.existing,
    official_sources: product.sources,
    callback: { method: 'POST', url: callbackUrl, auth: 'Bearer CUSTOMER_INFO_INGEST_TOKEN' },
    requested_by: requestedBy,
    requested_at: new Date().toISOString(),
  };
}
