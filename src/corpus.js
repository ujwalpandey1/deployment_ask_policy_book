import { readFile, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { canRead, isDate, normalize, sha256, stableStringify, today } from './util.js';

const MAX_FILE = 8 * 1024 * 1024;
const safeId = value => typeof value === 'string' && /^[A-Za-z0-9._-]+$/.test(value);

async function safeRead(root, relative) {
  if (typeof relative !== 'string' || !relative || path.isAbsolute(relative)) throw new Error('Invalid corpus text_path.');
  const target = await realpath(path.resolve(root, relative));
  const rel = path.relative(root, target);
  if (rel.startsWith('..') || path.isAbsolute(rel)) throw new Error('Corpus path escapes the corpus directory.');
  if ((await stat(target)).size > MAX_FILE) throw new Error('Corpus file exceeds 8 MB.');
  return readFile(target);
}

function parseRows(bytes, label) {
  return bytes.toString('utf8').split(/\r?\n/).filter(line => line.trim()).map((line, n) => {
    try {
      const row = JSON.parse(line);
      if (!row || typeof row !== 'object' || Array.isArray(row)) throw new Error();
      return row;
    } catch { throw new Error(`Invalid ${label} row ${n + 1}.`); }
  });
}

export class Corpus {
  constructor(documents, passages, fingerprint, indexingMs = 0) {
    this.documents = documents;
    this.passages = Object.freeze(passages);
    this.fingerprint = fingerprint;
    this.indexingMs = indexingMs;
    this.loadedAt = new Date().toISOString();
    this.successors = new Map();
    for (const doc of documents.values()) {
      for (const old of doc.supersedes) {
        if (old === doc.doc_id) throw new Error('A document cannot supersede itself.');
        if (documents.has(old) && documents.get(old).effective_date > doc.effective_date) throw new Error('A superseding document predates its predecessor.');
        this.successors.set(old, [...(this.successors.get(old) || []), doc]);
      }
    }
    const visiting = new Set(), visited = new Set();
    const visit = id => {
      if (visiting.has(id)) throw new Error('Cycle in supersession metadata.');
      if (visited.has(id)) return;
      visiting.add(id);
      for (const next of this.successors.get(id) || []) visit(next.doc_id);
      visiting.delete(id); visited.add(id);
    };
    for (const id of documents.keys()) visit(id);
  }

  validOn(doc, asOf) {
    if (doc.effective_date > asOf) return false;
    if (doc.valid_until && doc.valid_until <= asOf) return false;
    if (doc.withdrawn_date && doc.withdrawn_date <= asOf) return false;
    if (doc.status === 'withdrawn' && !doc.withdrawn_date) return false;
    // A withdrawal of a successor never revives an older version implicitly.
    return !(this.successors.get(doc.doc_id) || []).some(next => next.effective_date <= asOf);
  }

  metadata(doc, role, asOf = today()) {
    if (!canRead(role, doc.role)) return null;
    return {
      doc_id: doc.doc_id, title: doc.title, source_url: doc.source_url,
      effective_date: doc.effective_date, role: doc.role, sha256: doc.sha256,
      authority: doc.authority || (doc.doc_id.startsWith('HARBOUR') ? 'Internal' : doc.doc_id.startsWith('RBI') ? 'RBI' : doc.doc_id.startsWith('SEBI') ? 'SEBI' : 'Other'),
      state: this.validOn(doc, asOf) ? 'current' : doc.effective_date > asOf ? 'upcoming' : 'historical',
      supersedes: doc.supersedes.filter(id => this.documents.has(id) && canRead(role, this.documents.get(id).role)),
      passage_count: doc.passageIds.length,
    };
  }

  visibleDocuments(role, asOf = today()) {
    return [...this.documents.values()].filter(doc => canRead(role, doc.role)).map(doc => this.metadata(doc, role, asOf));
  }

  getDocument(id, role, asOf = today()) {
    const doc = this.documents.get(id);
    if (!doc || !canRead(role, doc.role)) return null;
    return { ...this.metadata(doc, role, asOf), passages: this.passages.filter(p => p.doc_id === id).map(p => ({ section: p.passage_id, text: p.text })) };
  }
}

export async function loadCorpus(directory) {
  const started = performance.now();
  const root = await realpath(directory);
  const [manifestBytes, passageBytes] = await Promise.all([safeRead(root, 'manifest.jsonl'), safeRead(root, 'passages.jsonl')]);
  const rows = parseRows(manifestBytes, 'manifest');
  if (!rows.length || rows.length > 10000) throw new Error('Corpus must contain 1–10000 documents.');
  const documents = new Map();
  for (const row of rows) {
    if (!safeId(row.doc_id) || documents.has(row.doc_id) || typeof row.title !== 'string' || !row.title.trim()
      || !['public', 'ops', 'legal'].includes(row.role) || !isDate(row.effective_date)
      || !/^[a-f0-9]{64}$/.test(row.sha256) || !Array.isArray(row.supersedes) || row.supersedes.some(id => !safeId(id))) throw new Error('Invalid or duplicate corpus document metadata.');
    for (const key of ['valid_until', 'withdrawn_date']) if (row[key] !== undefined && (!isDate(row[key]) || row[key] < row.effective_date)) throw new Error(`Invalid ${key}.`);
    if (row.status !== undefined && !['active', 'withdrawn', 'superseded'].includes(row.status)) throw new Error('Unknown document status.');
    let url;
    try { url = new URL(row.source_url); } catch { throw new Error('Invalid source URL.'); }
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) throw new Error('Unsafe source URL.');
    const bytes = await safeRead(root, row.text_path);
    if (sha256(bytes) !== row.sha256) throw new Error(`Source checksum mismatch for ${row.doc_id}.`);
    const text = bytes.toString('utf8');
    documents.set(row.doc_id, { ...row, supersedes: Object.freeze([...row.supersedes]), text, normalized: normalize(text), passageIds: [] });
  }
  const ids = new Set();
  const passages = parseRows(passageBytes, 'passages').map(row => {
    const doc = documents.get(row.doc_id);
    if (!doc || typeof row.passage_id !== 'string' || !row.passage_id.startsWith(`${row.doc_id}#`) || !/^.+#[A-Za-z0-9._-]+$/.test(row.passage_id)
      || ids.has(row.passage_id) || typeof row.text !== 'string' || !row.text.trim()) throw new Error('Invalid, missing or duplicate corpus passage.');
    const marker = `[${row.passage_id}]`;
    const start = doc.text.indexOf(marker);
    const next = doc.text.indexOf(`\n[${row.doc_id}#`, start + marker.length);
    if (start < 0 || !normalize(doc.text.slice(start + marker.length, next < 0 ? undefined : next)).includes(normalize(row.text))) throw new Error(`Passage is not in its named source section: ${row.passage_id}.`);
    ids.add(row.passage_id); doc.passageIds.push(row.passage_id);
    return Object.freeze({ passage_id: row.passage_id, doc_id: row.doc_id, text: row.text, hash: sha256(row.text) });
  });
  if (!passages.length) throw new Error('Corpus has no passages.');
  for (const doc of documents.values()) {
    if (!doc.passageIds.length) throw new Error('A document has no indexable passages.');
    Object.freeze(doc.passageIds); Object.freeze(doc);
  }
  const [manifestAfter, passagesAfter] = await Promise.all([safeRead(root, 'manifest.jsonl'), safeRead(root, 'passages.jsonl')]);
  if (!manifestBytes.equals(manifestAfter) || !passageBytes.equals(passagesAfter)) throw new Error('Corpus changed while loading; retry after the update is complete.');
  const fingerprint = sha256(stableStringify({ manifest: sha256(manifestBytes), passages: sha256(passageBytes), sources: [...documents.values()].map(d => [d.doc_id, d.sha256]).sort() }));
  return new Corpus(documents, passages, fingerprint, performance.now() - started);
}
