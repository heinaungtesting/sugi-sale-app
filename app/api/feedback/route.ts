import { currentUser, requireUserResponse } from '@/lib/auth';
import { requireCsrf } from '@/lib/csrf';
import { logActivity } from '@/lib/sugi-activity';
import {
  createFeedback,
  feedbackCountSince,
  FEEDBACK_CATEGORIES,
  listOwnFeedback,
  type FeedbackCategory,
} from '@/lib/sugi-feedback';

const MAX_MESSAGE_LENGTH = 1000;
const MIN_MESSAGE_LENGTH = 10;
const MAX_FEEDBACK_PER_DAY = 5;

export async function GET() {
  const user = await currentUser();
  if (!user) return requireUserResponse();
  return Response.json(await listOwnFeedback(user.id));
}

export async function POST(req: Request) {
  const csrfError = requireCsrf(req);
  if (csrfError) return csrfError;
  const user = await currentUser();
  if (!user) return requireUserResponse();

  const body = await req.json().catch(() => ({}));
  const category = String(body.category ?? '') as FeedbackCategory;
  const message = String(body.message ?? '').normalize('NFKC').trim();

  if (!FEEDBACK_CATEGORIES.includes(category)) {
    return Response.json({ error: 'カテゴリーを選択してください' }, { status: 400 });
  }
  if (message.length < MIN_MESSAGE_LENGTH || message.length > MAX_MESSAGE_LENGTH) {
    return Response.json({ error: '内容は10文字以上1000文字以内で入力してください' }, { status: 400 });
  }

  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  if (await feedbackCountSince(user.id, since) >= MAX_FEEDBACK_PER_DAY) {
    return Response.json({ error: '送信回数の上限に達しました。時間をおいてお試しください' }, { status: 429 });
  }

  const feedback = await createFeedback(user.id, category, message);
  void logActivity({
    userId: user.id,
    actorUserId: user.id,
    action: 'feedback_submitted',
    summary: `フィードバック: ${category}`,
    details: { feedbackId: feedback.id },
  }).catch(() => {});
  return Response.json(feedback, { status: 201 });
}
