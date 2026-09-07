import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { sha256 } from '../src/util.js';
import { loadConfig } from '../src/config.js';
import { labRows } from '../src/lab.js';

export async function temp() { return mkdtemp(path.join(os.tmpdir(), 'policy-atlas-test-')); }
export async function fixture(directory, updated = false, transform = rows => rows) {
  await mkdir(path.join(directory, 'text'), { recursive: true });
  const rows = transform(labRows(updated));
  const manifests = [], passages = [];
  for (const row of rows) {
    const section = `${row.doc_id}#s1`, text = `[${section}]\n${row.text}\n`;
    const { text: content, ...metadata } = row;
    const doc = { ...metadata, source_url: 'https://example.com/synthetic-policy', text_path: `text/${row.doc_id}.txt`, sha256: sha256(text) };
    await writeFile(path.join(directory, doc.text_path), text);
    manifests.push(doc); passages.push({ doc_id: doc.doc_id, passage_id: section, text: content });
  }
  await writeFile(path.join(directory, 'passages.jsonl'), passages.map(p => JSON.stringify(p)).join('\n') + '\n');
  await writeFile(path.join(directory, 'manifest.jsonl'), manifests.map(p => JSON.stringify(p)).join('\n') + '\n');
  return { manifests, passages };
}
export async function config(extra = {}) { return { ...loadConfig({ GENERATION_MODE: 'extractive', DATA_DIR: await temp() }), ...extra }; }
export const query = (extra = {}) => ({ id: 'test-request', question: 'How many days ahead may one-off payments be scheduled?', role: 'ops', as_of: '2026-09-07', ...extra });
