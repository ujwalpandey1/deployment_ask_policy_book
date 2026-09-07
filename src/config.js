import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = fileURLToPath(new URL('../', import.meta.url));
export const MODEL_PINS = Object.freeze({
  'gpt-4.1-mini-2025-04-14': { input: 0.40, output: 1.60, source: 'https://developers.openai.com/api/docs/models/gpt-4.1-mini' },
  'gpt-5-mini-2025-08-07': { input: 0.25, output: 2.00, source: 'https://developers.openai.com/api/docs/models/gpt-5-mini' },
});
// The provider publishes this identifier without a dated embedding snapshot.
// Keep that reproducibility limitation explicit in the evaluation manifest.
export const EMBEDDING = Object.freeze({ model: 'text-embedding-3-small', dimensions: 512, input: 0.02,
  source: 'https://developers.openai.com/api/docs/models/text-embedding-3-small', verified: '2026-09-07' });

function integer(env, key, fallback, min, max) {
  const value = Number(env[key] || fallback);
  if (!Number.isInteger(value) || value < min || value > max) throw new Error(`${key} must be between ${min} and ${max}.`);
  return value;
}

export function loadConfig(env = process.env) {
  const key = env.LLM_API_KEY || env.OPENAI_API_KEY || '';
  let mode = env.GENERATION_MODE || 'auto';
  if (mode === 'auto') mode = key ? 'model' : 'extractive';
  if (!['model', 'extractive'].includes(mode)) throw new Error('GENERATION_MODE must be auto, model or extractive.');
  if (mode === 'model' && !key) throw new Error('Model mode requires LLM_API_KEY or OPENAI_API_KEY.');
  const model = env.LLM_MODEL || 'gpt-4.1-mini-2025-04-14';
  if (!Object.hasOwn(MODEL_PINS, model)) throw new Error('Use an exact budget model snapshot from src/config.js MODEL_PINS.');
  const baseUrl = (env.LLM_BASE_URL || env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/$/, '');
  const parsed = new URL(baseUrl);
  if ((parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname))) || parsed.username || parsed.password || parsed.search || parsed.hash) throw new Error('LLM_BASE_URL must be HTTPS (or local HTTP), with no credentials or query string.');
  const authMode = env.AUTH_MODE || 'demo';
  if (!['demo', 'runner', 'tokens'].includes(authMode)) throw new Error('Invalid AUTH_MODE.');
  const host = env.HOST || '127.0.0.1';
  if (authMode === 'demo' && !['127.0.0.1', 'localhost', '::1'].includes(host)) throw new Error('Demo role selection is restricted to loopback; set AUTH_MODE before exposing the service.');
  const tokens = JSON.parse(env.AUTH_TOKENS || '{}');
  if (!tokens || typeof tokens !== 'object' || Array.isArray(tokens) || Object.values(tokens).some(role => !['public', 'ops', 'legal'].includes(role))) throw new Error('AUTH_TOKENS must map credentials to known roles.');
  if (authMode === 'tokens' && (!Object.keys(tokens).length || Object.keys(tokens).some(k => k.length < 20))) throw new Error('Token authentication requires credentials of at least 20 characters.');
  if (authMode === 'runner' && (env.RUNNER_TOKEN || '').length < 20) throw new Error('Runner authentication requires RUNNER_TOKEN of at least 20 characters.');
  if (env.ADMIN_TOKEN && env.ADMIN_TOKEN.length < 20) throw new Error('ADMIN_TOKEN must contain at least 20 characters.');
  const extraHeaders = JSON.parse(env.LLM_EXTRA_HEADERS || '{}');
  if (!extraHeaders || typeof extraHeaders !== 'object' || Array.isArray(extraHeaders) || Object.entries(extraHeaders).some(([k, v]) => /^(authorization|host|content-length|content-type)$/i.test(k) || typeof v !== 'string')) throw new Error('Invalid LLM_EXTRA_HEADERS.');
  const extractiveFloor = Number(env.MIN_EXTRACTIVE_COVERAGE || 0.55);
  if (!Number.isFinite(extractiveFloor) || extractiveFloor < 0 || extractiveFloor > 1) throw new Error('MIN_EXTRACTIVE_COVERAGE must be between 0 and 1.');
  const semanticMode = env.SEMANTIC_SEARCH || 'auto';
  if (!['auto', 'on', 'off'].includes(semanticMode)) throw new Error('SEMANTIC_SEARCH must be auto, on or off.');
  if (semanticMode === 'on' && (!key || mode !== 'model')) throw new Error('Semantic search requires model mode and an API key.');
  return Object.freeze({ root: ROOT, corpusDir: path.resolve(ROOT, env.CORPUS_DIR || 'vendor/op05/corpus'),
    dataDir: path.resolve(ROOT, env.DATA_DIR || 'runtime'), host, port: integer(env, 'PORT', 4600, 1, 65535),
    mode, key, model, baseUrl, extraHeaders, extractiveFloor, authMode, tokens: Object.freeze(tokens), runnerToken: env.RUNNER_TOKEN || '', adminToken: env.ADMIN_TOKEN || '',
    timeoutMs: integer(env, 'LLM_TIMEOUT_MS', 9000, 100, 120000), contextChars: integer(env, 'MAX_CONTEXT_CHARS', 3600, 500, 20000),
    outputTokens: integer(env, 'MAX_OUTPUT_TOKENS', 650, 100, 4000), concurrency: integer(env, 'MAX_CONCURRENCY', 12, 1, 64),
    retrieval: env.RETRIEVAL_MODE === 'baseline' ? 'baseline' : 'hybrid', cacheSize: integer(env, 'CACHE_SIZE', 256, 0, 10000),
    semanticSearch: semanticMode !== 'off' && mode === 'model' && !!key && env.RETRIEVAL_MODE !== 'baseline',
    semanticCacheDir: path.resolve(ROOT, env.SEMANTIC_CACHE_DIR || path.join(env.DATA_DIR || 'runtime', 'semantic')),
  });
}
