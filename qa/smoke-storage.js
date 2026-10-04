'use strict';

// Local QA adapter. It does not call the original Steam storage/achievement APIs.
exports.install = function (native, config, dependencies) {
  dependencies = dependencies || {};
  var fs = dependencies.fs || require('fs');
  var path = dependencies.path || require('path');
  if (!config || !/^smoke-[ab]$/.test(config.profileId)) throw new Error('Unsupported smoke profile');
  var root = path.resolve(config.gameRoot);
  var saveDirectory = path.resolve(config.saveDirectory);
  var expected = path.join(path.dirname(root), 'saves');
  if (path.basename(root) !== 'game' || saveDirectory !== expected) throw new Error('Smoke saves must stay in the staged instance sibling saves directory');
  if (!native || typeof native.saveTextToFile !== 'function' || typeof native.readTextFromFile !== 'function'
      || typeof native.activateAchievement !== 'function') throw new Error('Installed Steam API shape changed');
  if (!fs.existsSync(saveDirectory)) fs.mkdirSync(saveDirectory);
  if (fs.realpathSync(saveDirectory) !== saveDirectory || fs.lstatSync(saveDirectory).isSymbolicLink()) {
    throw new Error('Smoke save directory must not be redirected');
  }
  var stats = { profileId: config.profileId, isolated: false, reads: 0, writes: 0, achievementsSuppressed: 0 };
  function fileFor(name) {
    if (!/^(general|slot_(?:auto|[1-5])|dms_isolation_probe)$/.test(String(name))) throw new Error('Unexpected smoke storage key');
    var file = path.join(saveDirectory, String(name) + '.json');
    if (fs.existsSync(file) && (fs.lstatSync(file).isSymbolicLink() || fs.realpathSync(file) !== file)) throw new Error('Smoke save file must not be redirected');
    return file;
  }
  function save(name, text, success, failure) {
    try {
      if (typeof text !== 'string' || Buffer.byteLength(text, 'utf8') > 16 * 1024 * 1024) throw new Error('Invalid smoke save');
      var file = fileFor(name);
      var temp = file + '.pending';
      if (fs.existsSync(temp) && fs.lstatSync(temp).isSymbolicLink()) throw new Error('Smoke temporary save must not be redirected');
      fs.writeFileSync(temp, text, { encoding: 'utf8', mode: 384 });
      fs.renameSync(temp, file);
      stats.writes += 1;
      if (typeof success === 'function') success();
    } catch (error) { if (typeof failure === 'function') failure(error); else throw error; }
  }
  function read(name, success, failure) {
    try {
      var text = fs.readFileSync(fileFor(name), 'utf8');
      stats.reads += 1;
      if (typeof success === 'function') success(text);
    } catch (error) { if (typeof failure === 'function') failure(error); else throw error; }
  }
  function achievement(name, success) {
    stats.achievementsSuppressed += 1;
    if (typeof success === 'function') success();
  }
  native.saveTextToFile = save;
  native.readTextFromFile = read;
  native.activateAchievement = achievement;
  if (native.saveTextToFile !== save || native.readTextFromFile !== read || native.activateAchievement !== achievement) {
    throw new Error('Steam API isolation hooks could not be installed');
  }
  var probe = JSON.stringify({ schemaVersion: 1, profileId: config.profileId });
  save('dms_isolation_probe', probe);
  var restored;
  read('dms_isolation_probe', function (value) { restored = value; });
  if (restored !== probe) throw new Error('Smoke storage sentinel failed');
  stats.isolated = true;
  return stats;
};
