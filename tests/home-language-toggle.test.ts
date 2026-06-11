import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = (path: string) => readFileSync(join(process.cwd(), path), 'utf8');

describe('home language toggle contract', () => {
  it('keeps home language state in a client wrapper shared by header, logger, and recent card', () => {
    const page = source('app/page.tsx');
    const client = source('components/HomeShiftLoggerClient.tsx');
    expect(page).toContain('HomeShiftLoggerClient');
    expect(client).toContain("type Language = 'en' | 'ja'");
    expect(client).toContain("useState<Language>('en')");
    expect(client).toContain('setLanguage');
    expect(client).toContain('Recent today');
    expect(client).toContain('今日の記録');
  });

  it('renders a Japanese/English toggle beside logout in the header', () => {
    const header = source('components/AppHeader.tsx');
    expect(header).toContain('language-toggle');
    expect(header).toContain('aria-label="Language"');
    expect(header).toContain("activeLanguage === 'en'");
    expect(header).toContain('日本語');
    expect(header).toContain('English');
  });

  it('has Japanese copy for the core fast logging flow', () => {
    const logger = source('components/SearchProductLogger.tsx');
    const client = source('components/HomeShiftLoggerClient.tsx');
    expect(logger).toContain('すぐ記録');
    expect(logger).toContain('商品名またはショートカットで検索');
    expect(logger).toContain('商品が見つかりません');
    expect(logger).toContain('スペルを確認するか、Adminから追加してください。');
    expect(client).toContain('今日の記録はまだありません');
    expect(client).toContain('すぐ記録または検索から始めてください。');
  });
});
