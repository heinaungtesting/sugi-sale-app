const TIMEOUT_MS = 10_000;

export type HermesCallResult =
  | { ok: true; status: number; job_id: string | null }
  | { ok: false; reason: 'not_configured' | 'timeout' | 'unreachable' | 'rejected'; status?: number };

/**
 * Sends one draft request to the admin-configured Hermes endpoint. Redirects
 * are not followed and only a short job id is read back, so the endpoint
 * cannot be used to pull other pages into the app.
 */
export async function sendHermesDraftRequest(endpointUrl: string | null, token: string | null, payload: unknown): Promise<HermesCallResult> {
  if (!endpointUrl) return { ok: false, reason: 'not_configured' };
  const headers: Record<string, string> = { 'content-type': 'application/json', 'user-agent': 'sugi-sale-app/customer-info' };
  if (token) headers.authorization = `Bearer ${token}`;
  let response: Response;
  try {
    response = await fetch(endpointUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
      redirect: 'manual',
      cache: 'no-store',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (error) {
    const name = error instanceof Error ? error.name : '';
    return { ok: false, reason: name === 'TimeoutError' || name === 'AbortError' ? 'timeout' : 'unreachable' };
  }
  if (response.status < 200 || response.status >= 300) {
    await response.body?.cancel().catch(() => undefined);
    return { ok: false, reason: 'rejected', status: response.status };
  }
  let jobId: string | null = null;
  try {
    const data = await response.json() as { job_id?: unknown; id?: unknown };
    const raw = data?.job_id ?? data?.id;
    if (typeof raw === 'string' || typeof raw === 'number') jobId = String(raw).slice(0, 100);
  } catch {
    // Hermes may answer 202 with no body.
  }
  return { ok: true, status: response.status, job_id: jobId };
}
