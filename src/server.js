import http from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { loadConfig } from './config.js';
import { PolicyEngine } from './engine.js';
import { AuditLog } from './audit.js';
import { AppError, ROLES, isDate, requestId, today, percentile } from './util.js';
import { runLab } from './lab.js';

const equal = (a, b) => typeof a === 'string' && typeof b === 'string' && Buffer.byteLength(a) === Buffer.byteLength(b) && timingSafeEqual(Buffer.from(a), Buffer.from(b));
const staticFiles = new Map([['/', ['index.html', 'text/html']], ['/app.js', ['app.js', 'text/javascript']], ['/styles.css', ['styles.css', 'text/css']], ['/favicon.svg', ['favicon.svg', 'image/svg+xml']]]);

async function body(req) {
  const type = (req.headers['content-type'] || '').split(';')[0].trim();
  if (type !== 'application/json') throw new AppError('content_type', 'Use Content-Type: application/json.', 415);
  if (Number(req.headers['content-length'] || 0) > 16384) throw new AppError('body_too_large', 'Request exceeds 16 KB.', 413);
  const chunks = []; let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 16384) throw new AppError('body_too_large', 'Request exceeds 16 KB.', 413);
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw new AppError('invalid_json', 'Request body must be valid JSON.'); }
}

function authorize(req, config, requested) {
  const token = (req.headers.authorization || '').replace(/^Bearer /, '');
  if (config.authMode === 'runner' && !equal(token, config.runnerToken)) throw new AppError('unauthorized', 'A trusted runner credential is required.', 401);
  if (config.authMode === 'tokens') {
    const match = Object.entries(config.tokens).find(([secret]) => equal(token, secret));
    if (!match) throw new AppError('unauthorized', 'An access credential is required.', 401);
    if (requested && requested !== match[1]) throw new AppError('forbidden', 'The requested role is not assigned to your credential.', 403);
    return match[1];
  }
  const role = requested || 'public';
  if (!Object.hasOwn(ROLES, role)) throw new AppError('invalid_role', 'Unknown requester role.');
  return role;
}

export async function createApplication(config = loadConfig(), options = {}) {
  const audit = await AuditLog.create(config.dataDir);
  const engine = new PolicyEngine(config, { audit, ...options });
  const assets = new Map();
  try {
    await engine.initialize();
    for (const [route, [file, type]] of staticFiles) assets.set(route, { bytes: await readFile(path.join(config.root, 'web', file)), type });
  } catch (error) { await audit.close(); throw error; }
  const limits = new Map();
  const rateLimit = req => {
    const key = req.socket.remoteAddress || 'local';
    const now = Date.now();
    if (limits.size > 5000) for (const [ip, item] of limits) if (item.until < now) limits.delete(ip);
    let item = limits.get(key);
    if (!item || item.until < now) { item = { count: 0, until: now + 60000 }; limits.set(key, item); }
    if (++item.count > 1200) throw new AppError('rate_limited', 'Too many requests. Retry in a minute.', 429);
  };

  const server = http.createServer({ requestTimeout: 20000, headersTimeout: 10000, maxHeaderSize: 8192 }, async (req, res) => {
    const traceId = requestId();
    res.setHeader('X-Request-ID', traceId);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; font-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
    const json = (status, payload) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(payload)); };
    try {
      const url = new URL(req.url, 'http://localhost');
      if (config.authMode === 'demo') {
        let hostname;
        try { hostname = new URL(`http://${req.headers.host}`).hostname; } catch { throw new AppError('invalid_host', 'Invalid Host header.', 400); }
        if (!['localhost', '127.0.0.1', '[::1]'].includes(hostname)) throw new AppError('invalid_host', 'Local demo requires a loopback Host header.', 403);
      }
      if (req.method === 'GET' && assets.has(url.pathname)) {
        const asset = assets.get(url.pathname);
        res.writeHead(200, { 'Content-Type': `${asset.type}; charset=utf-8` }); res.end(asset.bytes); return;
      }
      if (req.method === 'GET' && url.pathname === '/healthz') { json(audit.healthy ? 200 : 503, { status: audit.healthy ? 'ready' : 'degraded' }); return; }
      if (req.method === 'GET' && url.pathname === '/api/session') { json(200, { auth_mode: config.authMode }); return; }
      rateLimit(req);
      // Browser requests may only originate from this exact host. No CORS is enabled.
      if (req.headers.origin && req.headers.origin !== `http://${req.headers.host}` && req.headers.origin !== `https://${req.headers.host}`) throw new AppError('origin_not_allowed', 'Cross-origin requests are not allowed.', 403);
      if (req.method === 'POST' && url.pathname === '/api/admin/reload') {
        if (!config.adminToken || !equal((req.headers.authorization || '').replace(/^Bearer /, ''), config.adminToken)) throw new AppError('unauthorized', 'An administrator credential is required.', 401);
        const data = await body(req);
        if (!data || typeof data !== 'object' || Array.isArray(data) || Object.keys(data).length) throw new AppError('invalid_request', 'Reload accepts an empty object; CORPUS_DIR is server-configured.');
        json(200, await engine.reload()); return;
      }
      const data = req.method === 'POST' ? await body(req) : null;
      if (req.method === 'POST' && ['/ask', '/api/ask'].includes(url.pathname) && !Object.hasOwn(ROLES, data?.role)) throw new AppError('invalid_role', 'role must be public, ops or legal.');
      const role = authorize(req, config, data?.role || url.searchParams.get('role'));
      const asOf = url.searchParams.get('as_of') || today();
      if (!isDate(asOf)) throw new AppError('invalid_date', 'Use a valid as_of date.');

      if (req.method === 'POST' && ['/ask', '/api/ask'].includes(url.pathname)) {
        const result = await engine.ask({ ...data, role });
        if (url.pathname === '/ask') json(200, { id: result.id, status: result.status, answer: result.answer,
          citations: result.citations.map(({ doc_id, section, quote }) => ({ doc_id, section, quote })), cost_usd: result.cost_usd, latency_ms: result.latency_ms });
        else json(200, result);
        return;
      }
      if (req.method === 'POST' && url.pathname === '/api/compare') {
        if (!data || Object.keys(data).some(k => !['question', 'role', 'before', 'after'].includes(k)) || !isDate(data.before) || !isDate(data.after)) throw new AppError('invalid_request', 'Provide question, role, before and after dates.');
        const [before, after] = await Promise.all([engine.ask({ id: requestId(), question: data.question, role, as_of: data.before }), engine.ask({ id: requestId(), question: data.question, role, as_of: data.after })]);
        if (before.meta.corpus_version !== after.meta.corpus_version) throw new AppError('corpus_changing', 'The book changed during this comparison. Please retry.', 409);
        json(200, { before, after, changed: before.answer !== after.answer || before.status !== after.status }); return;
      }
      if (req.method === 'GET' && url.pathname === '/api/meta') {
        const docs = engine.corpus.visibleDocuments(role, asOf);
        json(200, { name: 'Policy Atlas', mode: config.mode, model: config.mode === 'model' ? config.model : null, role, as_of: asOf,
          retrieval: engine.semanticSearch ? 'semantic+lexical' : 'lexical',
          auth_mode: config.authMode, documents: docs.length, passages: docs.reduce((n, d) => n + d.passage_count, 0),
          authorities: Object.fromEntries(['RBI', 'SEBI', 'Internal', 'Other'].map(a => [a, docs.filter(d => d.authority === a).length])),
          corpus_version: engine.corpus.fingerprint, loaded_at: engine.corpus.loadedAt, indexing_ms: engine.corpus.indexingMs,
          last_effective_date: docs.map(d => d.effective_date).sort().at(-1), corpus_notice: 'Released benchmark corpus; no live regulatory feed.' }); return;
      }
      if (req.method === 'GET' && url.pathname === '/api/documents') {
        const q = (url.searchParams.get('q') || '').toLowerCase();
        json(200, { documents: engine.corpus.visibleDocuments(role, asOf).filter(d => `${d.title} ${d.authority}`.toLowerCase().includes(q)) }); return;
      }
      if (req.method === 'GET' && url.pathname.startsWith('/api/documents/')) {
        const doc = engine.corpus.getDocument(decodeURIComponent(url.pathname.slice('/api/documents/'.length)), role, asOf);
        if (!doc) throw new AppError('not_found', 'Document not found.', 404);
        json(200, doc); return;
      }
      if (req.method === 'GET' && url.pathname === '/api/audit') {
        const events = engine.visibleAudit(role);
        const answers = events.filter(row => row.kind === 'answer');
        json(200, { events, window: 'Most recent 80 visible events', stats: { requests: events.length,
          answered: answers.filter(r => r.status === 'answered').length, refused: answers.filter(r => r.status !== 'answered').length,
          cache_hits: answers.filter(r => r.cache_hit).length, latency_p95_ms: percentile(answers.map(r => r.latency_ms), 0.95),
          tokens: events.some(r => r.usage?.input_tokens === null || r.usage?.output_tokens === null) ? null : events.reduce((n, r) => n + (r.usage?.input_tokens || 0) + (r.usage?.output_tokens || 0), 0) } }); return;
      }
      if (req.method === 'POST' && url.pathname === '/api/lab') { json(200, runLab()); return; }
      throw new AppError('not_found', 'Endpoint not found.', 404);
    } catch (error) {
      if (res.destroyed || res.headersSent) return;
      const status = error instanceof AppError ? error.status : 500;
      // Never serialize provider payloads, source contents, paths, or credentials.
      if (status >= 500) console.error(JSON.stringify({ request_id: traceId, error: error.code || 'internal_error' }));
      json(status, { error: { code: error.code || 'internal_error', message: error instanceof AppError ? error.message : 'The request could not be completed.', request_id: traceId } });
    }
  });
  server.on('clientError', (_error, socket) => socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n'));
  return { server, engine, audit, async close() { await new Promise(resolve => server.close(resolve)); await audit.close(); } };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const config = loadConfig();
  const app = await createApplication(config);
  app.server.once('error', async error => { console.error(JSON.stringify({ event: 'startup_failed', code: error.code || 'listen_failed' })); await app.audit.close(); process.exit(1); });
  app.server.listen(config.port, config.host, () => console.log(JSON.stringify({ event: 'ready', url: `http://${config.host}:${config.port}`, mode: config.mode, corpus: app.engine.corpus.fingerprint.slice(0, 12) })));
  let closing = false;
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, async () => { if (closing) return; closing = true; await app.close(); process.exit(0); });
}
