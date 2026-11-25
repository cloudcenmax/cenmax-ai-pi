import http from 'node:http';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { once } from 'node:events';
import { BASE_URL, CenmaxError } from './oauth.mjs';

export async function startBroker({store, model, fetcher = fetch}) {
  const capability = randomBytes(32).toString('hex');
  const active = new Set(); let requests = 0;
  const server = http.createServer(async (req, res) => {
    let controller;
    const reply = (status, message) => { if (!res.headersSent) res.writeHead(status, {'Content-Type': 'application/json'}); res.end(JSON.stringify({error: {message, type: 'cenmax_error'}})); };
    try {
      const expected = `Bearer ${capability}`;
      const supplied = req.headers.authorization ?? '';
      if (req.headers.host !== `127.0.0.1:${server.address().port}` || req.headers.origin ||
          Buffer.byteLength(supplied) !== Buffer.byteLength(expected) || !timingSafeEqual(Buffer.from(supplied), Buffer.from(expected))) {
        reply(401, 'Cenmax AI authorization required.'); return;
      }
      if (req.method === 'GET' && req.url === '/v1/models') {
        res.writeHead(200, {'Content-Type': 'application/json'});
        res.end(JSON.stringify({object: 'list', data: [{id: model.id, object: 'model', owned_by: 'Cenmax AI'}]})); return;
      }
      if (req.method !== 'POST' || req.url !== '/v1/chat/completions') { reply(404, 'Cenmax AI endpoint not found.'); return; }
      if (requests >= 4) { reply(429, 'Cenmax AI connection is busy.'); return; }
      requests++;
      controller = new AbortController(); active.add(controller);
      const timer = setTimeout(() => controller.abort(), 600_000); timer.unref();
      res.once('close', () => { clearTimeout(timer); controller.abort(); });
      let size = 0; const chunks = [];
      for await (const chunk of req) {
        size += chunk.length; if (size > 8 * 1024 * 1024) { reply(413, 'Cenmax AI request is too large.'); return; }
        chunks.push(chunk);
      }
      let body;
      try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { reply(400, 'Invalid Cenmax AI request.'); return; }
      if (body.model !== model.id || !Array.isArray(body.messages)) { reply(400, 'Select the configured Cenmax AI model.'); return; }
      const response = await fetcher(`${BASE_URL}/chat/completions`, {
        method: 'POST', redirect: 'error', signal: controller.signal,
        headers: {'Content-Type': 'application/json', Authorization: `Bearer ${await store.accessToken()}`},
        body: JSON.stringify(body),
      });
      if (!response.ok) { await response.body?.cancel(); reply([400,401,403,413,429].includes(response.status) ? response.status : 502, 'Cenmax AI request could not complete. Check your account and retry.'); return; }
      const isStream = body.stream === true;
      const contentType = response.headers.get('content-type') || '';
      if (!(isStream ? contentType.includes('text/event-stream') : contentType.includes('application/json'))) {
        await response.body?.cancel(); reply(502, 'Cenmax AI returned an invalid response.'); return;
      }
      res.writeHead(200, {'Content-Type': isStream ? 'text/event-stream' : 'application/json', 'Cache-Control': 'no-store'});
      let outputBytes = 0;
      for await (const chunk of response.body) {
        outputBytes += chunk.length;
        if (outputBytes > 32 * 1024 * 1024) throw new CenmaxError('Response limit exceeded.');
        if (!res.write(chunk)) await once(res, 'drain', {signal: controller.signal});
      }
      res.end();
    } catch { if (!res.headersSent) reply(502, 'Cenmax AI connection failed.'); else res.destroy(); }
    finally { if (controller) { active.delete(controller); requests--; controller.abort(); } }
  });
  server.requestTimeout = 30_000; server.headersTimeout = 10_000; server.maxConnections = 16;
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  return {url: `http://127.0.0.1:${server.address().port}/v1`, capability,
    async close() { for (const request of active) request.abort(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }};
}
