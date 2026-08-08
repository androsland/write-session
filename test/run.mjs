#!/usr/bin/env node
// Runs every suite. No test framework, no dependencies — `node test/run.mjs`.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const here = path.dirname(fileURLToPath(import.meta.url));
const suites = ['core.test.mjs', 'hardening.test.mjs'];
let failed = 0;

for (const s of suites) {
  console.log(`\n${'='.repeat(60)}\n${s}\n${'='.repeat(60)}`);
  const r = spawnSync(process.execPath, [path.join(here, s)], { stdio: 'inherit' });
  if (r.status !== 0) failed++;
}

console.log(failed ? `\n${failed} suite(s) failed` : '\nall suites passed');
process.exit(failed ? 1 : 0);
