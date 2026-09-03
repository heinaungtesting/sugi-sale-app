import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('Vercel deployment region', () => {
  it('runs server functions beside the Tokyo Supabase database', () => {
    const config = JSON.parse(readFileSync(new URL('../vercel.json', import.meta.url), 'utf8')) as {
      regions?: string[];
    };

    expect(config.regions).toEqual(['hnd1']);
  });
});
