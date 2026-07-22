import { currentSessionClaims, currentUser, requireUserResponse } from '@/lib/auth';
import { requireCsrf } from '@/lib/csrf';
import { listUserSessions, revokeOwnedSession, revokeUserSessions } from '@/repositories/session-repository';
import { logEvent, requestId } from '@/infrastructure/logging/structured-logger';

export async function GET() {
  const [user, claims] = await Promise.all([currentUser(), currentSessionClaims()]);
  if (!user || !claims) return requireUserResponse();
  return Response.json(await listUserSessions(user.id, claims.jti));
}

export async function DELETE(req: Request) {
  const csrf = requireCsrf(req);
  if (csrf) return csrf;
  const [user, claims] = await Promise.all([currentUser(), currentSessionClaims()]);
  if (!user || !claims) return requireUserResponse();
  const body = await req.json().catch(() => ({}));
  if (body.action === 'revoke_others') {
    const revoked = await revokeUserSessions(user.id, claims.jti);
    logEvent('sessions_revoked_others', { requestId: requestId(req), userId: user.id, revoked });
    return Response.json({ ok: true, revoked });
  }
  const jti = String(body.jti ?? '');
  if (!jti || jti === claims.jti) return Response.json({ error: 'cannot revoke current session here' }, { status: 400 });
  const revoked = await revokeOwnedSession(user.id, jti);
  if (!revoked) return Response.json({ error: 'session not found' }, { status: 404 });
  logEvent('session_revoked', { requestId: requestId(req), userId: user.id });
  return Response.json({ ok: true });
}
