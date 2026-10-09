#!/usr/bin/env node
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { checkDeps } from './check-deps.js';

const root = resolve(import.meta.dirname, '../../..');
const manifests = ['apps', 'packages', 'tooling'].flatMap((group) => {
  const dir = join(root, group);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .map((name) => join(dir, name, 'package.json'))
    .filter((p) => existsSync(p))
    .map((p) => JSON.parse(readFileSync(p, 'utf8')));
});

const errors = checkDeps(manifests);
if (errors.length) {
  for (const e of errors) console.error(`✗ ${e}`);
  process.exit(1);
}
console.log(`✓ dependency direction ok (${manifests.length} packages)`);
