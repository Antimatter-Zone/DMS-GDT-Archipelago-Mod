import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const Contract = require('../dist/contract.js');

function sha256(value) {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function distribute(values) {
  const packs = Array.from({ length: 19 }, () => []);
  values.forEach((value, index) => packs[index % packs.length].push(value));
  return packs;
}

function fixture() {
  const topicIds = Array.from({ length: 66 }, (_, index) => `test-topic-${String(index).padStart(2, '0')}`);
  const researchIds = Array.from({ length: 40 }, (_, index) => `test-research-${String(index).padStart(2, '0')}`);
  const value = {
    schema_version: 1,
    world: { id: 'gdt_tycoon', version: '0.2.0-source' },
    game: { version: '1.7.9', steam_build: '20332874' },
    manifest: {
      version: 'test-only-1',
      sha256: '0'.repeat(64),
      topic_ids: topicIds,
      research_ids: researchIds,
    },
    binding: { seed_name: 'unit-seed', team: 0, slot: 3 },
    starting_topics: topicIds.slice(0, 4),
    topic_packs: distribute(topicIds.slice(4)),
    research_packs: distribute(researchIds),
    goal: {
      released_games: 30,
      fans: 10_000_000,
      cash: 100_000_000,
      completed_research: 40,
      unlocked_topics: 50,
      staff: 7,
    },
  };
  value.contract_hash = sha256(Contract.canonicalJson(value));
  return value;
}

test('validates a hashed 66-topic/40-research slot contract', () => {
  const value = fixture();
  assert.equal(Contract.validateSlotData({ contract: value }, sha256), value);
  const changed = structuredClone(value);
  changed.binding.slot = 4;
  assert.throws(() => Contract.validateSlotData(changed, sha256), /hash mismatch/);
});

test('canonical JSON hash matches the Python APWorld contract', () => {
  const value = { b: { y: null }, a: [1, true, 'x'] };
  assert.equal(Contract.canonicalJson(value), '{"a":[1,true,"x"],"b":{"y":null}}');
  assert.equal(sha256(Contract.canonicalJson(value)), 'a36ff18539867cd7a07100365c310ae5eb71ab43013820d828bdcce41108f507');
});

test('binds only a fresh save and rejects identity changes', () => {
  const contract = fixture();
  const connection = { seed_name: 'unit-seed', team: 0, slot: 3 };
  assert.throws(() => Contract.bindFreshState(Contract.newState(), contract, connection, false), /fresh-save-only/);
  const state = Contract.bindFreshState(Contract.newState(), contract, connection, true);
  Contract.bindFreshState(state, contract, connection, false);
  assert.throws(
    () => Contract.bindFreshState(state, contract, { seed_name: 'unit-seed', team: 0, slot: 4 }, false),
    /does not match/,
  );
});

test('received-item journal advances only across a contiguous applied prefix', () => {
  const contract = fixture();
  const state = Contract.newState();
  const items = [
    { index: 1, name: 'Unlock Research' },
    { index: 0, name: 'Unlock Topic' },
  ];
  const first = Contract.nextContiguousItem(state, items);
  assert.equal(first.index, 0);
  const firstEffect = Contract.effectForItem(state, contract, first);
  assert.equal(firstEffect.kind, 'topic');
  Contract.recordApplied(state, first, firstEffect);
  const second = Contract.nextContiguousItem(state, items);
  assert.equal(second.index, 1);
  const secondEffect = Contract.effectForItem(state, contract, second);
  Contract.recordApplied(state, second, secondEffect);
  assert.equal(state.receive.next_index, 2);
  assert.equal(Contract.nextContiguousItem(state, [{ index: 3, name: 'Cash 10k' }]), null);
  assert.equal(Contract.entitlements(state, contract).topic_ids.length, 4 + contract.topic_packs[0].length);
});

test('reports all 43 stable milestones and CLIENT_GOAL only at all six finals', () => {
  const contract = fixture();
  const company = {
    gameLog: Array.from({ length: 30 }, () => ({})),
    fans: 10_000_000,
    cash: 100_000_000,
    topics: contract.manifest.topic_ids.slice(0, 50).map((id) => ({ id })),
    researchCompleted: contract.manifest.research_ids.map((id) => ({ id })),
    staff: Array.from({ length: 7 }, () => ({})),
  };
  const report = Contract.collectMilestones(company, contract);
  assert.equal(report.checked_location_ids.length, 43);
  assert.equal(report.client_status, Contract.CLIENT_GOAL);
  company.staff.pop();
  const incomplete = Contract.collectMilestones(company, contract);
  assert.equal(incomplete.goal, false);
  assert.equal(incomplete.client_status, null);
});

test('the impossible staff milestone was replaced without changing its ID', () => {
  assert.equal(Contract.LOCATIONS.length, 43);
  const expectedIds = [
    ...Array.from({ length: 10 }, (_, index) => 4261001 + index),
    ...Array.from({ length: 9 }, (_, index) => 4261101 + index),
    ...Array.from({ length: 7 }, (_, index) => 4261201 + index),
    ...Array.from({ length: 7 }, (_, index) => 4261301 + index),
    ...Array.from({ length: 6 }, (_, index) => 4261401 + index),
    ...Array.from({ length: 4 }, (_, index) => 4261501 + index),
  ];
  assert.deepEqual(Contract.LOCATIONS.map(([, id]) => id), expectedIds);
  assert.ok(Contract.LOCATIONS.some(([name, id]) => name === 'Hire 7 Staff' && id === 4261504));
  assert.ok(!Contract.LOCATIONS.some(([name]) => name === 'Hire 10 Staff'));
});
