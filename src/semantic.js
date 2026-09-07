import { mkdir, readFile, open, rename, stat, unlink } from 'node:fs/promises';
import path from 'node:path';
import { EMBEDDING } from './config.js';
import { AppError, sha256, stableStringify, requestId } from './util.js';
import { addUsage, emptyUsage } from './usage.js';

const FORMAT = 'policy-atlas-embeddings-v1';
const vectorValid = v => Array.isArray(v) && v.length === EMBEDDING.dimensions && v.every(x => typeof x === 'number' && Number.isFinite(x)) && Number.isFinite(Math.hypot(...v)) && Math.hypot(...v) > 0;
const unit = v => { const n = Math.hypot(...v); return Object.freeze(v.map(x => x / n)); };
export const chunkKey = entry => `${entry.passage.passage_id}:${entry.passage.start}`;
const embeddingText = entry => `${entry.doc.title.slice(0, 500)}\n${entry.passage.text}`;

export async function embed(config, inputs, { fetcher = fetch } = {}) {
  if (!Array.isArray(inputs) || !inputs.length || inputs.length > 64 || inputs.some(s => typeof s !== 'string' || !s.trim() || s.length > 12000)) throw new Error('Invalid embedding batch.');
  const unknown = { input_tokens: null, output_tokens: 0, cost_usd: null, calls: 1, model: EMBEDDING.model };
  const fail = (code, message, usage = unknown) => new AppError(code, message, 503, { ...usage, embeddings: { ...usage } });
  let response;
  try {
    response = await fetcher(`${config.baseUrl}/embeddings`, { method: 'POST', redirect: 'error',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.key}`, ...config.extraHeaders },
      body: JSON.stringify({ model: EMBEDDING.model, dimensions: EMBEDDING.dimensions, encoding_format: 'float', input: inputs }),
      signal: AbortSignal.timeout(config.timeoutMs) });
  } catch { throw fail('semantic_unavailable', 'Semantic search is unavailable. Please retry; this does not mean the policy is absent.'); }
  if (!response.ok) throw fail('semantic_unavailable', 'Semantic search could not authenticate or complete its request. Check that the configured provider supports embeddings.');
  let data;
  try { data = await response.json(); } catch { throw fail('semantic_invalid', 'Semantic search returned an invalid response.'); }
  const tokens = Number.isInteger(data?.usage?.prompt_tokens) && data.usage.prompt_tokens >= 0 ? data.usage.prompt_tokens : null;
  const usage = { input_tokens: tokens, output_tokens: 0, calls: 1, model: data?.model || null,
    cost_usd: data?.model === EMBEDDING.model && tokens !== null ? tokens * EMBEDDING.input / 1e6 : null };
  if (data?.model !== EMBEDDING.model || !Array.isArray(data.data) || data.data.length !== inputs.length) throw fail('semantic_invalid', 'Semantic search returned an unexpected model or vector count.', usage);
  const vectors = new Array(inputs.length), seen = new Set();
  for (const row of data.data) {
    if (!Number.isInteger(row?.index) || row.index < 0 || row.index >= inputs.length || seen.has(row.index) || !vectorValid(row.embedding)) throw fail('semantic_invalid', 'Semantic search returned an invalid vector.', usage);
    seen.add(row.index); vectors[row.index] = unit(row.embedding);
  }
  return { vectors, usage: { ...usage, embeddings: { ...usage } } };
}

// A complete, content-addressed index is loaded/built before its corpus snapshot
// becomes visible. Vectors contain no answer text and are never evidence.
export class SemanticIndex {
  constructor(config, vectors, byContent, identity, indexUsage) {
    this.config = config; this.vectors = vectors; this.byContent = byContent;
    this.identity = identity; this.indexUsage = indexUsage;
  }

  static async build(config, retriever, { previous = null, embedder = embed } = {}) {
    const identity = sha256(stableStringify({ format: FORMAT, model: EMBEDDING.model, dimensions: EMBEDDING.dimensions, provider: config.baseUrl }));
    const entries = retriever.entries.map(entry => ({ key: chunkKey(entry), text: embeddingText(entry), hash: sha256(embeddingText(entry)) }));
    const filename = path.join(config.semanticCacheDir, `${identity}-${retriever.corpus.fingerprint}.json`);
    const expected = entries.map(({ key, hash }) => ({ key, hash }));
    let cached = null;
    try {
      if ((await stat(filename)).size > 64 * 1024 * 1024) throw new Error('Semantic cache is too large.');
      cached = JSON.parse(await readFile(filename, 'utf8'));
      if (cached.identity !== identity || cached.corpus !== retriever.corpus.fingerprint || !Array.isArray(cached.entries)
        || stableStringify(cached.entries.map(({ key, hash }) => ({ key, hash }))) !== stableStringify(expected)
        || cached.entries.some(e => !vectorValid(e.vector)) || sha256(stableStringify(cached.entries)) !== cached.checksum) throw new Error('Invalid semantic cache.');
    } catch (error) {
      if (error.code !== 'ENOENT') throw new AppError('semantic_cache_invalid', 'The semantic index cache could not be validated. Move the affected cache file aside and restart.', 503);
    }
    const byContent = new Map(previous?.identity === identity ? previous.byContent : []);
    const vectors = new Map();
    if (cached) {
      for (const row of cached.entries) { const v = unit(row.vector); vectors.set(row.key, v); byContent.set(row.hash, v); }
      return { index: new SemanticIndex(config, vectors, byContent, identity, cached.build_usage), usage: emptyUsage(), reused: entries.length, cache_hit: true };
    }
    let usage = emptyUsage();
    const missing = [...new Map(entries.filter(e => !byContent.has(e.hash)).map(e => [e.hash, e])).values()];
    for (let i = 0; i < missing.length; i += 64) {
      const batch = missing.slice(i, i + 64);
      let generated;
      try { generated = await embedder(config, batch.map(e => e.text)); }
      catch (error) { if (error instanceof AppError) error.usage = addUsage(usage, error.usage || emptyUsage()); throw error; }
      usage = addUsage(usage, generated.usage);
      if (generated.vectors.length !== batch.length || generated.vectors.some(v => !vectorValid(v))) throw new AppError('semantic_invalid', 'Semantic indexing returned invalid vectors.', 503, usage);
      batch.forEach((entry, j) => byContent.set(entry.hash, unit(generated.vectors[j])));
    }
    const rows = entries.map(e => ({ key: e.key, hash: e.hash, vector: byContent.get(e.hash) }));
    const activeHashes = new Set(entries.map(e => e.hash));
    for (const hash of byContent.keys()) if (!activeHashes.has(hash)) byContent.delete(hash);
    rows.forEach(e => vectors.set(e.key, e.vector));
    await mkdir(config.semanticCacheDir, { recursive: true, mode: 0o700 });
    const temporary = `${filename}.${requestId()}.tmp`;
    let handle;
    try {
      handle = await open(temporary, 'wx', 0o600);
      await handle.writeFile(JSON.stringify({ format: FORMAT, identity, corpus: retriever.corpus.fingerprint, model: EMBEDDING.model,
        dimensions: EMBEDDING.dimensions, created_at: new Date().toISOString(), build_usage: usage, checksum: sha256(stableStringify(rows)), entries: rows }));
      await handle.sync(); await handle.close(); handle = null;
      await rename(temporary, filename);
    } catch {
      throw new AppError('semantic_cache_write_failed', 'The semantic index could not be saved. Check the configured data directory.', 503, usage);
    } finally { await handle?.close(); await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; }); }
    return { index: new SemanticIndex(config, vectors, byContent, identity, usage), usage, reused: entries.length - missing.length, cache_hit: false };
  }

  async search(question, embedder = embed) {
    const generated = await embedder(this.config, [question]);
    if (generated.vectors.length !== 1 || !vectorValid(generated.vectors[0])) throw new AppError('semantic_invalid', 'Semantic search returned an invalid query vector.', 503, generated.usage);
    const query = unit(generated.vectors[0]);
    const scores = new Map([...this.vectors].map(([key, vector]) => [key, vector.reduce((n, x, i) => n + x * query[i], 0)]));
    return { scores, usage: generated.usage };
  }
}
