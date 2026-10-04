(function () {
  'use strict';
  try {
    var fs = require('fs');
    var path = require('path');
    var crypto = require('crypto');
    var root = path.dirname(process.execPath);
    var config = JSON.parse(fs.readFileSync(path.join(root, 'qa', 'smoke-profile.json'), 'utf8'));
    if (config.schemaVersion !== 1 || !/^smoke-[ab]$/.test(config.profileId)) throw new Error('Invalid smoke profile');
    var hash = crypto.createHash('sha256').update(fs.readFileSync(path.join(root, 'compressed', 'codeNw.js'))).digest('hex');
    if (hash !== 'c81025a66a8099e30e4f9261b52e496d253e4a7843a90d263f8bacbfd873a85b') throw new Error('Installed game build is not the reviewed smoke target');
    var native = require(path.join(root, 'steamIntegration', 'greenworks-win'));
    var storage = require(path.join(root, 'qa', 'smoke-storage.js'));
    window.__dmsSmokeIsolation = storage.install(native, {
      profileId: config.profileId, gameRoot: root, saveDirectory: config.saveDirectory
    });
    // These are staged profile settings, never the normal game's enabled mods.
    window.localStorage.setItem('enabledMods', JSON.stringify(['gdt-modAPI', 'DMSArchipelago']));
    document.write('<script src="./compressed/codeNw.js"><\/script>');
    document.write('<script src="./js/GDT.js"><\/script>');
    document.write('<script src="./js/modSupport.js"><\/script>');
  } catch (error) {
    window.__dmsSmokeIsolation = { isolated: false, error: String(error.message || error) };
    document.write('<div id="dms-smoke-isolation-failure" style="color:white;background:#401515;padding:24px">DMS smoke launch stopped: local save isolation could not be verified. The game has not started.</div>');
  }
}());
