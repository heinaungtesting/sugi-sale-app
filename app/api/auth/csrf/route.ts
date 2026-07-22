import { setCsrfCookie } from '@/lib/csrf';

export async function GET() {
  const token = await setCsrfCookie();
  return Response.json({ ok: true, token });
}
