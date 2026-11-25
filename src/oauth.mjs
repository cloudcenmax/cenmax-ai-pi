import { setTimeout as pause } from 'node:timers/promises';

export const ORIGIN = 'https://console.ai.cenmax.in';
export const BASE_URL = `${ORIGIN}/app/v1`;
export const CLIENT_ID = 'cenmax-pi';
export class CenmaxError extends Error {
  constructor(message = 'Cenmax AI request failed. Check your account or sign in again.') { super(message); this.name = 'CenmaxError'; }
}
export function secret(value) {
  if (typeof value !== 'string' || !value || value.length > 16384 || /[^\x21-\x7e]/.test(value)) throw new CenmaxError();
  return value;
}
export async function json(response, ignoreContent = false) {
  const reader = response.body?.getReader();
  if (!reader) { if (ignoreContent) return {}; throw new CenmaxError(); }
  let size = 0; const chunks = [];
  try {
    while (true) {
      const {done, value} = await reader.read(); if (done) break;
      size += value.byteLength; if (size > 1024 * 1024) throw new CenmaxError();
      chunks.push(Buffer.from(value));
    }
    if (ignoreContent) return {};
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new CenmaxError();
    return body;
  } catch { throw new CenmaxError(); }
  finally { await reader.cancel().catch(() => {}); }
}
export function createOAuth({fetcher = globalThis.fetch, now = Date.now, sleep = pause} = {}) {
  async function request(path, {fields, token, signal} = {}) {
    if (!['/oauth/device/code', '/oauth/token', '/oauth/revoke', '/app/v1/models'].includes(path)) throw new CenmaxError();
    try {
      const response = await fetcher(`${ORIGIN}${path}`, {
        method: fields ? 'POST' : 'GET', redirect: 'error',
        signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(20_000)]) : AbortSignal.timeout(20_000),
        headers: {Accept: 'application/json', ...(fields ? {'Content-Type': 'application/x-www-form-urlencoded'} : {}), ...(token ? {Authorization: `Bearer ${secret(token)}`} : {})},
        body: fields ? new URLSearchParams({...fields, client_id: CLIENT_ID}) : undefined,
      });
      if (response.redirected || (response.url && new URL(response.url).origin !== ORIGIN)) throw new CenmaxError();
      return {ok: response.ok, status: response.status, body: await json(response, path === '/oauth/revoke' && response.ok)};
    } catch { throw new CenmaxError(); }
  }
  function tokens(body) {
    if (!/^bearer$/i.test(body.token_type) || !Number.isFinite(body.expires_in) || body.expires_in <= 0 || body.expires_in > 86400) throw new CenmaxError();
    return {access: secret(body.access_token), refresh: secret(body.refresh_token), expires: now() + Math.max(1, body.expires_in - 60) * 1000};
  }
  async function login(show, signal) {
    const result = await request('/oauth/device/code', {fields: {scope: 'chat'}, signal});
    const d = result.body;
    let supplied;
    try { supplied = new URL(d.verification_uri_complete || d.verification_uri); } catch { throw new CenmaxError(); }
    if (!result.ok || supplied.origin !== ORIGIN || supplied.pathname !== '/oauth/device' || supplied.username || supplied.password || supplied.hash ||
        typeof d.user_code !== 'string' || !/^[A-Z0-9-]{4,32}$/i.test(d.user_code) || !Number.isFinite(d.expires_in) || d.expires_in <= 0 || d.expires_in > 1800) throw new CenmaxError();
    const device = secret(d.device_code);
    const url = `${ORIGIN}/oauth/device?${new URLSearchParams({user_code: d.user_code})}`;
    const deadline = now() + d.expires_in * 1000;
    let interval = Number.isFinite(d.interval) ? Math.max(5, Math.min(60, d.interval)) : 5;
    await show({url, code: d.user_code});
    while (now() < deadline) {
      await sleep(Math.min(interval * 1000, deadline - now()), undefined, {signal});
      if (now() >= deadline) break;
      const r = await request('/oauth/token', {fields: {grant_type: 'urn:ietf:params:oauth:grant-type:device_code', device_code: device}, signal});
      if (r.ok) return tokens(r.body);
      if (r.body.error === 'authorization_pending') continue;
      if (r.body.error === 'slow_down') { interval += 5; continue; }
      throw new CenmaxError('Cenmax AI sign-in was not completed. Start sign-in again.');
    }
    throw new CenmaxError('Cenmax AI sign-in expired. Start sign-in again.');
  }
  async function refresh(value) {
    const r = await request('/oauth/token', {fields: {grant_type: 'refresh_token', refresh_token: secret(value)}});
    if (!r.ok) throw new CenmaxError();
    return tokens(r.body);
  }
  async function revoke(credential) {
    for (const [token, hint] of [[credential.refresh, 'refresh_token'], [credential.access, 'access_token']]) {
      const r = await request('/oauth/revoke', {fields: {token: secret(token), token_type_hint: hint}});
      if (!r.ok) throw new CenmaxError();
    }
  }
  async function models(token, signal) {
    const r = await request('/app/v1/models', {token, signal});
    if (!r.ok || !Array.isArray(r.body.data)) throw new CenmaxError();
    const seen = new Set();
    return r.body.data.map(row => {
      if (!row || typeof row.id !== 'string' || !/^[a-z][a-z0-9_-]{0,63}$/.test(row.id) || row.owned_by !== 'Cenmax AI' || seen.has(row.id) ||
          typeof row.display_name !== 'string' || !row.display_name.endsWith('by Cenmax AI') || row.display_name.length > 128 || /[^\x20-\x7e]/.test(row.display_name) ||
          !Number.isSafeInteger(row.context_window) || row.context_window <= 0 || !Number.isSafeInteger(row.max_output_tokens) || row.max_output_tokens <= 0 || row.max_output_tokens > row.context_window) throw new CenmaxError();
      seen.add(row.id);
      return {id: row.id, name: row.display_name, contextWindow: row.context_window, maxTokens: row.max_output_tokens,
        reasoning: row.capabilities?.reasoning === true, input: row.capabilities?.vision === true ? ['text', 'image'] : ['text'],
        cost: {input: 0, output: 0, cacheRead: 0, cacheWrite: 0}};
    });
  }
  return {login, refresh, revoke, models};
}
