import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = (path: string) => readFileSync(join(process.cwd(), path), 'utf8');

describe('Japanese feedback feature', () => {
  it('provides a Japanese feedback page with a writing guide and history', () => {
    const page = source('app/feedback/page.tsx');
    const form = source('components/FeedbackForm.tsx');
    expect(page).toContain('ご意見・ご要望');
    expect(form).toContain('書き方ガイド');
    expect(form).toContain('困っている画面、起きたこと、希望する改善');
    expect(form).toContain('送信したご意見');
    expect(form).toContain('個人情報は入力しないでください');
  });

  it('shows a persistent per-user one-time popup after login', () => {
    const home = source('app/page.tsx');
    const popup = source('components/FeedbackWelcomePopup.tsx');
    const db = source('lib/sugi-feedback.ts');
    expect(home).toContain('shouldShowFeedbackPrompt(user.id)');
    expect(popup).toContain('この案内は一度だけ表示されます');
    expect(popup).toContain("csrfFetch('/api/feedback/prompt'");
    expect(db).toContain('feedback_prompt_seen_at IS NULL');
    expect(db).toContain('COALESCE(feedback_prompt_seen_at, now())');
  });

  it('validates, rate-limits, and CSRF-protects feedback submissions', () => {
    const route = source('app/api/feedback/route.ts');
    expect(route).toContain('requireCsrf(req)');
    expect(route).toContain('MIN_MESSAGE_LENGTH = 10');
    expect(route).toContain('MAX_MESSAGE_LENGTH = 1000');
    expect(route).toContain('MAX_FEEDBACK_PER_DAY = 5');
    expect(route).toContain('feedbackCountSince');
  });

  it('stores feedback and lets admins review and update its status', () => {
    const migration = source('scripts/migrate.ts');
    const adminRoute = source('app/api/admin/feedback/route.ts');
    const adminPage = source('app/admin/feedback/page.tsx');
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS sugi_feedback');
    expect(migration).toContain("CHECK (status IN ('未確認', '確認済み', '対応中', '完了'))");
    expect(adminRoute).toContain('requireAdmin(user)');
    expect(adminRoute).toContain('updateFeedbackStatus');
    expect(adminPage).toContain('AdminFeedbackClient');
  });

  it('adds feedback to the shared application navigation', () => {
    const header = source('components/AppHeader.tsx');
    expect(header).toContain("feedback: 'ご意見'");
    expect(header).toContain('href="/feedback"');
    expect(header).toContain("activePage === 'feedback'");
  });
});
