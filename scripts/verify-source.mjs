#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const baselines = [
  // These SHA values cover Git's normalized blob bytes. SOURCE-MANIFEST.md
  // retains the original Windows checkout hashes as separate provenance.
  ['5f352a08b8e238a01f279e49c576d217117b8eea', '1f0e30c1046f3f7b4ca6cfc9091a8ba5d6256eddbb18f5e74d2a963b18529d0c'],
  ['9bfa92bc5c862fd54e809af25eca050a394e6595', 'd13fa6e59f990f19b7d6d86424d63395d85ae8cb5e6588c30635199b3dccb9e8'],
  ['8bd0fe05acf47039bf39dc1f34c9c802875414a4', '70d74345a6db0d7fcd3c21154b47adab7b776180c7a9807ff23eb4c402219261'],
];

for (const [objectId, expectedSha] of baselines) {
  const bytes = execFileSync('git', ['cat-file', 'blob', objectId], { cwd: root, encoding: null });
  const actual = createHash('sha256').update(bytes).digest('hex');
  if (actual !== expectedSha) throw new Error(`historical source blob changed or is unavailable: ${objectId}`);
}

const metadata = JSON.parse(readFileSync(resolve(root, 'dist/package.json'), 'utf8'));
if (metadata.dependencies?.UltimateLib || metadata.dependencies?.['gdt-modAPI'] !== '0.1.2') {
  throw new Error('mod metadata must remove UltimateLib and pin gdt-modAPI 0.1.2');
}

const main = readFileSync(resolve(root, 'dist/main.js'), 'utf8');
const contract = readFileSync(resolve(root, 'dist/contract.js'), 'utf8');
new Function(main);
new Function(contract);
for (const file of ['dist/bridge.js', 'qa/smoke-storage.js', 'qa/smoke-bootstrap.js']) {
  new Function(readFileSync(resolve(root, file), 'utf8'));
}
for (const forbidden of ['Math.random(', 'Date.now(', 'researchCompleted.push(', 'UltimateLib']) {
  if (main.includes(forbidden)) throw new Error(`active mod source contains forbidden legacy behavior: ${forbidden}`);
}
for (const required of [
  'Contract.bindFreshState',
  'Contract.recordApplied',
  'Contract.collectMilestones',
  '/api/archipelago/gdt/client/items/ack',
  '/api/archipelago/gdt/client/progress',
  'clientStatus',
]) {
  if (!main.includes(required)) throw new Error(`active mod source is missing required contract behavior: ${required}`);
}

console.log('Verified historical DMS blobs, private integration client and smoke isolation sources.');
