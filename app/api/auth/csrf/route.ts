import { setCsrfCookie } from '@/lib/csrf';

export async function GET() {
  await setCsrfCookie();
  return Response.json({ ok: true });
}
