import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = (path: string) => readFileSync(join(process.cwd(), path), 'utf8');

describe('legal terms and privacy policy source contract', () => {
  it('ships a Japanese terms/privacy page for Sugi Sale Logger', () => {
    expect(existsSync(join(process.cwd(), 'app/legal/page.tsx'))).toBe(true);
    const page = source('app/legal/page.tsx');
    expect(page).toContain('利用規約・プライバシーポリシー');
    expect(page).toContain('個人情報を取得・保存する目的で作られていません');
    expect(page).toContain('販売点数データ');
    expect(page).toContain('日常的に閲覧・検索しません');
    expect(page).toContain('記録した利用者本人が管理・確認するもの');
    expect(page).toContain('スギ薬局公式サービスではありません');
  });

  it('links the legal page from login', () => {
    expect(source('app/login/page.tsx')).toContain('/legal');
    expect(source('components/AppHeader.tsx')).not.toContain('href="/legal"');
  });
});
