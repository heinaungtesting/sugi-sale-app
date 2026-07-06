import { currentUser, requireUserResponse } from '@/lib/auth';
import { undoLatestSale } from '@/lib/sugi-db';

export async function DELETE(req: Request) {
  const user = await currentUser();
  if (!user) return requireUserResponse();
  const deleted = await undoLatestSale(user.id);
  if (!deleted) return Response.json({ error: 'nothing to undo' }, { status: 404 });
  return Response.json(deleted);
}
