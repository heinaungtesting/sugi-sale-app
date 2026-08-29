import { currentUser, requireUserResponse } from '@/lib/auth';
import { requireCsrf } from '@/lib/csrf';
import { markNavigationPromptSeen } from '@/lib/sugi-navigation-notice';

export async function POST(req: Request) {
  const csrfError = requireCsrf(req);
  if (csrfError) return csrfError;
  const user = await currentUser();
  if (!user) return requireUserResponse();
  await markNavigationPromptSeen(user.id);
  return Response.json({ ok: true });
}
