import { currentUser, requireUserResponse } from '@/lib/auth';
import { getCustomerInfoBundle } from '@/repositories/customer-info-repository';

export async function GET(req: Request) {
  const user = await currentUser();
  if (!user) return requireUserResponse();
  const since = Number(new URL(req.url).searchParams.get('since') ?? 0);
  if (!Number.isSafeInteger(since) || since < 0) return Response.json({ error: 'invalid since' }, { status: 400 });
  return Response.json(await getCustomerInfoBundle(since), { headers: { 'cache-control': 'private, no-store' } });
}
