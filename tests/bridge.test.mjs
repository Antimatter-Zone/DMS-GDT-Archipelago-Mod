import assert from 'node:assert/strict';
import http from 'node:http';
import { createRequire } from 'node:module';
import test from 'node:test';
const Bridge = createRequire(import.meta.url)('../dist/bridge.js');

test('loopback transport rejects remote, ambiguous and credential-bearing origins', () => {
  for (const url of ['https://example.com', 'http://localhost:8080', 'http://127.0.0.1:0', 'http://127.0.0.1:65536', 'http://127.0.0.1:8/path', 'http://user@127.0.0.1:8']) {
    assert.throws(() => Bridge.normalizeBaseUrl(url), /loopback/);
  }
  assert.equal(Bridge.normalizeBaseUrl('http://127.0.0.1:39000/'), 'http://127.0.0.1:39000');
});

test('native HTTP transports auth and indexed items without browser CORS', async () => {
  const server = http.createServer((req, res) => {
    assert.equal(req.headers.authorization, 'Bearer unit-bridge-only');
    assert.equal(req.url, '/api/archipelago/gdt/client/poll');
    let body = '';
    req.on('data', (data) => { body += data; });
    req.on('end', () => {
      assert.equal(JSON.parse(body).nextItemIndex, 2);
      res.end(JSON.stringify({ ok: true, items: [{ index: 2, name: 'Unlock Topic' }] }));
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const result = await new Promise((resolve, reject) => Bridge.request({ bridgeBaseUrl: `http://127.0.0.1:${server.address().port}`, sessionToken: 'unit-bridge-only' }, 'POST', '/api/archipelago/gdt/client/poll', { nextItemIndex: 2 }, (error, json) => error ? reject(error) : resolve(json)));
    assert.equal(result.items[0].index, 2);
  } finally { await new Promise((resolve) => server.close(resolve)); }
});
