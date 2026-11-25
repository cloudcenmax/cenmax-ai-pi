import test from 'node:test';
import assert from 'node:assert/strict';
import {createIntegration, PROVIDER, API} from '../src/provider.mjs';
import {BASE_URL} from '../src/oauth.mjs';

const row = {id: 'pro', name: 'Pro by Cenmax AI', contextWindow: 10000, maxTokens: 1000, input: ['text'], reasoning: false, cost: {input: 0, output: 0, cacheRead: 0, cacheWrite: 0}};
function host() {
  const state = {commands: {}, handlers: {}, configuration: null};
  return {...state, registerProvider(_name, config) {this.configuration = config;}, unregisterProvider() {this.configuration = null;}, on(event, handler) {this.handlers[event] = handler;}, registerCommand(name, command) {this.commands[name] = command;}};
}
function stream() {
  const values = []; let finish;
  const done = new Promise(resolve => {finish = resolve;});
  return {push(value) {values.push(value);}, end() {finish();}, async *[Symbol.asyncIterator]() {await done; yield* values;}};
}
test('registers native Pi OAuth and only models from the active account', async () => {
  const pi = host();
  const integration = createIntegration(pi, {oauth: {models: async () => [row]}, fence: {}, createStream: stream});
  assert.equal(pi.configuration.oauth.name, 'Cenmax AI'); assert.deepEqual(pi.configuration.models, []);
  await integration.discover({authStorage: {get: () => ({type: 'oauth'})}, getApiKeyForProvider: async () => 'token'});
  assert.equal(pi.configuration.models[0].id, 'pro');
  await integration.discover({authStorage: {get: () => undefined}}); assert.deepEqual(pi.configuration.models, []);
});
test('native refresh fences before dispatch and never fetches catalogue after rotation', async () => {
  const calls = []; const pi = host();
  createIntegration(pi, {oauth: {refresh: async () => {calls.push('refresh'); return {access: 'new', refresh: 'next', expires: 100};}}, fence: {claim: async () => {calls.push('fence');}}, createStream: stream});
  const value = await pi.configuration.oauth.refreshToken({refresh: 'old'});
  assert.equal(value.refresh, 'next'); assert.deepEqual(calls, ['fence', 'refresh']);
});
test('stream verifies entitlements and substitutes a run capability without forwarding unsafe options', async () => {
  const pi = host(); let closed = false; let used;
  createIntegration(pi, {oauth: {models: async token => {assert.equal(token, 'reusable'); return [row];}}, fence: {}, createStream: stream,
    brokerFactory: async args => {assert.equal(await args.store.accessToken(), 'reusable'); return {url: 'http://127.0.0.1:1/v1', capability: 'ephemeral', close: async () => {closed = true;}};},
    streamCompletions(model, _context, options) {used = {model, options}; return {async *[Symbol.asyncIterator]() {yield {type: 'done', reason: 'stop', message: {model: 'pro', provider: PROVIDER}};}};},
  });
  const events = [];
  for await (const event of pi.configuration.streamSimple({...row, provider: PROVIDER, api: API, baseUrl: BASE_URL}, {}, {apiKey: 'reusable', headers: {Authorization: 'evil'}, onPayload: () => {throw new Error();}})) events.push(event);
  assert.equal(used.options.apiKey, 'ephemeral'); assert.equal(used.options.headers, undefined); assert.equal(used.options.onPayload, undefined);
  assert.equal(used.model.provider, PROVIDER); assert.equal(events[0].type, 'done');
  await new Promise(resolve => setImmediate(resolve)); assert.equal(closed, true);
});
test('endpoint/model attacks fail before broker or inference and errors stay neutral', async () => {
  const pi = host(); let dispatched = false;
  createIntegration(pi, {oauth: {models: async () => []}, fence: {}, createStream: stream, brokerFactory: async () => {dispatched = true;}});
  for (const model of [null, {...row, provider: PROVIDER, api: API, baseUrl: 'https://attacker.invalid'}, {...row, provider: PROVIDER, api: API, baseUrl: BASE_URL}]) {
    const values = []; for await (const value of pi.configuration.streamSimple(model, {}, {apiKey: 'token'})) values.push(value);
    assert.equal(values[0].type, 'error'); assert.match(values[0].error.errorMessage, /Cenmax AI/);
  }
  assert.equal(dispatched, false);
});
test('disconnect revokes before host credential deletion', async () => {
  const pi = host(); const actions = [];
  createIntegration(pi, {oauth: {revoke: async () => {actions.push('revoke');}}, fence: {}, createStream: stream});
  await pi.commands['cenmax-disconnect'].handler('', {modelRegistry: {authStorage: {get: () => ({type: 'oauth', access: 'a', refresh: 'r'}), logout: () => {actions.push('logout');}}}, ui: {notify() {}}});
  assert.deepEqual(actions, ['revoke', 'logout']); assert.deepEqual(pi.configuration.models, []);
});
