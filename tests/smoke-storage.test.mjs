import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import test from 'node:test';
import vm from 'node:vm';

const require = createRequire(import.meta.url);
// qa inherits the repository's ESM package marker; evaluate the ES5 CJS adapter
// as the embedded legacy runtime does, without changing its production shape.
const source = readFileSync(new URL('../qa/smoke-storage.js', import.meta.url), 'utf8');
const context = { exports: {}, require, Buffer };
vm.runInNewContext(source, context);
const install = context.exports.install;

test('two profile storage adapters never touch Steam or share game saves', () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'dms-gdt-isolation-'));
  try {
    const profiles = ['smoke-a', 'smoke-b'].map((profileId) => {
      const gameRoot = path.join(root, profileId, 'game');
      mkdirSync(path.join(gameRoot, 'qa'), { recursive: true });
      const native = { initAPI: () => true, saveTextToFile() { throw new Error('cloud called'); }, readTextFromFile() { throw new Error('cloud called'); }, activateAchievement() { throw new Error('achievement called'); } };
      const stats = install(native, { profileId, gameRoot, saveDirectory: path.join(root, profileId, 'saves') });
      assert.equal(native.initAPI(), true);
      native.saveTextToFile('general', profileId);
      native.saveTextToFile('slot_auto', profileId + '-save');
      native.activateAchievement('unused');
      assert.equal(stats.isolated, true);
      return { native, stats, profileId };
    });
    for (const { native, stats, profileId } of profiles) {
      native.readTextFromFile('general', (text) => assert.equal(text, profileId));
      native.readTextFromFile('slot_auto', (text) => assert.equal(text, profileId + '-save'));
      assert.equal(stats.achievementsSuppressed, 1);
      assert.throws(() => native.saveTextToFile('../general', 'bad'), /storage key/);
    }
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('storage adapter refuses external directory and unwritable hooks', () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'dms-gdt-hooks-'));
  try {
    const gameRoot = path.join(root, 'game');
    mkdirSync(path.join(gameRoot, 'qa'), { recursive: true });
    const native = { saveTextToFile() {}, readTextFromFile() {}, activateAchievement() {} };
    assert.throws(() => install(native, { profileId: 'smoke-a', gameRoot, saveDirectory: root }), /sibling saves/);
    assert.throws(() => install(Object.freeze(native), { profileId: 'smoke-a', gameRoot, saveDirectory: path.join(root, 'saves') }), /read only|Cannot assign/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
