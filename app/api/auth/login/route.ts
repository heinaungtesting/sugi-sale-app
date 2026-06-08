import { loginUser, setSession, sessionTokenForUser } from '@/lib/auth';

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const username = String(body.username ?? '');
  const pin = String(body.pin ?? '');
  const user = await loginUser(username, pin);
  if (!user) return Response.json({ error: 'invalid credentials' }, { status: 401 });
  await setSession(user);
  return Response.json({ ok: true, user, token: sessionTokenForUser(user) });
}
