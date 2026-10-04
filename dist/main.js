(function () {
  'use strict';

  // Private integration client. Game files and credentials are never bundled.
  var MOD_ID = 'DMSArchipelago';
  var MOD_TAG = '[DMS Archipelago]';
  var POLL_INTERVAL_MS = 10000;

  var pendingArchipelagoMode = false;
  var freshSaveThisSession = false;
  var pollTimer = null;
  var heartbeatTimer = null;
  var pollInFlight = false;
  var activeStore = null;
  var activeContract = null;
  var activeConfig = null;
  var runtimeBlockedReason = '';
  var lastNotice = '';

  function log(message) {
    try {
      if (typeof console !== 'undefined' && console && typeof console.log === 'function') {
        console.log(MOD_TAG + ' ' + message);
      }
    } catch (error) {}
  }

  function tryRequire(name) {
    try {
      if (typeof require === 'function') return require(name);
    } catch (error) {}
    return null;
  }

  function getAvailableModById(id) {
    try {
      if (typeof ModSupport === 'undefined' || !ModSupport.availableMods) return null;
      for (var i = 0; i < ModSupport.availableMods.length; i++) {
        if (ModSupport.availableMods[i] && ModSupport.availableMods[i].id === id) return ModSupport.availableMods[i];
      }
    } catch (error) {}
    return null;
  }

  function loadLocalModule(filename) {
    var direct = tryRequire('./' + filename);
    if (direct) return direct;
    var path = tryRequire('path');
    var mod = getAvailableModById(MOD_ID);
    if (path && mod && mod.folder) return tryRequire(path.resolve(String(mod.folder), filename));
    try {
      if (filename === 'contract.js' && typeof DMSGDTContract !== 'undefined') return DMSGDTContract;
    } catch (error) {}
    return null;
  }

  var Contract = loadLocalModule('contract.js');
  var Bridge = loadLocalModule('bridge.js');

  function notify(header, text) {
    var key = header + '\n' + text;
    if (key === lastNotice) return;
    lastNotice = key;
    try {
      if (typeof GameManager !== 'undefined' && GameManager.company && typeof Notification !== 'undefined') {
        GameManager.company.notifications.push(new Notification({ header: header, text: text }));
        return;
      }
    } catch (error) {}
    log(header + ': ' + text);
  }

  function block(reason) {
    runtimeBlockedReason = String(reason || 'Unknown compatibility failure.');
    if (activeStore && activeStore.data && activeStore.data.contract_state) {
      activeStore.data.contract_state.blocked_reason = runtimeBlockedReason;
    }
    notify('Archipelago paused', runtimeBlockedReason);
  }

  function clearBlock() {
    runtimeBlockedReason = '';
    if (activeStore && activeStore.data && activeStore.data.contract_state) {
      activeStore.data.contract_state.blocked_reason = '';
    }
  }

  function getDataStore() {
    try {
      if (typeof GDT === 'undefined' || typeof GDT.getDataStore !== 'function') return null;
      return GDT.getDataStore(MOD_ID);
    } catch (error) {
      return null;
    }
  }

  function ensureSettings(store) {
    if (!store) return;
    if (!store.settings) store.settings = {};
    if (!store.data) store.data = {};
    if (store.settings.poll_interval_ms === undefined) store.settings.poll_interval_ms = POLL_INTERVAL_MS;
  }

  function normalizeBaseUrl(value) {
    if (!Bridge) throw new Error('AMZ Hub bridge module is unavailable');
    return Bridge.normalizeBaseUrl(value);
  }

  function readConfigFile() {
    var fs = tryRequire('fs');
    var path = tryRequire('path');
    var mod = getAvailableModById(MOD_ID);
    if (!fs || !path || !mod || !mod.folder) throw new Error('mod folder is unavailable');
    var filePath = path.join(String(mod.folder), 'dms-ap-config.json');
    var parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    var config = {
      bridgeBaseUrl: normalizeBaseUrl(parsed.bridgeBaseUrl),
      serverId: String(parsed.serverId || parsed.server_id || '').trim(),
      clientId: String(parsed.clientId || parsed.client_id || '').trim(),
      sessionToken: String(parsed.sessionToken || parsed.session_token || '').trim(),
      gameVersion: String(parsed.gameVersion || parsed.game_version || '').trim(),
      steamBuild: String(parsed.steamBuild || parsed.steam_build || '').trim(),
      smokeProfile: String(parsed.smokeProfile || '').trim()
    };
    if (!config.serverId || !config.clientId || !config.sessionToken) {
      throw new Error('Hub-managed server, client, or session credential is missing');
    }
    return config;
  }

  function sha256(text) {
    var crypto = tryRequire('crypto');
    if (!crypto || typeof crypto.createHash !== 'function') throw new Error('SHA-256 is unavailable');
    return crypto.createHash('sha256').update(String(text), 'utf8').digest('hex');
  }

  function httpJson(method, path, body, callback) {
    if (!activeConfig) return callback(new Error('bridge configuration is unavailable'));
    try {
      Bridge.request(activeConfig, method, path, body, callback);
    } catch (error) { callback(error); }
  }

  function safeCompany() {
    try {
      return typeof GameManager !== 'undefined' ? GameManager.company : null;
    } catch (error) {
      return null;
    }
  }

  function getCompanyName() {
    var company = safeCompany();
    return company ? String(company.name || company.companyName || '') : '';
  }

  function getCharacterName() {
    var company = safeCompany();
    if (!company) return '';
    if (company.playerName || company.characterName) return String(company.playerName || company.characterName);
    return company.staff && company.staff[0] && company.staff[0].name ? String(company.staff[0].name) : '';
  }

  function allTopics() {
    try {
      return typeof Topics !== 'undefined' && Topics && Array.isArray(Topics.topics) ? Topics.topics : [];
    } catch (error) {
      return [];
    }
  }

  function allResearch() {
    try {
      return typeof Research !== 'undefined' && Research && typeof Research.getAllItems === 'function'
        ? Research.getAllItems() || [] : [];
    } catch (error) {
      return [];
    }
  }

  function exactObjectMap(values, label) {
    var result = {};
    for (var i = 0; i < values.length; i++) {
      var value = values[i];
      if (!value || value.id === undefined || value.id === null) continue;
      var id = String(value.id);
      if (result[id] && result[id] !== value) throw new Error('duplicate canonical ' + label + ' ID: ' + id);
      result[id] = value;
    }
    return result;
  }

  function requireCanonicalObjects(contract) {
    var topics = exactObjectMap(allTopics(), 'topic');
    var research = exactObjectMap(allResearch(), 'research');
    for (var i = 0; i < contract.manifest.topic_ids.length; i++) {
      if (!topics[contract.manifest.topic_ids[i]]) throw new Error('canonical topic is absent from this game build: ' + contract.manifest.topic_ids[i]);
    }
    for (var j = 0; j < contract.manifest.research_ids.length; j++) {
      if (!research[contract.manifest.research_ids[j]]) throw new Error('canonical research is absent from this game build: ' + contract.manifest.research_ids[j]);
    }
    return { topics: topics, research: research };
  }

  function isActiveMode() {
    return !!(activeStore && activeStore.data && activeStore.data.archipelago_mode && activeContract && !runtimeBlockedReason);
  }

  function entitlementSets() {
    var values = Contract.entitlements(activeStore.data.contract_state, activeContract);
    var topics = {};
    var research = {};
    values.topic_ids.forEach(function (id) { topics[id] = true; });
    values.research_ids.forEach(function (id) { research[id] = true; });
    return { topics: topics, research: research };
  }

  function installResearchAuthorizationGuards(canonical) {
    activeContract.manifest.research_ids.forEach(function (id) {
      var research = canonical.research[id];
      if (research.__dmsApAuthorizationGuardInstalled) return;
      var original = typeof research.canResearch === 'function' ? research.canResearch : null;
      try {
        Object.defineProperty(research, '__dmsApOriginalCanResearch', { value: original, enumerable: false });
        Object.defineProperty(research, '__dmsApAuthorizationGuardInstalled', { value: true, enumerable: false });
      } catch (error) {
        research.__dmsApOriginalCanResearch = original;
        research.__dmsApAuthorizationGuardInstalled = true;
      }
      research.canResearch = function (company) {
        if (isActiveMode() && !entitlementSets().research[id]) return false;
        return original ? original.call(this, company) : true;
      };
    });
  }

  function canonicalId(value) {
    if (typeof value === 'string') return value;
    if (value && typeof value === 'object' && value.id !== undefined && value.id !== null) return String(value.id);
    return '';
  }

  function filterCompletedEntry(entry, manifestIds, authorizedIds, canonicalResearch) {
    if (Array.isArray(entry)) {
      var nested = [];
      for (var i = 0; i < entry.length; i++) {
        var kept = filterCompletedEntry(entry[i], manifestIds, authorizedIds, canonicalResearch);
        if (kept !== null) nested.push(kept);
      }
      return nested.length ? nested : null;
    }
    var id = canonicalId(entry);
    if (id && manifestIds[id]) {
      if (!authorizedIds[id]) return null;
      return canonicalResearch[id];
    }
    return entry;
  }

  function reconcileCanonicalProgress(company, canonical) {
    var rights = entitlementSets();
    var topicManifest = {};
    var researchManifest = {};
    activeContract.manifest.topic_ids.forEach(function (id) { topicManifest[id] = true; });
    activeContract.manifest.research_ids.forEach(function (id) { researchManifest[id] = true; });

    var currentTopics = Array.isArray(company.topics) ? company.topics : [];
    var topics = [];
    var present = {};
    for (var i = 0; i < currentTopics.length; i++) {
      var topicId = canonicalId(currentTopics[i]);
      if (topicId && topicManifest[topicId]) {
        if (!rights.topics[topicId]) continue;
        topics.push(canonical.topics[topicId]);
      } else topics.push(currentTopics[i]);
      if (topicId) present[topicId] = true;
    }
    Object.keys(rights.topics).forEach(function (id) {
      if (!present[id]) topics.push(canonical.topics[id]);
    });
    company.topics = topics;

    var completed = Array.isArray(company.researchCompleted) ? company.researchCompleted : [];
    var filtered = [];
    for (var j = 0; j < completed.length; j++) {
      var kept = filterCompletedEntry(completed[j], researchManifest, rights.research, canonical.research);
      if (kept !== null) filtered.push(kept);
    }
    company.researchCompleted = filtered;
    // The native UI also uses this cached availability list. Removing only the
    // canResearch gate would leave starting research visible before its pack.
    if (Array.isArray(company.availableResearch)) {
      company.availableResearch = company.availableResearch.filter(function (entry) {
        var id = canonicalId(entry);
        return !researchManifest[id] || !!rights.research[id];
      });
    }
    if (typeof Research !== 'undefined' && typeof Research.checkForNewResearch === 'function') {
      Research.checkForNewResearch();
    }
  }

  function validateInstalledBuild(contract) {
    if (activeConfig.gameVersion !== contract.game.version || activeConfig.steamBuild !== contract.game.steam_build) {
      throw new Error('Hub-verified game version/build does not match the slot contract');
    }
  }

  function acceptContract(slotData, connection) {
    var contract = Contract.validateSlotData(slotData, sha256);
    validateInstalledBuild(contract);
    var state = activeStore.data.contract_state || Contract.newState();
    Contract.bindFreshState(state, contract, connection, freshSaveThisSession);
    activeStore.data.contract_state = state;
    activeStore.data.slot_contract = contract;
    activeContract = contract;
    var canonical = requireCanonicalObjects(contract);
    installResearchAuthorizationGuards(canonical);
    reconcileCanonicalProgress(safeCompany(), canonical);
    clearBlock();
    return canonical;
  }

  function restoreSavedContract() {
    if (!activeStore || !activeStore.data || !activeStore.data.archipelago_mode) return;
    if (!activeStore.data.slot_contract || !activeStore.data.contract_state) {
      throw new Error('AP save has no slot contract; only a fresh save may be bound');
    }
    activeContract = Contract.validateSlotData(activeStore.data.slot_contract, sha256);
    validateInstalledBuild(activeContract);
    Contract.ensureState(activeStore.data.contract_state);
    var canonical = requireCanonicalObjects(activeContract);
    installResearchAuthorizationGuards(canonical);
    reconcileCanonicalProgress(safeCompany(), canonical);
  }

  function applyEffect(company, canonical, effect) {
    if (effect.kind === 'topic') {
      for (var i = 0; i < effect.ids.length; i++) {
        if (!canonical.topics[effect.ids[i]]) throw new Error('Topic pack contains an unknown canonical ID');
      }
      return;
    }
    if (effect.kind === 'research') {
      for (var j = 0; j < effect.ids.length; j++) {
        if (!canonical.research[effect.ids[j]]) throw new Error('Research pack contains an unknown canonical ID');
      }
      // Authorization only. The native canResearch function still governs era,
      // prerequisites, points spending, duration, and normal completion.
      return;
    }
    if (effect.kind === 'cash') {
      if (typeof company.adjustCash !== 'function') throw new Error('native cash adjustment API is unavailable');
      company.adjustCash(effect.amount, 'Archipelago');
      return;
    }
    if (effect.kind === 'fans') {
      if (typeof company.adjustFans !== 'function') throw new Error('native fan adjustment API is unavailable');
      company.adjustFans(effect.amount, 'Archipelago');
      return;
    }
    throw new Error('unsupported effect kind');
  }

  function applyReceivedItems(items) {
    var state = activeStore.data.contract_state;
    var company = safeCompany();
    var canonical = requireCanonicalObjects(activeContract);
    var highest = null;
    while (true) {
      var item = Contract.nextContiguousItem(state, items);
      if (!item) break;
      var effect = Contract.effectForItem(state, activeContract, item);
      applyEffect(company, canonical, effect);
      highest = Contract.recordApplied(state, item, effect);
      reconcileCanonicalProgress(company, canonical);
      notify('Archipelago item', String(item.name || item.item_name || item.itemName || item.key) + ' received.');
    }
    return highest;
  }

  function bridgeEnvelope() {
    return {
      serverId: activeConfig.serverId,
      clientId: activeConfig.clientId,
      companyName: getCompanyName(),
      characterName: getCharacterName(),
      nextItemIndex: activeStore.data.contract_state ? activeStore.data.contract_state.receive.next_index : 0
    };
  }

  function acknowledge(highestIndex) {
    if (highestIndex === null || highestIndex === undefined) return;
    var payload = bridgeEnvelope();
    payload.throughIndex = highestIndex;
    payload.contractHash = activeContract.contract_hash;
    httpJson('POST', '/api/archipelago/gdt/client/items/ack', payload, function () {});
  }

  function reportProgress() {
    if (!activeContract || runtimeBlockedReason) return;
    var report;
    try {
      report = Contract.collectMilestones(safeCompany(), activeContract);
    } catch (error) {
      block(error.message || error);
      return;
    }
    var payload = bridgeEnvelope();
    payload.contractHash = activeContract.contract_hash;
    var checked = activeStore.data.checked_location_ids || [];
    report.checked_location_ids.forEach(function (id) { if (checked.indexOf(id) < 0) checked.push(id); });
    activeStore.data.checked_location_ids = checked;
    payload.checkedLocationIds = checked.slice();
    payload.metrics = report.metrics;
    payload.clientStatus = activeStore.data.contract_state.goal_accepted ? null : report.client_status;
    httpJson('POST', '/api/archipelago/gdt/client/progress', payload, function (error, json) {
      if (!error && report.goal && json && json.clientGoalAccepted === true) {
        activeStore.data.contract_state.goal_accepted = true;
      }
    });
  }

  function processBridgeResponse(json) {
    if (!json || json.ok !== true) throw new Error('bridge returned an invalid response');
    if (json.slotData || json.connection) {
      if (!json.slotData || !json.connection) throw new Error('bridge returned incomplete slot identity');
      acceptContract(json.slotData, json.connection);
    }
    if (!activeContract) throw new Error('bridge did not provide a slot contract');
    var highest = applyReceivedItems(json.items || []);
    acknowledge(highest);
    reportProgress();
  }

  function syncClient() {
    if (pollInFlight || runtimeBlockedReason) return;
    pollInFlight = true;
    var payload = bridgeEnvelope();
    payload.archipelagoMode = true;
    httpJson('POST', '/api/archipelago/gdt/client/sync', payload, function (error, json) {
      pollInFlight = false;
      if (error) return;
      try { processBridgeResponse(json); } catch (responseError) { block(responseError.message || responseError); }
    });
  }

  function pollBridge() {
    if (pollInFlight || runtimeBlockedReason || !activeContract) return;
    pollInFlight = true;
    httpJson('POST', '/api/archipelago/gdt/client/poll', bridgeEnvelope(), function (error, json) {
      pollInFlight = false;
      if (error) return;
      try { processBridgeResponse(json); } catch (responseError) { block(responseError.message || responseError); }
    });
  }

  function startPolling() {
    if (pollTimer) return;
    var interval = Number(activeStore.settings.poll_interval_ms) || POLL_INTERVAL_MS;
    pollTimer = setInterval(function () {
      if (activeContract) pollBridge();
      else syncClient();
    }, Math.max(5000, interval));
    syncClient();
  }

  function stopPolling() {
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = null;
    pollInFlight = false;
  }

  function ensureSession() {
    var company = safeCompany();
    if (!company || !activeStore || !activeStore.data.archipelago_mode) {
      stopPolling();
      return;
    }
    if (!getCompanyName() || !getCharacterName()) return;
    if (!activeConfig) {
      try { activeConfig = readConfigFile(); }
      catch (error) {
        notify('Archipelago waiting', 'AMZ Hub configuration is not ready.');
        return;
      }
    }
    if (activeStore.data.slot_contract && !activeContract) {
      try { restoreSavedContract(); }
      catch (error) { block(error.message || error); return; }
    }
    if (activeContract && !runtimeBlockedReason) {
      try { reconcileCanonicalProgress(company, requireCanonicalObjects(activeContract)); }
      catch (error) { block(error.message || error); return; }
    }
    startPolling();
  }

  function ensureNewGameOption() {
    if (typeof window === 'undefined' || typeof window.$ !== 'function') return;
    if (window.__dmsArchipelagoFreshSaveOption) return;
    var panel = window.$('#newGameView').find('.featureSelectionPanel.featureSelectionPanelHiddenState');
    if (!panel.length) return;
    window.__dmsArchipelagoFreshSaveOption = true;
    var wrap = window.$('<div id="dms-ap-advanced-option" style="margin-top:10px"></div>');
    wrap.append('<h3>Archipelago Mode</h3>');
    wrap.append('<div style="margin-bottom:6px">Bind this new save to its assigned DMS Archipelago slot.</div>');
    var select = window.$('<select><option value="off">Off</option><option value="on">On</option></select>');
    select.val(pendingArchipelagoMode ? 'on' : 'off');
    select.on('change', function () {
      pendingArchipelagoMode = select.val() === 'on';
      notify('Archipelago', 'New-save mode: ' + (pendingArchipelagoMode ? 'On' : 'Off'));
    });
    wrap.append(select);
    panel.append(wrap);
  }

  function ensureSettingsTab() {
    if (typeof window === 'undefined' || typeof window.$ !== 'function') return;
    if (typeof GDT === 'undefined' || typeof GDT.addSettingsTab !== 'function') return;
    if (window.__dmsArchipelagoSettingsAdded) return;
    window.__dmsArchipelagoSettingsAdded = true;
    var root = window.$('<div class="dms-ap-settings"></div>');
    root.append('<h2>DMS Archipelago</h2>');
    root.append('<p>Slot identity and client files are managed by AMZ Hub.</p>');
    var status = window.$('<div class="dms-ap-status"></div>');
    root.append(status);
    function refresh() {
      if (runtimeBlockedReason) status.text('Paused: ' + runtimeBlockedReason);
      else if (activeStore && activeStore.data && activeStore.data.contract_state && activeStore.data.contract_state.binding) {
        var binding = activeStore.data.contract_state.binding;
        status.text('Bound to seed ' + binding.seed_name + ', team ' + binding.team + ', slot ' + binding.slot + '.');
      } else status.text('Not bound. Binding is available only when starting a fresh AP-mode save.');
    }
    var refreshButton = window.$('<button type="button" style="margin-top:8px">Refresh Status</button>');
    refreshButton.on('click', refresh);
    root.append(refreshButton);
    GDT.addSettingsTab('Archipelago', root);
    refresh();
  }

  function registerEvents() {
    if (typeof GDT === 'undefined' || !GDT.on || !GDT.eventKeys) return;
    try { GDT.on(GDT.eventKeys.mod.loaded, ensureSettingsTab); } catch (error) {}
    try {
      if (GDT.eventKeys.saves && GDT.eventKeys.saves.newGame) {
        GDT.on(GDT.eventKeys.saves.newGame, function () {
          freshSaveThisSession = true;
          stopPolling();
          activeContract = null;
          runtimeBlockedReason = '';
          activeStore.data = {
            archipelago_mode: !!pendingArchipelagoMode,
            contract_state: pendingArchipelagoMode ? Contract.newState() : null,
            slot_contract: null
          };
        });
      }
    } catch (error) {}
    try {
      if (GDT.eventKeys.saves && GDT.eventKeys.saves.loading) {
        GDT.on(GDT.eventKeys.saves.loading, function () {
          freshSaveThisSession = false;
          stopPolling();
          activeContract = null;
          runtimeBlockedReason = '';
        });
      }
    } catch (error) {}
  }

  function init() {
    activeStore = getDataStore();
    ensureSettings(activeStore);
    if (!Contract || !Bridge) {
      block('The versioned contract module could not be loaded.');
      return;
    }
    try {
      activeConfig = readConfigFile();
      if (/^smoke-[ab]$/.test(activeConfig.smokeProfile)) pendingArchipelagoMode = true;
    }
    catch (error) { log('Hub-managed configuration is not ready.'); }
    registerEvents();
    if (!heartbeatTimer) {
      heartbeatTimer = setInterval(function () {
        ensureNewGameOption();
        ensureSession();
      }, 1000);
    }
    log('Private integration client loaded; AMZ Hub manages the connection.');
  }

  init();
})();
