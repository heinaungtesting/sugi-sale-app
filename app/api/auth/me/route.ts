import { currentUser, requireUserResponse } from '@/lib/auth';

export async function GET() {
  const user = await currentUser();
  if (!user) return requireUserResponse();
  return Response.json(user);
}
