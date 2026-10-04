import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import vm from 'node:vm';

const require = createRequire(import.meta.url);
const Contract = require('../dist/contract.js');
const hash = (text) => createHash('sha256').update(text).digest('hex');

function slotContract() {
  const topics = Array.from({ length: 66 }, (_, i) => `Topic${i}`);
  const research = Array.from({ length: 40 }, (_, i) => `Research${i}`);
  const packs = (ids) => {
    const result = Array.from({ length: 19 }, () => []);
    ids.forEach((id, i) => result[i % 19].push(id));
    return result;
  };
  const contract = {
    schema_version: 1, world: { id: 'gdt_tycoon', version: 'test' },
    game: { version: '1.7.9', steam_build: '20332874' },
    manifest: { version: 'test', sha256: '0'.repeat(64), topic_ids: topics, research_ids: research },
    binding: { seed_name: 'smoke-seed', team: 0, slot: 1 }, starting_topics: topics.slice(0, 4),
    topic_packs: packs(topics.slice(4)), research_packs: packs(research),
  };
  contract.contract_hash = hash(Contract.canonicalJson(contract));
  return contract;
}

test('fresh native save binds, applies each indexed item once and reports monotonic checks', () => {
  const contract = slotContract();
  const store = { settings: {}, data: {} };
  const hooks = new Map();
  const timers = [];
  const requests = [];
  const topics = contract.manifest.topic_ids.map((id) => ({ id }));
  const research = contract.manifest.research_ids.map((id) => ({ id, canResearch: () => true }));
  const company = { name: 'SmokeA', playerName: 'Smoke', staff: [{}], gameLog: [], fans: 0, cash: 100000,
    topics: topics.slice(0, 4), researchCompleted: [], availableResearch: research.slice(), notifications: [],
    adjustCash(value) { this.cash += value; }, adjustFans(value) { this.fans += value; } };
  const config = { bridgeBaseUrl: 'http://127.0.0.1:30001', serverId: 'test-server', clientId: 'client-a', sessionToken: 'unit-token', gameVersion: '1.7.9', steamBuild: '20332874', smokeProfile: 'smoke-a' };
  const bridge = { normalizeBaseUrl: (value) => value,
    request(_config, _method, route, payload, callback) {
      requests.push({ route, payload: JSON.parse(JSON.stringify(payload)) });
      if (/\/(sync|poll)$/.test(route)) callback(null, { ok: true, slotData: { contract }, connection: contract.binding, items: [{ index: 0, name: 'Unlock Topic' }, { index: 1, name: 'Cash 10k' }] });
      else callback(null, { ok: true });
    } };
  const context = {
    require(name) {
      if (name === './contract.js') return Contract;
      if (name === './bridge.js') return bridge;
      if (name === 'fs') return { readFileSync: () => JSON.stringify(config) };
      return require(name);
    },
    ModSupport: { availableMods: [{ id: 'DMSArchipelago', folder: 'mods/DMSArchipelago' }] },
    GDT: { getDataStore: () => store, eventKeys: { mod: { loaded: 'mod' }, saves: { newGame: 'new', loading: 'load' } }, on: (key, fn) => hooks.set(key, fn) },
    Topics: { topics }, Research: { getAllItems: () => research, checkForNewResearch() {} },
    GameManager: { company }, Notification: function (value) { Object.assign(this, value); },
    setInterval(fn, delay) { timers.push({ fn, delay }); return timers.length; }, clearInterval() {}, console: { log() {} }
  };
  vm.runInNewContext(readFileSync(new URL('../dist/main.js', import.meta.url), 'utf8'), context);
  hooks.get('new')();
  timers.find((timer) => timer.delay === 1000).fn();
  assert.equal(store.data.contract_state.receive.next_index, 2);
  assert.equal(company.cash, 110000);
  assert.equal(company.topics.length, 8);
  assert.equal(company.availableResearch.length, 0);
  assert.equal(research[0].canResearch(company), false);
  assert.ok(requests.some(({ route, payload }) => route.endsWith('/items/ack') && payload.throughIndex === 1));
  company.cash = 20000;
  company.gameLog.push({ title: 'Actual native release' });
  timers.find((timer) => timer.delay === 10000).fn();
  assert.equal(company.cash, 20000, 'replay must not apply the cash item twice');
  const report = requests.filter(({ route }) => route.endsWith('/progress')).at(-1).payload;
  assert.ok(report.checkedLocationIds.includes(4261001));
  assert.ok(report.checkedLocationIds.includes(4261201), 'earlier cash check remains monotonic after spending');
});
