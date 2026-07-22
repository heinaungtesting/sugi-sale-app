import { currentUser, requireUserResponse } from '@/lib/auth';
import { requireCsrf } from '@/lib/csrf';
import { markFeedbackPromptSeen } from '@/lib/sugi-feedback';

export async function POST(req: Request) {
  const user = await currentUser();
  if (!user) return requireUserResponse();
  const csrfError = requireCsrf(req);
  if (csrfError) return csrfError;
  await markFeedbackPromptSeen(user.id);
  return Response.json({ ok: true });
}
