import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = (path: string) => readFileSync(join(process.cwd(), path), 'utf8');

describe('one-time bottom navigation announcement', () => {
  it('stores the announcement state independently for each authenticated user', () => {
    const migration = source('scripts/migrate.ts');
    const notice = source('lib/sugi-navigation-notice.ts');
    const route = source('app/api/navigation/prompt/route.ts');

    expect(migration).toContain('navigation_v9_prompt_seen_at');
    expect(notice).toContain('navigation_v9_prompt_seen_at IS NULL');
    expect(notice).toContain('COALESCE(navigation_v9_prompt_seen_at, now())');
    expect(route).toContain('requireCsrf(req)');
    expect(route).toContain('markNavigationPromptSeen(user.id)');
  });

  it('shows the Japanese navigation guide before the older feedback guide', () => {
    const home = source('app/page.tsx');
    const client = source('components/HomeShiftLoggerClient.tsx');
    const popup = source('components/NavigationChangePopup.tsx');

    expect(home).toContain('shouldShowNavigationPrompt(user.id)');
    expect(home).toContain('showNavigationPrompt={showNavigationPrompt}');
    expect(home).toContain('showFeedbackPrompt={!showNavigationPrompt && showFeedbackPrompt}');
    expect(client).toContain('<NavigationChangePopup initialOpen={showNavigationPrompt} />');
    expect(popup).toContain('メニューを画面下に移動しました');
    expect(popup).toContain('ホーム・履歴・全記録・ご意見');
    expect(popup).toContain("csrfFetch('/api/navigation/prompt'");
    expect(popup).toContain('この案内は一度だけ表示されます');
  });
});
