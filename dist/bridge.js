(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.DMSGDTBridge = factory();
}(this, function () {
  'use strict';

  function normalizeBaseUrl(value) {
    var text = String(value || '').trim().replace(/\/+$/, '');
    var match = /^http:\/\/127\.0\.0\.1:([0-9]{1,5})$/.exec(text);
    if (!match || Number(match[1]) < 1 || Number(match[1]) > 65535) {
      throw new Error('AMZ Hub bridge must use an explicit 127.0.0.1 loopback port');
    }
    return text;
  }

  function request(config, method, route, body, callback, dependencies) {
    dependencies = dependencies || {};
    var http = dependencies.http || require('http');
    var buffer = dependencies.Buffer || Buffer;
    var completed = false;
    function finish(error, json) {
      if (completed) return;
      completed = true;
      callback(error, json);
    }
    var base;
    try {
      base = normalizeBaseUrl(config.bridgeBaseUrl);
      if (!/^\/api\/archipelago\/gdt\/client\/(sync|poll|items\/ack|progress)$/.test(route)) throw new Error('Unsupported bridge route');
      if (!config.sessionToken || /[\r\n]/.test(config.sessionToken)) throw new Error('Bridge session is missing');
    } catch (error) { finish(error); return; }
    var payload = JSON.stringify(body || {});
    var req = http.request({
      hostname: '127.0.0.1', port: Number(base.slice(base.lastIndexOf(':') + 1)),
      path: route, method: method,
      headers: { 'Accept': 'application/json', 'Content-Type': 'application/json',
        'Content-Length': buffer.byteLength(payload, 'utf8'), 'Authorization': 'Bearer ' + config.sessionToken }
    }, function (res) {
      var chunks = [];
      var size = 0;
      res.on('data', function (chunk) {
        size += chunk.length;
        if (size > 2 * 1024 * 1024) { req.abort(); finish(new Error('Bridge response exceeded limit')); return; }
        chunks.push(chunk);
      });
      res.on('error', function () { finish(new Error('Bridge response interrupted')); });
      res.on('end', function () {
        if (res.statusCode < 200 || res.statusCode >= 300) { finish(new Error('Bridge request failed with HTTP ' + res.statusCode)); return; }
        try { finish(null, JSON.parse(buffer.concat(chunks).toString('utf8'))); }
        catch (error) { finish(new Error('Bridge response is not valid JSON')); }
      });
    });
    req.setTimeout(15000, function () { req.abort(); finish(new Error('Bridge request timed out')); });
    req.on('error', function () { finish(new Error('AMZ Hub bridge is unavailable')); });
    req.end(payload);
  }

  return { normalizeBaseUrl: normalizeBaseUrl, request: request };
}));
