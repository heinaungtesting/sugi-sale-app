import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import packageJson from '@/package.json';

export type BuildInfo = {
  version: string;
  commit: string;
  builtAt: string;
};

let cached: BuildInfo | null = null;

function valid(value: unknown): value is BuildInfo {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<BuildInfo>;
  return typeof candidate.version === 'string'
    && typeof candidate.commit === 'string'
    && typeof candidate.builtAt === 'string';
}

export function getBuildInfo(): BuildInfo {
  if (cached) return cached;
  try {
    const parsed: unknown = JSON.parse(readFileSync(join(process.cwd(), 'public', 'build-info.json'), 'utf8'));
    if (valid(parsed)) {
      cached = parsed;
      return cached;
    }
  } catch {
    // Development and first-install fallback. Production builds generate the file in prebuild.
  }
  cached = {
    version: packageJson.version,
    commit: process.env.SUGI_BUILD_COMMIT || 'unknown',
    builtAt: process.env.SUGI_BUILD_TIME || 'unknown',
  };
  return cached;
}