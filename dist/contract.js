(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module && module.exports) module.exports = api;
  if (root) root.DMSGDTContract = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var SCHEMA_VERSION = 1;
  var STATE_VERSION = 1;
  var CLIENT_GOAL = 30;
  var ITEM_TOPIC = 'Unlock Topic';
  var ITEM_RESEARCH = 'Unlock Research';
  var ITEM_CASH = 'Cash 10k';
  var ITEM_FANS = 'Fans 100';

  var LOCATIONS = [
    ['Release 1 Game', 4261001, 'released_games', 1],
    ['Release 2 Games', 4261002, 'released_games', 2],
    ['Release 3 Games', 4261003, 'released_games', 3],
    ['Release 5 Games', 4261004, 'released_games', 5],
    ['Release 7 Games', 4261005, 'released_games', 7],
    ['Release 10 Games', 4261006, 'released_games', 10],
    ['Release 15 Games', 4261007, 'released_games', 15],
    ['Release 20 Games', 4261008, 'released_games', 20],
    ['Release 25 Games', 4261009, 'released_games', 25],
    ['Release 30 Games', 4261010, 'released_games', 30],
    ['Reach 100 Fans', 4261101, 'fans', 100],
    ['Reach 1,000 Fans', 4261102, 'fans', 1000],
    ['Reach 10,000 Fans', 4261103, 'fans', 10000],
    ['Reach 50,000 Fans', 4261104, 'fans', 50000],
    ['Reach 100,000 Fans', 4261105, 'fans', 100000],
    ['Reach 500,000 Fans', 4261106, 'fans', 500000],
    ['Reach 1,000,000 Fans', 4261107, 'fans', 1000000],
    ['Reach 5,000,000 Fans', 4261108, 'fans', 5000000],
    ['Reach 10,000,000 Fans', 4261109, 'fans', 10000000],
    ['Have $100,000 Cash', 4261201, 'cash', 100000],
    ['Have $500,000 Cash', 4261202, 'cash', 500000],
    ['Have $1,000,000 Cash', 4261203, 'cash', 1000000],
    ['Have $5,000,000 Cash', 4261204, 'cash', 5000000],
    ['Have $10,000,000 Cash', 4261205, 'cash', 10000000],
    ['Have $50,000,000 Cash', 4261206, 'cash', 50000000],
    ['Have $100,000,000 Cash', 4261207, 'cash', 100000000],
    ['Complete 1 Research', 4261301, 'completed_research', 1],
    ['Complete 3 Research', 4261302, 'completed_research', 3],
    ['Complete 5 Research', 4261303, 'completed_research', 5],
    ['Complete 10 Research', 4261304, 'completed_research', 10],
    ['Complete 20 Research', 4261305, 'completed_research', 20],
    ['Complete 30 Research', 4261306, 'completed_research', 30],
    ['Complete 40 Research', 4261307, 'completed_research', 40],
    ['Unlock 5 Topics', 4261401, 'unlocked_topics', 5],
    ['Unlock 10 Topics', 4261402, 'unlocked_topics', 10],
    ['Unlock 20 Topics', 4261403, 'unlocked_topics', 20],
    ['Unlock 30 Topics', 4261404, 'unlocked_topics', 30],
    ['Unlock 40 Topics', 4261405, 'unlocked_topics', 40],
    ['Unlock 50 Topics', 4261406, 'unlocked_topics', 50],
    ['Hire 1 Staff', 4261501, 'staff', 1],
    ['Hire 3 Staff', 4261502, 'staff', 3],
    ['Hire 5 Staff', 4261503, 'staff', 5],
    ['Hire 7 Staff', 4261504, 'staff', 7]
  ];

  var FINAL_LOCATION_IDS = [4261010, 4261109, 4261207, 4261307, 4261406, 4261504];

  function fail(message) {
    throw new Error(message);
  }

  function canonicalJson(value) {
    if (value === null || typeof value === 'number' || typeof value === 'boolean') return JSON.stringify(value);
    if (typeof value === 'string') return JSON.stringify(value);
    if (Array.isArray(value)) return '[' + value.map(canonicalJson).join(',') + ']';
    if (typeof value === 'object') {
      return '{' + Object.keys(value).sort().map(function (key) {
        return JSON.stringify(key) + ':' + canonicalJson(value[key]);
      }).join(',') + '}';
    }
    fail('contract contains a non-JSON value');
  }

  function integer(value, minimum, field) {
    if (typeof value !== 'number' || value % 1 !== 0 || value < minimum) fail(field + ' is invalid');
    return value;
  }

  function text(value, field) {
    if (typeof value !== 'string' || !value.trim()) fail(field + ' is invalid');
    return value;
  }

  function uniqueStrings(values, field, exact, minimum) {
    if (!Array.isArray(values)) fail(field + ' must be an array');
    if (exact !== null && values.length !== exact) fail(field + ' must contain exactly ' + exact + ' entries');
    if (minimum !== null && values.length < minimum) fail(field + ' must contain at least ' + minimum + ' entries');
    var seen = {};
    for (var i = 0; i < values.length; i++) {
      var value = text(values[i], field + '[' + i + ']');
      if (seen[value]) fail(field + ' contains a duplicate ID: ' + value);
      seen[value] = true;
    }
    return seen;
  }

  function flattenPacks(packs, field) {
    if (!Array.isArray(packs) || packs.length !== 19) fail(field + ' must contain exactly 19 packs');
    var flattened = [];
    for (var i = 0; i < packs.length; i++) {
      if (!Array.isArray(packs[i]) || !packs[i].length) fail(field + '[' + i + '] must be non-empty');
      for (var j = 0; j < packs[i].length; j++) flattened.push(text(packs[i][j], field + '[' + i + '][' + j + ']'));
    }
    return flattened;
  }

  function sameSet(expected, actual, field) {
    var expectedSet = uniqueStrings(expected, field + '.manifest', null, null);
    var actualSet = uniqueStrings(actual, field + '.contract', null, null);
    var expectedKeys = Object.keys(expectedSet);
    if (expectedKeys.length !== Object.keys(actualSet).length) fail(field + ' does not cover the manifest exactly');
    for (var i = 0; i < expectedKeys.length; i++) {
      if (!actualSet[expectedKeys[i]]) fail(field + ' is missing canonical ID ' + expectedKeys[i]);
    }
  }

  function unwrapSlotData(slotData) {
    if (!slotData || typeof slotData !== 'object') fail('slot data is missing');
    return slotData.contract && typeof slotData.contract === 'object' ? slotData.contract : slotData;
  }

  function validateSlotData(slotData, sha256) {
    var contract = unwrapSlotData(slotData);
    if (contract.schema_version !== SCHEMA_VERSION) fail('unsupported slot contract schema');
    if (!contract.world || contract.world.id !== 'gdt_tycoon') fail('slot contract is for another world');
    text(contract.world.version, 'world.version');
    if (!contract.game || contract.game.version !== '1.7.9') fail('slot contract is not for Game Dev Tycoon 1.7.9');
    if (contract.game.steam_build !== '20332874') fail('slot contract is not for reviewed Steam build 20332874');
    if (!contract.manifest || typeof contract.manifest !== 'object') fail('manifest identity is missing');
    text(contract.manifest.version, 'manifest.version');
    text(contract.manifest.sha256, 'manifest.sha256');
    var topicIds = contract.manifest.topic_ids;
    var researchIds = contract.manifest.research_ids;
    uniqueStrings(topicIds, 'manifest.topic_ids', 66, null);
    uniqueStrings(researchIds, 'manifest.research_ids', null, 40);
    uniqueStrings(contract.starting_topics, 'starting_topics', 4, null);
    sameSet(topicIds, contract.starting_topics.concat(flattenPacks(contract.topic_packs, 'topic_packs')), 'topics');
    sameSet(researchIds, flattenPacks(contract.research_packs, 'research_packs'), 'research');
    if (!contract.binding || typeof contract.binding !== 'object') fail('binding is missing');
    text(contract.binding.seed_name, 'binding.seed_name');
    integer(contract.binding.team, 0, 'binding.team');
    integer(contract.binding.slot, 1, 'binding.slot');
    text(contract.contract_hash, 'contract_hash');
    if (typeof sha256 !== 'function') fail('SHA-256 implementation is unavailable');
    var unhashed = {};
    Object.keys(contract).forEach(function (key) {
      if (key !== 'contract_hash') unhashed[key] = contract[key];
    });
    if (sha256(canonicalJson(unhashed)) !== contract.contract_hash) fail('slot contract hash mismatch');
    return contract;
  }

  function newState() {
    return {
      version: STATE_VERSION,
      binding: null,
      receive: {
        next_index: 0,
        counts: { topic: 0, research: 0, cash: 0, fans: 0 },
        recent: []
      },
      goal_accepted: false,
      blocked_reason: ''
    };
  }

  function ensureState(state) {
    if (!state || typeof state !== 'object' || state.version !== STATE_VERSION) fail('save has no supported AP contract state');
    if (!state.receive || typeof state.receive !== 'object') fail('save receive journal is missing');
    integer(state.receive.next_index, 0, 'receive.next_index');
    if (!state.receive.counts || typeof state.receive.counts !== 'object') fail('save item counters are missing');
    ['topic', 'research', 'cash', 'fans'].forEach(function (kind) {
      integer(state.receive.counts[kind], 0, 'receive.counts.' + kind);
    });
    if (!Array.isArray(state.receive.recent)) fail('save receive history is invalid');
    return state;
  }

  function connectionIdentity(connection) {
    if (!connection || typeof connection !== 'object') fail('authoritative connection identity is missing');
    return {
      seed_name: text(connection.seed_name || connection.seedName, 'connection.seed_name'),
      team: integer(connection.team, 0, 'connection.team'),
      slot: integer(connection.slot, 1, 'connection.slot')
    };
  }

  function sameBinding(left, right) {
    return left && right && left.seed_name === right.seed_name && left.team === right.team && left.slot === right.slot && left.contract_hash === right.contract_hash;
  }

  function bindFreshState(state, contract, connection, isFreshSave) {
    ensureState(state);
    var identity = connectionIdentity(connection);
    if (identity.seed_name !== contract.binding.seed_name || identity.team !== contract.binding.team || identity.slot !== contract.binding.slot) {
      fail('server identity does not match the signed slot contract');
    }
    var desired = {
      seed_name: identity.seed_name,
      team: identity.team,
      slot: identity.slot,
      contract_hash: contract.contract_hash,
      manifest_sha256: contract.manifest.sha256
    };
    if (!state.binding) {
      if (!isFreshSave) fail('AP binding is fresh-save-only');
      state.binding = desired;
    } else if (!sameBinding(state.binding, desired) || state.binding.manifest_sha256 !== desired.manifest_sha256) {
      fail('save is bound to a different AP seed, team, slot, contract, or manifest');
    }
    return state;
  }

  function entitlements(state, contract) {
    ensureState(state);
    var topic = contract.starting_topics.slice();
    var research = [];
    var topicCount = state.receive.counts.topic || 0;
    var researchCount = state.receive.counts.research || 0;
    if (topicCount > contract.topic_packs.length || researchCount > contract.research_packs.length) fail('save item counters exceed the slot contract');
    for (var i = 0; i < topicCount; i++) topic = topic.concat(contract.topic_packs[i]);
    for (var j = 0; j < researchCount; j++) research = research.concat(contract.research_packs[j]);
    return { topic_ids: topic, research_ids: research };
  }

  function itemName(item) {
    return text(item.name || item.item_name || item.itemName || item.key, 'received item name');
  }

  function nextContiguousItem(state, items) {
    ensureState(state);
    if (!Array.isArray(items)) fail('received items must be an array');
    var atIndex = {};
    for (var i = 0; i < items.length; i++) {
      var index = integer(items[i].index, 0, 'received item index');
      var serialized = canonicalJson(items[i]);
      if (atIndex[index] && canonicalJson(atIndex[index]) !== serialized) fail('conflicting received items share index ' + index);
      atIndex[index] = items[i];
    }
    return atIndex[state.receive.next_index] || null;
  }

  function effectForItem(state, contract, item) {
    ensureState(state);
    var name = itemName(item);
    var counts = state.receive.counts;
    if (name === ITEM_TOPIC) {
      if (counts.topic >= contract.topic_packs.length) fail('received too many Topic pack items');
      return { kind: 'topic', ids: contract.topic_packs[counts.topic].slice(), amount: 0 };
    }
    if (name === ITEM_RESEARCH) {
      if (counts.research >= contract.research_packs.length) fail('received too many Research pack items');
      return { kind: 'research', ids: contract.research_packs[counts.research].slice(), amount: 0 };
    }
    if (name === ITEM_CASH) return { kind: 'cash', ids: [], amount: 10000 };
    if (name === ITEM_FANS) return { kind: 'fans', ids: [], amount: 100 };
    fail('unsupported GDT item: ' + name);
  }

  function recordApplied(state, item, effect) {
    ensureState(state);
    var index = integer(item.index, 0, 'received item index');
    if (index !== state.receive.next_index) fail('received item journal is not contiguous');
    if (!state.receive.counts.hasOwnProperty(effect.kind)) fail('unsupported applied effect kind');
    state.receive.counts[effect.kind] += 1;
    state.receive.next_index += 1;
    state.receive.recent.push({ index: index, name: itemName(item), kind: effect.kind });
    if (state.receive.recent.length > 128) state.receive.recent.splice(0, state.receive.recent.length - 128);
    return state.receive.next_index - 1;
  }

  function collectCanonicalIds(value, allowed, result) {
    if (Array.isArray(value)) {
      for (var i = 0; i < value.length; i++) collectCanonicalIds(value[i], allowed, result);
      return;
    }
    var id = '';
    if (typeof value === 'string') id = value;
    else if (value && typeof value === 'object' && value.id !== undefined && value.id !== null) id = String(value.id);
    if (id && allowed[id]) result[id] = true;
  }

  function collectMilestones(company, contract) {
    if (!company || typeof company !== 'object') fail('company state is unavailable');
    var topicSet = uniqueStrings(contract.manifest.topic_ids, 'manifest.topic_ids', 66, null);
    var researchSet = uniqueStrings(contract.manifest.research_ids, 'manifest.research_ids', null, 40);
    var unlockedTopics = {};
    var completedResearch = {};
    collectCanonicalIds(company.topics || [], topicSet, unlockedTopics);
    collectCanonicalIds(company.researchCompleted || [], researchSet, completedResearch);
    var metrics = {
      released_games: Array.isArray(company.gameLog) ? company.gameLog.length : 0,
      fans: Math.max(0, Number(company.fans) || 0),
      cash: Math.max(0, Number(company.cash) || 0),
      completed_research: Object.keys(completedResearch).length,
      unlocked_topics: Object.keys(unlockedTopics).length,
      staff: Array.isArray(company.staff) ? company.staff.length : 0
    };
    var checked = [];
    for (var i = 0; i < LOCATIONS.length; i++) {
      if (metrics[LOCATIONS[i][2]] >= LOCATIONS[i][3]) checked.push(LOCATIONS[i][1]);
    }
    var checkedSet = {};
    checked.forEach(function (id) { checkedSet[id] = true; });
    var goal = FINAL_LOCATION_IDS.every(function (id) { return !!checkedSet[id]; });
    return {
      metrics: metrics,
      checked_location_ids: checked,
      goal: goal,
      client_status: goal ? CLIENT_GOAL : null
    };
  }

  return {
    SCHEMA_VERSION: SCHEMA_VERSION,
    STATE_VERSION: STATE_VERSION,
    CLIENT_GOAL: CLIENT_GOAL,
    LOCATIONS: LOCATIONS,
    FINAL_LOCATION_IDS: FINAL_LOCATION_IDS,
    canonicalJson: canonicalJson,
    validateSlotData: validateSlotData,
    newState: newState,
    ensureState: ensureState,
    bindFreshState: bindFreshState,
    entitlements: entitlements,
    nextContiguousItem: nextContiguousItem,
    effectForItem: effectForItem,
    recordApplied: recordApplied,
    collectMilestones: collectMilestones
  };
});
