import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createOAuth, ORIGIN, CLIENT_ID, BASE_URL} from '../src/oauth.mjs';
import {RefreshFence} from '../src/storage.mjs';

const response = (value, status = 200) => new Response(JSON.stringify(value), {status});
const grant = {access_token: 'synthetic-access', refresh_token: 'synthetic-refresh', token_type: 'Bearer', expires_in: 3600};
const card = {id: 'pro', owned_by: 'Cenmax AI', display_name: 'Pro by Cenmax AI', context_window: 10000, max_output_tokens: 1000, capabilities: {tools: true}};

test('device flow pins origin, scope, code URL and pending/slow-down intervals', async () => {
  let now = 0; let calls = 0; let shown; const sleeps = [];
  const oauth = createOAuth({now: () => now, sleep: async ms => {sleeps.push(ms); now += ms;}, fetcher: async (url, options) => {
    assert.equal(new URL(url).origin, ORIGIN); assert.equal(options.redirect, 'error');
    assert.equal(options.body.get('client_id'), CLIENT_ID);
    calls++;
    if (calls === 1) { assert.equal(options.body.get('scope'), 'chat'); return response({device_code: 'device', user_code: 'ABCD-EFGH', verification_uri_complete: `${ORIGIN}/oauth/device?untrusted=value`, expires_in: 600, interval: 5}); }
    if (calls === 2) return response({error: 'authorization_pending'}, 400);
    if (calls === 3) return response({error: 'slow_down'}, 400);
    return response(grant);
  }});
  const credential = await oauth.login(info => {shown = info;});
  assert.equal(shown.url, `${ORIGIN}/oauth/device?user_code=ABCD-EFGH`);
  assert.deepEqual(sleeps, [5000, 5000, 10000]); assert.equal(credential.refresh, 'synthetic-refresh');
});
test('hostile approval origin is never displayed', async () => {
  let shown = false;
  const oauth = createOAuth({fetcher: async () => response({device_code: 'device', user_code: 'ABCD', verification_uri: 'https://attacker.invalid/oauth/device', expires_in: 600})});
  await assert.rejects(oauth.login(() => {shown = true;})); assert.equal(shown, false);
});
test('device expiration stops polling and denial stays neutral', async () => {
  let now = 0; let calls = 0;
  const oauth = createOAuth({now: () => now, sleep: async ms => {now += ms;}, fetcher: async () => {calls++; return response({device_code: 'device', user_code: 'ABCD', verification_uri: `${ORIGIN}/oauth/device`, expires_in: 1});}});
  await assert.rejects(oauth.login(() => {}), /expired/); assert.equal(calls, 1);
  const denied = createOAuth({fetcher: async () => response({error: 'invalid_grant', error_description: 'private-error-synthetic'}, 400)});
  await assert.rejects(denied.refresh('refresh'), error => !error.message.includes('private-error-synthetic'));
});
test('refresh returns replacement without subsequent network dependency', async () => {
  let calls = 0;
  const oauth = createOAuth({fetcher: async (url, options) => {calls++; assert.equal(url, `${ORIGIN}/oauth/token`); assert.equal(options.body.get('refresh_token'), 'old'); return response(grant);}});
  assert.equal((await oauth.refresh('old')).access, 'synthetic-access'); assert.equal(calls, 1);
});
test('catalogue maps only owned public models and rejects malformed metadata', async () => {
  const oauth = createOAuth({fetcher: async (url, options) => {assert.equal(url, `${BASE_URL}/models`); assert.equal(options.headers.Authorization, 'Bearer token'); return response({data: [card]});}});
  assert.deepEqual((await oauth.models('token')).map(row => [row.id, row.name]), [['pro', 'Pro by Cenmax AI']]);
  for (const bad of [{...card, owned_by: 'Other'}, {...card, id: 'private/model'}, {...card, display_name: '\u001bPro'}, {...card, max_output_tokens: 99999}]) {
    await assert.rejects(createOAuth({fetcher: async () => response({data: [bad]})}).models('token'));
  }
});
test('tokens and response bodies are bounded and failures do not echo transport text', async () => {
  await assert.rejects(createOAuth({fetcher: async () => response({...grant, access_token: 'a\r\nb'})}).refresh('old'));
  await assert.rejects(createOAuth({fetcher: async () => new Response('x'.repeat(1024 * 1024 + 1))}).refresh('old'));
  await assert.rejects(createOAuth({fetcher: async () => {throw new Error('secret-transport-value');}}).refresh('old'), error => !error.message.includes('secret-transport-value'));
});
test('revoke sends both grant types to the fixed service origin', async () => {
  const hints = [];
  await createOAuth({fetcher: async (url, options) => {assert.equal(url, `${ORIGIN}/oauth/revoke`); hints.push(options.body.get('token_type_hint')); return response({});}}).revoke({access: 'a', refresh: 'r'});
  assert.deepEqual(hints, ['refresh_token', 'access_token']);
});
test('successful revocation accepts actual empty-list response and empty HTTP bodies', async () => {
  for (const [body, status] of [['[]', 200], [null, 204], ['', 200]]) {
    let calls = 0;
    await createOAuth({fetcher: async () => {calls++; return new Response(body, {status});}}).revoke({access: 'a', refresh: 'r'});
    assert.equal(calls, 2);
  }
  await assert.rejects(createOAuth({fetcher: async () => new Response('[]', {status: 200})}).refresh('old'));
  await assert.rejects(createOAuth({fetcher: async () => new Response('x'.repeat(1024 * 1024 + 1), {status: 200})}).revoke({access: 'a', refresh: 'r'}));
});
test('durable pre-dispatch fence refuses replay across fresh instances without storing tokens', async () => {
  const root = await fs.mkdtemp(path.join(await fs.realpath(os.tmpdir()), 'cenmax-fence-'));
  try {
    await new RefreshFence(root).claim('synthetic-refresh');
    await assert.rejects(new RefreshFence(root).claim('synthetic-refresh'), /renewed/);
    const names = await fs.readdir(root); assert.equal(names.length, 1); assert.ok(!names[0].includes('synthetic-refresh'));
    assert.equal((await fs.stat(path.join(root, names[0]))).mode & 0o777, 0o600);
    assert.ok(!(await fs.readFile(path.join(root, names[0]), 'utf8')).includes('synthetic-refresh'));
  } finally {await fs.rm(root, {recursive: true, force: true});}
});
test('credential root symlinks and permissive modes are rejected', async () => {
  const parent = await fs.mkdtemp(path.join(await fs.realpath(os.tmpdir()), 'cenmax-fence-'));
  try {
    const broad = path.join(parent, 'broad'); await fs.mkdir(broad, {mode: 0o755});
    await assert.rejects(new RefreshFence(broad).claim('r'));
    const linked = path.join(parent, 'link'); await fs.symlink(broad, linked);
    await assert.rejects(new RefreshFence(linked).claim('r'));
  } finally {await fs.rm(parent, {recursive: true, force: true});}
});
