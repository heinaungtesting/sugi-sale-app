#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const packageJson = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));

function git(...args) {
  try {
    return execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
  } catch {
    return '';
  }
}

const commit = process.env.SUGI_BUILD_COMMIT || git('rev-parse', 'HEAD') || 'unknown';
const builtAt = process.env.SUGI_BUILD_TIME || new Date().toISOString();
const output = resolve(root, 'public', 'build-info.json');
const buildInfo = { version: packageJson.version, commit, builtAt };

mkdirSync(dirname(output), { recursive: true });
writeFileSync(output, `${JSON.stringify(buildInfo, null, 2)}\n`, { mode: 0o644 });
console.log(`Generated build metadata: ${buildInfo.version} ${buildInfo.commit.slice(0, 12)} ${buildInfo.builtAt}`);