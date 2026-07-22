import { currentUser, requireUserResponse } from '@/lib/auth';
import { undoLatestSale } from '@/lib/sugi-db';
import { requireCsrf } from '@/lib/csrf';

export async function DELETE(req: Request) {
  const csrf = requireCsrf(req);
  if (csrf) return csrf;
  const user = await currentUser();
  if (!user) return requireUserResponse();
  const deleted = await undoLatestSale(user.id);
  if (!deleted) return Response.json({ error: 'nothing to undo' }, { status: 404 });
  return Response.json(deleted);
}
