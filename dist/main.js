(function () {
  'use strict';

  // DMS Archipelago (Game Dev Tycoon)
  // - Requires UltimateLib (notifications + advanced options UI).
  // - Uses the DMS Discord bot as the network bridge (REST polling).
  // - Applies item effects in-game (unlock topics/research, cash/fans, etc.).
  // - Syncs a per-save randomized ordering so "Unlock Topic/Research" stays deterministic.

  var MOD_ID = 'DMSArchipelago';
  var MOD_TAG = '[DMS Archipelago]';
  var DEFAULT_BOT_BASE_URL = 'https://bot.darkmatterservers.com';
  var POLL_ITEMS_INTERVAL_MS = 15000;

  var pendingArchipelagoMode = false;
  var pollTimer = null;
  var heartbeatTimer = null;
  var lastSaveEvent = '';
  var lastCompany = null;

  function log(msg) {
    try {
      if (typeof console !== 'undefined' && console && typeof console.log === 'function') {
        console.log(MOD_TAG + ' ' + msg);
      }
    } catch (e) {}
  }

  function hasJquery() {
    return typeof window !== 'undefined' && window && typeof window.$ === 'function';
  }

  function tryRequire(name) {
    try {
      if (typeof require === 'function') {
        return require(name);
      }
    } catch (e) {}
    return null;
  }

  function normalizeBaseUrl(value) {
    var text = (value || '').toString().trim();
    if (!text) return DEFAULT_BOT_BASE_URL;
    return text.replace(/\/+$/, '');
  }

  function getAvailableModById(id) {
    try {
      if (typeof ModSupport === 'undefined' || !ModSupport.availableMods) return null;
      for (var i = 0; i < ModSupport.availableMods.length; i++) {
        var mod = ModSupport.availableMods[i];
        if (mod && mod.id === id) return mod;
      }
    } catch (e) {}
    return null;
  }

  function isModInstalled(id) {
    return !!getAvailableModById(id);
  }

  function getDataStore() {
    try {
      if (typeof GDT === 'undefined' || typeof GDT.getDataStore !== 'function') return null;
      return GDT.getDataStore(MOD_ID);
    } catch (e) {
      return null;
    }
  }

  function ensureStoreDefaults(store) {
    if (!store) return;
    if (!store.settings) store.settings = {};
    if (!store.data) store.data = {};

    if (store.settings.pollIntervalMs === undefined || store.settings.pollIntervalMs === null) {
      store.settings.pollIntervalMs = POLL_ITEMS_INTERVAL_MS;
    }
    if (store.settings.botBaseUrlOverride === undefined) {
      store.settings.botBaseUrlOverride = '';
    }
  }

  function readConfigFile() {
    var cfg = { botBaseUrl: DEFAULT_BOT_BASE_URL, serverId: '' };

    var fs = tryRequire('fs');
    var path = tryRequire('path');
    if (!fs || !path) {
      return cfg;
    }

    var mod = getAvailableModById(MOD_ID);
    var modFolder = mod && mod.folder ? String(mod.folder) : '';
    if (!modFolder) {
      return cfg;
    }

    try {
      var filePath = path.join(modFolder, 'dms-ap-config.json');
      if (!fs.existsSync(filePath)) {
        return cfg;
      }
      var raw = fs.readFileSync(filePath, 'utf8');
      var parsed = JSON.parse(raw);
      cfg.botBaseUrl = normalizeBaseUrl(parsed.botBaseUrl || parsed.bot_base_url || cfg.botBaseUrl);
      cfg.serverId = (parsed.serverId || parsed.server_id || cfg.serverId || '').toString().trim();
    } catch (e) {
      log('Failed to read dms-ap-config.json: ' + (e && e.message ? e.message : e));
    }

    return cfg;
  }

  function getEffectiveBotBaseUrl(store, cfg) {
    if (store && store.settings && store.settings.botBaseUrlOverride) {
      return normalizeBaseUrl(store.settings.botBaseUrlOverride);
    }
    return normalizeBaseUrl(cfg.botBaseUrl);
  }

  function httpRequestJson(method, url, body, cb) {
    var payloadText = null;
    if (body !== undefined && body !== null) {
      try {
        payloadText = JSON.stringify(body);
      } catch (e) {
        cb(e, null);
        return;
      }
    }

    try {
      if (typeof XMLHttpRequest !== 'undefined') {
        var xhr = new XMLHttpRequest();
        xhr.open(method, url, true);
        xhr.setRequestHeader('Accept', 'application/json');
        if (payloadText !== null) {
          xhr.setRequestHeader('Content-Type', 'application/json');
        }
        xhr.onreadystatechange = function () {
          if (xhr.readyState !== 4) return;
          var ok = xhr.status >= 200 && xhr.status < 300;
          var parsed = null;
          try {
            parsed = JSON.parse(xhr.responseText || 'null');
          } catch (e) {}
          cb(ok ? null : new Error('HTTP ' + xhr.status), parsed);
        };
        xhr.send(payloadText);
        return;
      }
    } catch (e) {}

    try {
      if (typeof fetch === 'function') {
        var init = { method: method, headers: { 'Accept': 'application/json' } };
        if (payloadText !== null) {
          init.headers['Content-Type'] = 'application/json';
          init.body = payloadText;
        }
        fetch(url, init)
          .then(function (res) {
            return res.json().then(function (json) {
              if (res.status >= 200 && res.status < 300) return json;
              var err = new Error('HTTP ' + res.status);
              err.payload = json;
              throw err;
            });
          })
          .then(function (json) { cb(null, json); })
          .catch(function (err) { cb(err, null); });
        return;
      }
    } catch (e) {}

    cb(new Error('No HTTP client available in this runtime.'), null);
  }

  function notify(header, text) {
    try {
      if (typeof UltimateLib !== 'undefined' &&
          UltimateLib &&
          UltimateLib.Notifications &&
          typeof UltimateLib.Notifications.showSimpleNotification === 'function') {
        UltimateLib.Notifications.showSimpleNotification(header, text, false);
        return;
      }
    } catch (e) {}

    try {
      if (typeof GameManager !== 'undefined' &&
          GameManager.company &&
          typeof Notification !== 'undefined') {
        GameManager.company.notifications.push(new Notification({ header: header, text: text }));
        return;
      }
    } catch (e) {}

    log(header + ': ' + text);
  }

  function createRng(seed) {
    var x = seed | 0;
    if (x === 0) x = 123456789;
    return function () {
      x ^= (x << 13);
      x ^= (x >>> 17);
      x ^= (x << 5);
      return ((x >>> 0) / 4294967296);
    };
  }

  function deriveSeed(seed, salt) {
    // Deterministic 32-bit mixing so we can add new shuffled lists over time
    // without changing existing topic/research ordering for an existing save.
    var x = ((seed >>> 0) ^ (salt >>> 0)) >>> 0;
    x = (x + 0x9e3779b9) >>> 0;
    x ^= (x << 13);
    x ^= (x >>> 17);
    x ^= (x << 5);
    return (x >>> 0);
  }

  function shuffleCopy(arr, rng) {
    var out = arr.slice();
    for (var i = out.length - 1; i > 0; i--) {
      var j = Math.floor(rng() * (i + 1));
      var tmp = out[i];
      out[i] = out[j];
      out[j] = tmp;
    }
    return out;
  }

  function snapshotTopics() {
    var list = [];
    try {
      if (typeof Topics !== 'undefined' && Topics && Topics.topics && Topics.topics.length) {
        for (var i = 0; i < Topics.topics.length; i++) {
          var t = Topics.topics[i];
          if (!t) continue;
          list.push({
            id: t.id ? String(t.id) : String(i),
            name: t.name ? String(t.name) : ''
          });
        }
      }
    } catch (e) {}
    return list;
  }

  function snapshotResearch() {
    var list = [];
    try {
      if (typeof Research !== 'undefined' && Research) {
        var items = null;
        if (typeof Research.getAllItems === 'function') {
          items = Research.getAllItems();
        }
        if (items && items.length) {
          for (var i = 0; i < items.length; i++) {
            var r = items[i];
            if (!r) continue;
            list.push({
              id: r.id ? String(r.id) : (r.name ? String(r.name) : String(i)),
              name: r.name ? String(r.name) : (r.title ? String(r.title) : '')
            });
          }
        }
      }
    } catch (e) {}
    return list;
  }

  function snapshotPlatforms() {
    var list = [];
    try {
      if (typeof Platforms !== 'undefined' && Platforms) {
        var platforms = Platforms.allPlatforms || Platforms.platforms || Platforms.all || null;
        if (platforms && platforms.length) {
          for (var i = 0; i < platforms.length; i++) {
            var p = platforms[i];
            if (!p) continue;
            list.push({
              id: p.id ? String(p.id) : String(i),
              name: p.name ? String(p.name) : ''
            });
          }
        }
      }
    } catch (e) {}
    return list;
  }

  function snapshotGenres() {
    var list = [];
    try {
      if (typeof Genres !== 'undefined' && Genres) {
        var genres = Genres.genres || Genres.allGenres || Genres.all || null;
        if (genres && genres.length) {
          for (var i = 0; i < genres.length; i++) {
            var g = genres[i];
            if (!g) continue;
            list.push({
              id: g.id ? String(g.id) : String(i),
              name: g.name ? String(g.name) : ''
            });
          }
        }
      }
    } catch (e) {}
    return list;
  }

  function snapshotThemes() {
    var list = [];
    try {
      if (typeof Themes !== 'undefined' && Themes) {
        var themes = Themes.themes || Themes.allThemes || Themes.all || null;
        if (themes && themes.length) {
          for (var i = 0; i < themes.length; i++) {
            var t = themes[i];
            if (!t) continue;
            list.push({
              id: t.id ? String(t.id) : String(i),
              name: t.name ? String(t.name) : ''
            });
          }
        }
      }
    } catch (e) {}
    return list;
  }

  function ensureRandomization(store) {
    if (!store || !store.data) return null;

    var existing = store.data.randomization;
    if (existing && existing.seed) {
      // Backfill new shuffled lists (version 2+) without mutating the old ordering.
      if (!existing.version || existing.version < 2) existing.version = 2;
      if (!existing.createdAt) existing.createdAt = new Date().toISOString();

      try {
        if (!existing.mods) existing.mods = {};
        if (existing.mods.ultimateLib === undefined) existing.mods.ultimateLib = isModInstalled('UltimateLib');
        if (existing.mods.tagMod === undefined) existing.mods.tagMod = isModInstalled('TAGMod');
        if (existing.mods.expansionPack === undefined) existing.mods.expansionPack = isModInstalled('GDTExpansionPack_Linshi');
      } catch (e) {}

      var seed = (existing.seed >>> 0);
      if (!existing.platforms) existing.platforms = shuffleCopy(snapshotPlatforms(), createRng(deriveSeed(seed, 0x11aacc33)));
      if (!existing.genres) existing.genres = shuffleCopy(snapshotGenres(), createRng(deriveSeed(seed, 0x22bbdd44)));
      if (!existing.themes) existing.themes = shuffleCopy(snapshotThemes(), createRng(deriveSeed(seed, 0x33ccee55)));

      return existing;
    }

    var seedNew = ((Date.now() & 0xffffffff) ^ Math.floor(Math.random() * 0xffffffff)) >>> 0;
    var topics = shuffleCopy(snapshotTopics(), createRng(deriveSeed(seedNew, 0x11111111)));
    var research = shuffleCopy(snapshotResearch(), createRng(deriveSeed(seedNew, 0x22222222)));
    var platforms = shuffleCopy(snapshotPlatforms(), createRng(deriveSeed(seedNew, 0x33333333)));
    var genres = shuffleCopy(snapshotGenres(), createRng(deriveSeed(seedNew, 0x44444444)));
    var themes = shuffleCopy(snapshotThemes(), createRng(deriveSeed(seedNew, 0x55555555)));

    var randomization = {
      version: 2,
      seed: seedNew,
      createdAt: new Date().toISOString(),
      topics: topics,
      research: research,
      platforms: platforms,
      genres: genres,
      themes: themes,
      mods: {
        ultimateLib: isModInstalled('UltimateLib'),
        tagMod: isModInstalled('TAGMod'),
        expansionPack: isModInstalled('GDTExpansionPack_Linshi')
      }
    };

    store.data.randomization = randomization;
    return randomization;
  }

  function ensureClientId(store) {
    if (!store || !store.data) return '';
    if (store.data.clientId) return String(store.data.clientId);
    var clientId = 'gdt-' + Math.floor(Math.random() * 0xffffffff).toString(16) + '-' + Date.now().toString(16);
    store.data.clientId = clientId;
    return clientId;
  }

  function getCompanyName() {
    try {
      var c = typeof GameManager !== 'undefined' ? GameManager.company : null;
      if (!c) return '';
      if (c.name) return String(c.name);
      if (c.companyName) return String(c.companyName);
    } catch (e) {}
    return '';
  }

  function getCharacterName() {
    try {
      var c = typeof GameManager !== 'undefined' ? GameManager.company : null;
      if (!c) return '';
      if (c.playerName) return String(c.playerName);
      if (c.characterName) return String(c.characterName);
      if (c.staff && c.staff.length && c.staff[0] && c.staff[0].name) return String(c.staff[0].name);
    } catch (e) {}
    return '';
  }

  function syncClient(store, cfg, forceRandomization) {
    if (!store) return;
    var botBaseUrl = getEffectiveBotBaseUrl(store, cfg);
    var serverId = (cfg.serverId || '').toString().trim();
    if (!serverId) {
      notify('Archipelago', 'Server is not configured. Re-run the DMS installer .bat.');
      return;
    }

    var clientId = ensureClientId(store);
    var randomization = forceRandomization ? ensureRandomization(store) : (store.data.randomization || null);
    var payload = {
      serverId: serverId,
      clientId: clientId,
      companyName: getCompanyName(),
      characterName: getCharacterName(),
      archipelagoMode: !!store.data.archipelagoMode,
      randomization: randomization
    };

    var url = botBaseUrl + '/api/archipelago/gdt/client/sync';
    httpRequestJson('POST', url, payload, function (err, json) {
      if (err) {
        notify('Archipelago', 'Sync failed: ' + (err.message ? err.message : err));
        return;
      }
      if (!json || json.ok !== true) {
        notify('Archipelago', 'Sync failed (bad response).');
        return;
      }
      if (json.items && json.items.length) {
        handleItems(store, json.items);
      }
    });
  }

  function pollItems(store, cfg) {
    if (!store) return;
    var botBaseUrl = getEffectiveBotBaseUrl(store, cfg);
    var serverId = (cfg.serverId || '').toString().trim();
    if (!serverId) return;
    var clientId = ensureClientId(store);
    var url = botBaseUrl + '/api/archipelago/gdt/client/items?serverId=' + encodeURIComponent(serverId) + '&clientId=' + encodeURIComponent(clientId);
    httpRequestJson('GET', url, null, function (err, json) {
      if (err) return;
      if (!json || json.ok !== true) return;
      if (json.items && json.items.length) {
        handleItems(store, json.items);
      }
    });
  }

  // ----------------------------
  // Item delivery + effects
  //
  // The DMS bot delivers items as { id, key, payload }.
  // - "key" is typically the AP item name (string).
  // - "payload" is optional extra JSON (object/string) for future flexibility.
  //
  // This handler is intentionally defensive: the AP/bot integration will evolve,
  // but the mod should keep working even as payload shapes change.
  // ----------------------------

  function ensureProcessedMap(store) {
    if (!store || !store.data) return null;
    if (!store.data.processedItemIds || typeof store.data.processedItemIds !== 'object') {
      store.data.processedItemIds = {};
    }
    return store.data.processedItemIds;
  }

  function normalizeToken(text) {
    return String(text || '')
      .trim()
      .toLowerCase()
      .replace(/[\s_-]+/g, ' ')
      .replace(/[^\w\s:]/g, '');
  }

  function safeCompany() {
    try {
      return (typeof GameManager !== 'undefined') ? GameManager.company : null;
    } catch (e) {
      return null;
    }
  }

  function getAllTopics() {
    try {
      if (typeof Topics !== 'undefined' && Topics && Topics.topics && Topics.topics.length) {
        return Topics.topics;
      }
    } catch (e) {}
    return [];
  }

  function findTopicByIdOrName(idOrName) {
    var needle = String(idOrName || '').trim();
    if (!needle) return null;
    var needleLower = needle.toLowerCase();
    var topics = getAllTopics();
    for (var i = 0; i < topics.length; i++) {
      var t = topics[i];
      if (!t) continue;
      var tid = (t.id !== undefined && t.id !== null) ? String(t.id) : '';
      var tname = t.name ? String(t.name) : '';
      if (tid && tid.toLowerCase() === needleLower) return t;
      if (tname && tname.toLowerCase() === needleLower) return t;
    }
    return null;
  }

  function companyHasTopic(company, topic) {
    try {
      if (!company || !topic) return false;
      var list = company.topics;
      if (!list || !list.length) return false;
      for (var i = 0; i < list.length; i++) {
        var t = list[i];
        if (!t) continue;
        // Some mods (or older saves) store topic unlocks as plain strings instead of objects.
        if (typeof t === 'string') {
          var token = t.toLowerCase();
          if (topic.id !== undefined && topic.id !== null && String(topic.id).toLowerCase() === token) return true;
          if (topic.name && String(topic.name).toLowerCase() === token) return true;
          continue;
        }
        if (t === topic) return true;
        if (t.id !== undefined && topic.id !== undefined &&
            String(t.id).toLowerCase() === String(topic.id).toLowerCase()) return true;
        if (t.name && topic.name &&
            String(t.name).toLowerCase() === String(topic.name).toLowerCase()) return true;
      }
    } catch (e) {}
    return false;
  }

  function unlockTopic(company, topic) {
    if (!company || !topic) return false;
    try {
      if (!company.topics) company.topics = [];
      if (companyHasTopic(company, topic)) return false;
      // Prefer the game's helper if it exists (may trigger UI/state updates), otherwise push into the unlocked list.
      if (typeof company.unlockTopic === 'function') {
        try {
          company.unlockTopic(topic);
          return true;
        } catch (e) {}
      }
      company.topics.push(topic);
      return true;
    } catch (e) {
      return false;
    }
  }

  function getAllResearchItems() {
    try {
      if (typeof Research !== 'undefined' && Research && typeof Research.getAllItems === 'function') {
        var items = Research.getAllItems();
        return items && items.length ? items : [];
      }
    } catch (e) {}
    return [];
  }

  function findResearchByIdOrName(idOrName) {
    var needle = String(idOrName || '').trim();
    if (!needle) return null;
    var needleLower = needle.toLowerCase();
    var items = getAllResearchItems();
    for (var i = 0; i < items.length; i++) {
      var r = items[i];
      if (!r) continue;
      var rid = (r.id !== undefined && r.id !== null) ? String(r.id) : '';
      var rname = r.name ? String(r.name) : (r.title ? String(r.title) : '');
      if (rid && rid.toLowerCase() === needleLower) return r;
      if (rname && rname.toLowerCase() === needleLower) return r;
    }
    return null;
  }

  function companyHasResearch(company, research) {
    try {
      if (!company || !research) return false;
      var list = company.researchCompleted;
      if (!list || !list.length) return false;
      var rid = (research.id !== undefined && research.id !== null) ? String(research.id).toLowerCase() : '';
      var rname = research.name ? String(research.name).toLowerCase() : (research.title ? String(research.title).toLowerCase() : '');
      for (var i = 0; i < list.length; i++) {
        var entry = list[i];
        if (!entry) continue;
        // Some mods accidentally push arrays; handle that gracefully.
        if (entry.length && typeof entry !== 'string') {
          for (var j = 0; j < entry.length; j++) {
            if (companyHasResearch({ researchCompleted: [entry[j]] }, research)) return true;
          }
          continue;
        }
        if (entry === research) return true;
        var eid = (entry.id !== undefined && entry.id !== null) ? String(entry.id).toLowerCase() : '';
        var ename = entry.name ? String(entry.name).toLowerCase() : (entry.title ? String(entry.title).toLowerCase() : '');
        if (rid && eid && rid === eid) return true;
        if (rname && ename && rname === ename) return true;
        if (typeof entry === 'string') {
          if (rid && entry.toLowerCase() === rid) return true;
          if (rname && entry.toLowerCase() === rname) return true;
        }
      }
    } catch (e) {}
    return false;
  }

  function completeResearch(company, research) {
    if (!company || !research) return false;
    try {
      if (!company.researchCompleted) company.researchCompleted = [];
      if (companyHasResearch(company, research)) return false;
      // Prefer storing the research ID string, since save serialization may not preserve functions on objects.
      var token = '';
      if (research.id !== undefined && research.id !== null) token = String(research.id);
      if (!token) token = research.name ? String(research.name) : (research.title ? String(research.title) : '');
      company.researchCompleted.push(token || research);
      return true;
    } catch (e) {
      return false;
    }
  }

  function peekNextTopicFromRandomization(store, company) {
    if (!store || !store.data || !company) return null;
    var rand = store.data.randomization;
    var list = rand && rand.topics && rand.topics.length ? rand.topics : [];
    if (!list.length) return null;
    for (var i = 0; i < list.length; i++) {
      var entry = list[i];
      if (!entry) continue;
      var t = findTopicByIdOrName(entry.id || entry.name);
      if (!t) continue;
      if (companyHasTopic(company, t)) continue;
      return t;
    }
    return null;
  }

  function peekNextResearchFromRandomization(store, company) {
    if (!store || !store.data || !company) return null;
    var rand = store.data.randomization;
    var list = rand && rand.research && rand.research.length ? rand.research : [];
    if (!list.length) return null;
    for (var i = 0; i < list.length; i++) {
      var entry = list[i];
      if (!entry) continue;
      var r = findResearchByIdOrName(entry.id || entry.name);
      if (!r) continue;
      if (companyHasResearch(company, r)) continue;
      return r;
    }
    return null;
  }

  function unlockNextTopicFromRandomization(store, company) {
    if (!store || !store.data || !company) return null;
    var rand = store.data.randomization;
    var list = rand && rand.topics && rand.topics.length ? rand.topics : [];
    if (!list.length) return null;
    for (var i = 0; i < list.length; i++) {
      var entry = list[i];
      if (!entry) continue;
      var t = findTopicByIdOrName(entry.id || entry.name);
      if (!t) continue;
      if (companyHasTopic(company, t)) continue;
      if (unlockTopic(company, t)) {
        return t;
      }
    }
    return null;
  }

  function unlockNextResearchFromRandomization(store, company) {
    if (!store || !store.data || !company) return null;
    var rand = store.data.randomization;
    var list = rand && rand.research && rand.research.length ? rand.research : [];
    if (!list.length) return null;
    for (var i = 0; i < list.length; i++) {
      var entry = list[i];
      if (!entry) continue;
      var r = findResearchByIdOrName(entry.id || entry.name);
      if (!r) continue;
      if (companyHasResearch(company, r)) continue;
      if (completeResearch(company, r)) {
        return r;
      }
    }
    return null;
  }

  function adjustCash(company, amount) {
    var delta = Number(amount) || 0;
    if (!company || !delta) return false;
    try {
      if (typeof company.adjustCash === 'function') {
        company.adjustCash(delta, 'Archipelago');
      } else if (typeof company.cash === 'number') {
        company.cash += delta;
      } else {
        company.cash = (Number(company.cash) || 0) + delta;
      }
      return true;
    } catch (e) {
      return false;
    }
  }

  function adjustFans(company, amount) {
    var delta = Number(amount) || 0;
    if (!company || !delta) return false;
    try {
      if (typeof company.fans === 'number') {
        company.fans += delta;
      } else {
        company.fans = (Number(company.fans) || 0) + delta;
      }
      return true;
    } catch (e) {
      return false;
    }
  }

  function adjustResearchPoints(company, amount) {
    var delta = Number(amount) || 0;
    if (!company || !delta) return false;
    try {
      if (typeof company.researchPoints === 'number') {
        company.researchPoints += delta;
      } else {
        company.researchPoints = (Number(company.researchPoints) || 0) + delta;
      }
      return true;
    } catch (e) {
      return false;
    }
  }

  function adjustHype(company, amount) {
    var delta = Number(amount) || 0;
    if (!company || !delta) return false;
    try {
      if (typeof company.adjustHype === 'function') {
        company.adjustHype(delta);
        return true;
      }
    } catch (e) {}
    try {
      if (typeof company.hype === 'number') {
        company.hype += delta;
        return true;
      }
      if (typeof company.currentHype === 'number') {
        company.currentHype += delta;
        return true;
      }
    } catch (e2) {}
    return false;
  }

  function parseAmountFromKey(key) {
    var text = String(key || '');
    var match = text.match(/(-?\d+(?:\.\d+)?)\s*([kKmMbB])?/);
    if (!match) return 0;
    var num = Number(match[1]);
    if (!isFinite(num)) return 0;
    var suf = (match[2] || '').toLowerCase();
    if (suf === 'k') num *= 1000;
    if (suf === 'm') num *= 1000000;
    if (suf === 'b') num *= 1000000000;
    return Math.floor(num);
  }

  function handleItems(store, items) {
    if (!store || !items || !items.length) return;
    var processed = ensureProcessedMap(store);
    var company = safeCompany();
    if (!company) return;

    for (var i = 0; i < items.length; i++) {
      var item = items[i];
      if (!item) continue;

      var id = (item.id !== undefined && item.id !== null) ? String(item.id) : '';
      if (!id) {
        // Fallback ID for non-DB senders.
        var payloadText = '';
        try {
          payloadText = JSON.stringify(item.payload || '');
        } catch (e) {
          payloadText = String(item.payload || '');
        }
        id = normalizeToken(item.key || 'item') + ':' + normalizeToken(payloadText);
      }
      if (processed && processed[id]) {
        continue;
      }
      if (processed) processed[id] = true;

      var keyRaw = String(item.key || '').trim();
      var key = normalizeToken(keyRaw);
      var payload = (item.payload !== undefined && item.payload !== null) ? item.payload : null;

      // Allow bot/AP integration to specify explicit effect types via payload.
      var payloadType = '';
      if (payload && typeof payload === 'object') {
        payloadType = normalizeToken(payload.type || payload.kind || payload.action || '');
      }

      var handled = false;

      // Unlock Topic
      if (payloadType === 'unlock topic' || payloadType === 'topic unlock' || payloadType === 'topic') {
        var targetTopic = findTopicByIdOrName(payload.topicId || payload.topic || payload.id || payload.name);
        if (targetTopic && unlockTopic(company, targetTopic)) {
          notify('Archipelago', 'Unlocked Topic: ' + (targetTopic.name || targetTopic.id || 'Topic'));
        } else {
          var nextTopic = unlockNextTopicFromRandomization(store, company);
          notify('Archipelago', nextTopic ? ('Unlocked Topic: ' + (nextTopic.name || nextTopic.id)) : 'No locked topics remaining.');
        }
        handled = true;
      }
      if (!handled && (key === 'unlock topic' || key === 'topic unlock' || key === 'unlock topics' || key === 'topic unlocks')) {
        var topic2 = unlockNextTopicFromRandomization(store, company);
        notify('Archipelago', topic2 ? ('Unlocked Topic: ' + (topic2.name || topic2.id)) : 'No locked topics remaining.');
        handled = true;
      }

      // Unlock Research
      if (!handled && (payloadType === 'unlock research' || payloadType === 'research unlock' || payloadType === 'research')) {
        var targetResearch = findResearchByIdOrName(payload.researchId || payload.research || payload.id || payload.name);
        if (targetResearch && completeResearch(company, targetResearch)) {
          notify('Archipelago', 'Completed Research: ' + (targetResearch.name || targetResearch.title || targetResearch.id || 'Research'));
        } else {
          var nextResearch = unlockNextResearchFromRandomization(store, company);
          notify('Archipelago', nextResearch ? ('Completed Research: ' + (nextResearch.name || nextResearch.title || nextResearch.id)) : 'No incomplete research remaining.');
        }
        handled = true;
      }
      if (!handled && (key === 'unlock research' || key === 'research unlock' || key === 'unlock researches' || key === 'research unlocks')) {
        var r2 = unlockNextResearchFromRandomization(store, company);
        notify('Archipelago', r2 ? ('Completed Research: ' + (r2.name || r2.title || r2.id)) : 'No incomplete research remaining.');
        handled = true;
      }

      // Cash / Fans (filler-style boosts)
      if (!handled && (payloadType === 'cash' || payloadType === 'money')) {
        var amt = payload.amount !== undefined ? payload.amount : payload.value;
        if (!amt) amt = parseAmountFromKey(keyRaw);
        if (adjustCash(company, amt)) {
          notify('Archipelago', 'Cash +' + amt);
        }
        handled = true;
      }
      if (!handled && key.indexOf('cash') === 0) {
        var cash = 0;
        if (payload && typeof payload === 'object' && (payload.amount || payload.value)) {
          cash = Number(payload.amount || payload.value) || 0;
        }
        if (!cash) cash = parseAmountFromKey(keyRaw);
        if (adjustCash(company, cash)) {
          notify('Archipelago', 'Cash +' + cash);
        }
        handled = true;
      }

      if (!handled && (payloadType === 'fans')) {
        var fansAmt = payload.amount !== undefined ? payload.amount : payload.value;
        if (!fansAmt) fansAmt = parseAmountFromKey(keyRaw);
        if (adjustFans(company, fansAmt)) {
          notify('Archipelago', 'Fans +' + fansAmt);
        }
        handled = true;
      }
      if (!handled && key.indexOf('fans') === 0) {
        var fans = 0;
        if (payload && typeof payload === 'object' && (payload.amount || payload.value)) {
          fans = Number(payload.amount || payload.value) || 0;
        }
        if (!fans) fans = parseAmountFromKey(keyRaw);
        if (adjustFans(company, fans)) {
          notify('Archipelago', 'Fans +' + fans);
        }
        handled = true;
      }

      // Research Points
      if (!handled && (payloadType === 'research points' || payloadType === 'research point' || payloadType === 'rp')) {
        var rpAmt = payload.amount !== undefined ? payload.amount : payload.value;
        if (!rpAmt) rpAmt = parseAmountFromKey(keyRaw);
        if (adjustResearchPoints(company, rpAmt)) {
          notify('Archipelago', 'Research Points +' + rpAmt);
        }
        handled = true;
      }
      if (!handled && (key.indexOf('research points') === 0 || key === 'rp' || key.indexOf('rp ') === 0)) {
        var rp = 0;
        if (payload && typeof payload === 'object' && (payload.amount || payload.value)) {
          rp = Number(payload.amount || payload.value) || 0;
        }
        if (!rp) rp = parseAmountFromKey(keyRaw);
        if (adjustResearchPoints(company, rp)) {
          notify('Archipelago', 'Research Points +' + rp);
        }
        handled = true;
      }

      // Hype
      if (!handled && (payloadType === 'hype')) {
        var hypeAmt = payload.amount !== undefined ? payload.amount : payload.value;
        if (!hypeAmt) hypeAmt = parseAmountFromKey(keyRaw);
        if (adjustHype(company, hypeAmt)) {
          notify('Archipelago', 'Hype +' + hypeAmt);
        }
        handled = true;
      }
      if (!handled && key.indexOf('hype') === 0) {
        var hype = 0;
        if (payload && typeof payload === 'object' && (payload.amount || payload.value)) {
          hype = Number(payload.amount || payload.value) || 0;
        }
        if (!hype) hype = parseAmountFromKey(keyRaw);
        if (adjustHype(company, hype)) {
          notify('Archipelago', 'Hype +' + hype);
        }
        handled = true;
      }

      if (!handled) {
        // Unknown items are still surfaced to the player.
        var label = '';
        if (payload && typeof payload === 'object') {
          label = payload.name || payload.item || payload.title || '';
        }
        if (!label) label = keyRaw || 'Item';
        notify('Archipelago', 'Received: ' + label);
      }
    }
  }

  function ensureSettingsTab(store, cfg) {
    if (!hasJquery()) return;
    if (typeof GDT === 'undefined' || typeof GDT.addSettingsTab !== 'function') return;

    try {
      if (window.__dmsArchipelagoSettingsAdded) return;
      window.__dmsArchipelagoSettingsAdded = true;

      var hasTag = isModInstalled('TAGMod');
      var $root = $('<div class="dms-ap-settings"></div>');
      if (hasTag) {
        $root.addClass('tm-settings-tab');
      }

      $root.append('<h2>DMS Archipelago</h2>');

      var botBaseUrl = getEffectiveBotBaseUrl(store, cfg);
      var serverId = (cfg.serverId || '').toString().trim();

      $root.append('<h3>Bot URL</h3>');
      var $botInput = $('<input type="text" style="width: 95%;" />');
      $botInput.val(botBaseUrl);
      $botInput.on('change', function () {
        store.settings.botBaseUrlOverride = normalizeBaseUrl($botInput.val());
        try { DataStore.saveSettings(); } catch (e) {}
        notify('Archipelago', 'Bot URL saved.');
      });
      $root.append($botInput);

      $root.append('<h3>Server ID</h3>');
      $root.append('<div style="margin-bottom: 10px;">' + (serverId ? serverId : '(not configured)') + '</div>');

      $root.append('<h3>Randomization</h3>');
      var $randInfo = $('<div class="dms-ap-rand" style="margin-bottom: 10px;"></div>');
      var $randNext = $('<div class="dms-ap-rand-next" style="margin-bottom: 10px;"></div>');
      $root.append($randInfo).append($randNext);

      var $status = $('<div class="dms-ap-status" style="margin-top: 10px;"></div>');
      $root.append($status);

      function refreshRandomizationPreview() {
        try {
          var rand = store && store.data ? store.data.randomization : null;
          if (!rand || !rand.seed) {
            $randInfo.text('Not generated yet. Start a new save with Archipelago Mode enabled to create a seed.');
            $randNext.text('');
            return;
          }

          var mods = rand.mods || {};
          var parts = [];
          parts.push('Seed: ' + rand.seed);
          if (rand.version) parts.push('v' + rand.version);
          if (mods.tagMod) parts.push('TAG UI');
          if (mods.expansionPack) parts.push('Expansion Pack');
          $randInfo.text(parts.join(' • '));

          var company = safeCompany();
          if (!company) {
            $randNext.text('');
            return;
          }

          var nextTopic = peekNextTopicFromRandomization(store, company);
          var nextResearch = peekNextResearchFromRandomization(store, company);
          var nextText = '';
          if (nextTopic) nextText += 'Next Topic: ' + (nextTopic.name || nextTopic.id);
          if (nextResearch) nextText += (nextText ? ' | ' : '') + 'Next Research: ' + (nextResearch.name || nextResearch.title || nextResearch.id);
          $randNext.text(nextText);
        } catch (e) {
          $randInfo.text('Randomization preview unavailable.');
          $randNext.text('');
        }
      }

      function refreshStatus() {
        if (!serverId) {
          $status.text('Server is not configured.');
          return;
        }
        var url = getEffectiveBotBaseUrl(store, cfg) + '/api/archipelago/gdt/status?server=' + encodeURIComponent(serverId);
        httpRequestJson('GET', url, null, function (err, json) {
          if (err || !json || json.ok !== true) {
            $status.text('Status: unavailable');
            return;
          }
          $status.text('Status: ' + (json.linked ? 'linked to Discord' : 'not linked'));
        });
      }

      var $btnRow = $('<div style="margin-top: 10px;"></div>');
      var $testBtn = $('<button type="button">Test Connection</button>');
      $testBtn.on('click', function () {
        var url = getEffectiveBotBaseUrl(store, cfg) + '/health';
        httpRequestJson('GET', url, null, function (err, json) {
          if (err || !json || json.ok !== true) {
            notify('Archipelago', 'Bot health check failed.');
            return;
          }
           notify('Archipelago', 'Connected to DMS bot.');
           refreshStatus();
           refreshRandomizationPreview();
         });
       });
      var $refreshBtn = $('<button type="button" style="margin-left: 8px;">Refresh Status</button>');
      $refreshBtn.on('click', function () {
        refreshStatus();
        refreshRandomizationPreview();
      });
      $btnRow.append($testBtn).append($refreshBtn);
      $root.append($btnRow);

      GDT.addSettingsTab('Archipelago', $root);
      refreshStatus();
      refreshRandomizationPreview();
    } catch (e) {
      log('Failed to register settings tab: ' + (e && e.message ? e.message : e));
    }
  }

  function ensureAdvancedOption(store) {
    if (!hasJquery()) return;
    if (window.__dmsArchipelagoAdvancedAdded) return;

    var $panel = $('#newGameView').find('.featureSelectionPanel.featureSelectionPanelHiddenState');
    if (!$panel.length) return;

    window.__dmsArchipelagoAdvancedAdded = true;

    var hasTag = isModInstalled('TAGMod');
    var $wrap = $('<div id="dms-ap-advanced-option" style="margin-top: 10px;"></div>');
    if (hasTag) {
      $wrap.addClass('tm-settings-tab');
    }

    $wrap.append('<h3>Archipelago Mode</h3>');
    $wrap.append('<div style="margin-bottom: 6px;">Enable Archipelago integration for this save.</div>');

    var $select = $('<select><option value="off">Off</option><option value="on">On</option></select>');
    $select.val(pendingArchipelagoMode ? 'on' : 'off');
    $select.on('change', function () {
      pendingArchipelagoMode = ($select.val() === 'on');
      notify('Archipelago', 'Archipelago Mode: ' + (pendingArchipelagoMode ? 'On' : 'Off'));
    });
    $wrap.append($select);

    try {
      if (typeof UltimateLib !== 'undefined' &&
          UltimateLib &&
          UltimateLib.Configuration &&
          typeof UltimateLib.Configuration.addAdvancedOption === 'function') {
        UltimateLib.Configuration.addAdvancedOption($wrap);
        return;
      }
    } catch (e) {}

    $panel.append($wrap);
  }

  function ensureSessionStarted(store, cfg) {
    if (!store || !store.data) return;
    if (typeof store.data.archipelagoMode !== 'boolean') {
      // Only apply the toggle to new saves; default off for loaded/legacy saves.
      store.data.archipelagoMode = (lastSaveEvent === 'newGame') ? !!pendingArchipelagoMode : false;
    }

    if (!store.data.archipelagoMode) {
      if (pollTimer) {
        clearInterval(pollTimer);
        pollTimer = null;
      }
      return;
    }

    // Wait until the company setup wizard is complete (names set) before syncing to the bot.
    var companyName = getCompanyName();
    var characterName = getCharacterName();
    if (!companyName || !characterName) {
      if (!store.data.__dmsApWaitingForNamesNotified) {
        store.data.__dmsApWaitingForNamesNotified = true;
        notify('Archipelago', 'Waiting for company + character name to start Archipelago.');
      }
      return;
    }

    if (!store.data.sessionStarted) {
      store.data.sessionStarted = true;
      store.data.__dmsApWaitingForNamesNotified = false;
      notify('Archipelago', 'Archipelago Mode enabled.');
      ensureRandomization(store);
      syncClient(store, cfg, true);
    }

    var interval = POLL_ITEMS_INTERVAL_MS;
    if (store.settings && store.settings.pollIntervalMs) {
      interval = Number(store.settings.pollIntervalMs) || interval;
    }
    if (!pollTimer) {
      pollTimer = setInterval(function () {
        pollItems(store, cfg);
      }, interval);
      pollItems(store, cfg);
    }
  }

  function onTick(store, cfg) {
    try {
      var company = (typeof GameManager !== 'undefined') ? GameManager.company : null;
      if (!company) {
        lastCompany = null;
        if (pollTimer) {
          clearInterval(pollTimer);
          pollTimer = null;
        }
        return;
      }

      if (company !== lastCompany) {
        lastCompany = company;
      }
      ensureSessionStarted(store, cfg);
    } catch (e) {}
  }

  function init() {
    var store = getDataStore();
    ensureStoreDefaults(store);
    var cfg = readConfigFile();

    log('Loaded.');
    log('UltimateLib=' + (isModInstalled('UltimateLib') ? 'yes' : 'no') +
        ' TAGMod=' + (isModInstalled('TAGMod') ? 'yes' : 'no'));

    if (!isModInstalled('UltimateLib')) {
      notify('Archipelago', 'UltimateLib is required but not installed.');
      return;
    }

    if (typeof GDT !== 'undefined' && GDT.on && GDT.eventKeys) {
      try {
        GDT.on(GDT.eventKeys.mod.loaded, function () {
          ensureSettingsTab(store, cfg);
        });
      } catch (e) {}
      try {
        if (GDT.eventKeys.saves && GDT.eventKeys.saves.newGame) {
          GDT.on(GDT.eventKeys.saves.newGame, function () {
            lastSaveEvent = 'newGame';
            // Persist the new-game toggle into save data (per-save).
            try {
              if (store && store.data) {
                store.data.archipelagoMode = !!pendingArchipelagoMode;
              }
            } catch (e) {}

            lastCompany = null;
            if (pollTimer) {
              clearInterval(pollTimer);
              pollTimer = null;
            }
          });
        }
      } catch (e) {}
      try {
        if (GDT.eventKeys.saves && GDT.eventKeys.saves.loading) {
          GDT.on(GDT.eventKeys.saves.loading, function () {
            lastSaveEvent = 'loading';
            // Save was loaded; session will attach on tick.
            lastCompany = null;
            if (pollTimer) {
              clearInterval(pollTimer);
              pollTimer = null;
            }
          });
        }
      } catch (e) {}
    }

    // Heartbeat: keep the new-game toggle injected and start sessions as soon as the save is ready.
    if (!heartbeatTimer) {
      heartbeatTimer = setInterval(function () {
        ensureAdvancedOption(store);
        onTick(store, cfg);
      }, 1000);
    }
  }

  init();
})();
