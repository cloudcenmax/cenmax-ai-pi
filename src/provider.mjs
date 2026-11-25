import {BASE_URL, CenmaxError, createOAuth, secret} from './oauth.mjs';
import {RefreshFence} from './storage.mjs';
import {startBroker} from './broker.mjs';

export const PROVIDER = 'cenmax';
export const API = 'cenmax-chat-completions';

export function createIntegration(pi, {oauth = createOAuth(), fence = new RefreshFence(), createStream, streamCompletions, brokerFactory = startBroker} = {}) {
  let catalogue = [];
  const register = rows => {
    catalogue = rows;
    pi.unregisterProvider(PROVIDER);
    pi.registerProvider(PROVIDER, {...configuration, models: rows});
  };
  const configuration = {
    name: 'Cenmax AI', baseUrl: BASE_URL, api: API, models: [],
    oauth: {
      name: 'Cenmax AI',
      async login(callbacks) {
        const credential = await oauth.login(({url, code}) => callbacks.onAuth({url, instructions: `Confirm Cenmax AI code: ${code}`}), callbacks.signal);
        try { register(await oauth.models(credential.access, callbacks.signal)); }
        catch { await oauth.revoke(credential).catch(() => {}); throw new CenmaxError(); }
        return credential;
      },
      async refreshToken(credential) {
        // Pi serializes refreshes. This durable pre-dispatch fence also prevents
        // replay when an older host preserves a grant after an uncertain result.
        await fence.claim(secret(credential.refresh));
        return oauth.refresh(credential.refresh);
      },
      getApiKey(credential) { return secret(credential.access); },
    },
    streamSimple(model, context, options = {}) {
      const stream = createStream();
      (async () => {
        let broker;
        try {
          if (model.provider !== PROVIDER || model.api !== API || model.baseUrl !== BASE_URL) throw new CenmaxError();
          const token = secret(options.apiKey);
          // Re-check entitlement for each generation, including tool-loop turns.
          const live = await oauth.models(token, options.signal);
          const selected = live.find(row => row.id === model.id);
          if (!selected) throw new CenmaxError('This Cenmax AI model is not available to the signed-in account.');
          broker = await brokerFactory({store: {accessToken: async () => token}, model: selected});
          const safe = {signal: options.signal, temperature: options.temperature, maxTokens: options.maxTokens,
            reasoning: options.reasoning, toolChoice: options.toolChoice, timeoutMs: 600_000, maxRetries: 0, apiKey: broker.capability};
          const result = streamCompletions({...selected, api: API, provider: PROVIDER, baseUrl: broker.url}, context, safe);
          for await (const event of result) {
            if (event.type === 'error') {
              event.error.errorMessage = 'Cenmax AI request failed. Check your account or sign in again.';
            }
            stream.push(event);
          }
          stream.end();
        } catch {
          stream.push({type: 'error', reason: options.signal?.aborted ? 'aborted' : 'error', error: {
            role: 'assistant', content: [], api: API, provider: PROVIDER,
            model: catalogue.some(row => row.id === model?.id) ? model.id : '',
            usage: {input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: {input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0}},
            stopReason: options.signal?.aborted ? 'aborted' : 'error', timestamp: Date.now(),
            errorMessage: 'Cenmax AI request failed. Check your account or sign in again.',
          }}); stream.end();
        } finally { await broker?.close(); }
      })();
      return stream;
    },
  };
  pi.registerProvider(PROVIDER, configuration);

  async function discover(registry, signal) {
    try {
      const credential = registry.authStorage.get(PROVIDER);
      if (credential?.type !== 'oauth') { register([]); return; }
      const access = await registry.getApiKeyForProvider(PROVIDER);
      if (!access) throw new CenmaxError();
      register(await oauth.models(access, signal));
    }
    catch { register([]); throw new CenmaxError(); }
  }
  pi.on('session_start', async (_event, ctx) => {
    try { await discover(ctx.modelRegistry, ctx.signal); }
    catch { ctx.ui?.notify('Cenmax AI models could not be loaded. Sign in again or retry /cenmax-models.', 'warning'); }
  });
  pi.registerCommand('cenmax-models', {description: 'Refresh models available to your Cenmax AI account', handler: async (_args, ctx) => {
    await discover(ctx.modelRegistry, ctx.signal);
    ctx.ui?.notify('Cenmax AI model catalogue refreshed.', 'info');
  }});
  pi.registerCommand('cenmax-disconnect', {description: 'Revoke Cenmax AI access and remove local sign-in', handler: async (_args, ctx) => {
    const credential = ctx.modelRegistry.authStorage.get(PROVIDER);
    if (credential?.type === 'oauth') await oauth.revoke(credential);
    ctx.modelRegistry.authStorage.logout(PROVIDER); register([]);
    ctx.ui?.notify('Cenmax AI disconnected.', 'info');
  }});
  return {discover, configuration};
}
