import { currentUser, requireUserResponse } from '@/lib/auth';
import { listProductsByCategory, listSearchableProducts } from '@/lib/sugi-db';

export async function GET(req: Request) {
  const user = await currentUser();
  if (!user) return requireUserResponse();
  const url = new URL(req.url);
  const search = url.searchParams.get('q');
  if (search !== null) {
    return Response.json(await listSearchableProducts(user.id, search));
  }
  const category = url.searchParams.get('category') ?? 'その他';
  return Response.json(await listProductsByCategory(user.id, category));
}
