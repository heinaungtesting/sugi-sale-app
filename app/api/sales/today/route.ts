import { currentUser, requireUserResponse } from '@/lib/auth';
import { todaySummary } from '@/lib/sugi-db';

export async function GET() {
  const user = await currentUser();
  if (!user) return requireUserResponse();
  const today = await todaySummary(user.id);
  return Response.json({ user: user.displayName, ...today });
}
