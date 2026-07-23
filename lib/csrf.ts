const DEFAULT_ALLOWED_HOSTS = new Set([
  'herme-agents.tail71ac56.ts.net',
  '100.111.161.73',
  'localhost',
  '127.0.0.1',
]);

function normalizedHostname(value: string): string | null {
  try {
    const withScheme = value.includes('://') ? value : `http://${value}`;
    return new URL(withScheme).hostname.toLowerCase().replace(/\.$/, '');
  } catch {
    return null;
  }
}

function allowedHostnames(): Set<string> {
  const configured = (process.env.SUGI_ALLOWED_HOSTS ?? '')
    .split(',')
    .map((value) => normalizedHostname(value.trim()))
    .filter((value): value is string => Boolean(value));
  return new Set([...DEFAULT_ALLOWED_HOSTS, ...configured]);
}

function allowedRequestHost(req: Request): boolean {
  const allowed = allowedHostnames();
  const requestUrl = new URL(req.url);
  const forwardedHost = req.headers.get('x-forwarded-host')?.split(',')[0]?.trim();
  const effectiveHost = forwardedHost || req.headers.get('host')?.trim() || requestUrl.host;
  const requestHostname = normalizedHostname(effectiveHost);
  if (!requestHostname || !allowed.has(requestHostname)) return false;

  const browserSource = req.headers.get('origin') || req.headers.get('referer');
  if (!browserSource) return true;
  const sourceHostname = normalizedHostname(browserSource);
  return Boolean(sourceHostname && allowed.has(sourceHostname));
}

/** Tokenless compatibility guard: only allow requests involving configured app hosts. */
export function verifyCsrfRequest(req: Request): boolean {
  return allowedRequestHost(req);
}

export function requireCsrf(req: Request): Response | null {
  return allowedRequestHost(req)
    ? null
    : Response.json({ error: 'cross-origin request blocked' }, { status: 403 });
}
