import test from 'node:test';
import assert from 'node:assert/strict';
import {startBroker} from '../src/broker.mjs';
import {BASE_URL} from '../src/oauth.mjs';

test('real loopback broker limits model/origin/path and forwards a streamed tool call safely', async () => {
  let dispatches = 0;
  const broker = await startBroker({store: {accessToken: async () => 'synthetic-reusable'}, model: {id: 'pro'}, fetcher: async (url, options) => {
    dispatches++; assert.equal(url, `${BASE_URL}/chat/completions`); assert.equal(options.redirect, 'error');
    assert.equal(options.headers.Authorization, 'Bearer synthetic-reusable');
    return new Response('data: {"model":"pro","choices":[{"delta":{"tool_calls":[{"id":"call_public"}]}}]}\n\ndata: [DONE]\n\n', {headers: {'Content-Type': 'text/event-stream', 'x-not-public': 'synthetic-detail'}});
  }});
  try {
    const headers = {Authorization: `Bearer ${broker.capability}`, 'Content-Type': 'application/json'};
    assert.equal((await fetch(`${broker.url}/models`)).status, 401);
    assert.equal((await fetch(`${broker.url}/models`, {headers: {...headers, Origin: 'https://attacker.invalid'}})).status, 401);
    assert.equal((await fetch(`${broker.url}/unconfigured`, {headers})).status, 404);
    assert.equal((await fetch(`${broker.url}/chat/completions`, {method: 'POST', headers, body: JSON.stringify({model: 'worker', messages: []})})).status, 400);
    const result = await fetch(`${broker.url}/chat/completions`, {method: 'POST', headers, body: JSON.stringify({model: 'pro', messages: [], stream: true})});
    assert.equal(result.status, 200); assert.equal(result.headers.get('x-not-public'), null);
    assert.match(await result.text(), /tool_calls/); assert.equal(dispatches, 1);
  } finally {await broker.close();}
});
