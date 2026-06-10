import { currentUser, requireUserResponse } from '@/lib/auth';
import { salesByDate, todaySaleDate, validSaleDate } from '@/lib/sugi-db';

export async function GET(req: Request) {
  const user = await currentUser();
  if (!user) return requireUserResponse();
  const date = new URL(req.url).searchParams.get('date') ?? todaySaleDate();
  if (!validSaleDate(date)) return Response.json({ error: 'invalid date' }, { status: 400 });
  return Response.json(await salesByDate(user.id, date));
}
