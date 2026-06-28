import { clearSession } from '@/lib/auth';
import { requireCsrf } from '@/lib/csrf';

export async function POST(req: Request) {
  const csrf = requireCsrf(req);
  if (csrf) return csrf;
  await clearSession();
  return Response.json({ ok: true });
}
