import { currentUser, requireUserResponse } from '@/lib/auth';
import { salesByMonth, todaySaleDate } from '@/lib/sugi-db';

export async function GET(req: Request) {
  const user = await currentUser();
  if (!user) return requireUserResponse();
  const month = new URL(req.url).searchParams.get('month') ?? todaySaleDate().slice(0, 7);
  if (!/^\d{4}-\d{2}$/.test(month)) return Response.json({ error: 'invalid month' }, { status: 400 });
  return Response.json(await salesByMonth(user.id, month));
}
