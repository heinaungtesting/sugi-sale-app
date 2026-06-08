import { currentUser, requireUserResponse } from '@/lib/auth';
import { listCategories } from '@/lib/sugi-db';

export async function GET() {
  const user = await currentUser();
  if (!user) return requireUserResponse();
  return Response.json(await listCategories(user.id));
}
