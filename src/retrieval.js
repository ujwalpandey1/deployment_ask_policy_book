import { canRead, normalize } from './util.js';
import { chunkKey } from './semantic.js';

const STOP = new Set('a an the is are was were be been being to of and or in on at for from by as with under what which who when where how does do did can could should would may must will shall it its that this these those their there then than such have has had any all both each per according please tell me about explain following whether if into not no more less before after between within based set out so'.split(' '));
const SYNONYMS = Object.freeze({ kyc: ['identity', 'verification'], amc: ['asset', 'management', 'company'], fpi: ['foreign', 'portfolio', 'investor'], aif: ['alternative', 'investment', 'fund'], sent: ['send', 'sending'], waive: ['waiver'], waivers: ['waive', 'fee'], hardship: ['plan'], postpone: ['reschedule'], instalment: ['installment'], upfront: ['advance'], cap: ['limit', 'maximum'], ceiling: ['maximum', 'limit'], mandatory: ['required'], allowed: ['permitted'], cancel: ['cancellation'], complaint: ['dispute'], deadline: ['days', 'period'], networth: ['net', 'worth'] });

function stem(word) {
  if (word.length > 5 && word.endsWith('ies')) return `${word.slice(0, -3)}y`;
  if (word.length > 5 && word.endsWith('ing')) return word.slice(0, -3);
  if (word.length > 4 && word.endsWith('s') && !word.endsWith('ss')) return word.slice(0, -1);
  return word;
}
export function tokenize(text, expand = false) {
  const words = normalize(text).match(/[\p{L}\p{N}]+/gu) || [];
  const tokens = words.filter(w => !STOP.has(w));
  if (expand) for (const w of words) tokens.push(...(SYNONYMS[w] || []));
  return tokens.map(stem);
}
const counts = tokens => {
  const map = new Map();
  for (const token of tokens) map.set(token, (map.get(token) || 0) + 1);
  return map;
};

function chunks(passage) {
  if (passage.text.length <= 2300) return [{ ...passage, start: 0 }];
  const result = [];
  let start = 0;
  while (start < passage.text.length) {
    let end = Math.min(passage.text.length, start + 2100);
    if (end < passage.text.length) {
      const boundary = passage.text.lastIndexOf('\n', end);
      if (boundary > start + 1000) end = boundary;
    }
    result.push({ ...passage, text: passage.text.slice(start, end), start });
    if (end === passage.text.length) break;
    start = Math.max(start + 1, end - 220);
  }
  return result;
}

export class Retriever {
  constructor(corpus, { mode = 'hybrid', previous = null } = {}) {
    this.corpus = corpus; this.mode = mode; this.reused = 0;
    this.lexemes = new Map();
    this.entries = corpus.passages.flatMap(chunks).map(passage => {
      const cacheKey = `${passage.hash}:${passage.start}:${passage.text.length}`;
      let tf = previous?.lexemes.get(cacheKey);
      if (tf) this.reused++;
      else tf = counts(tokenize(passage.text));
      this.lexemes.set(cacheKey, tf);
      const doc = corpus.documents.get(passage.doc_id);
      return { passage, doc, tf, length: [...tf.values()].reduce((a, b) => a + b, 0), titleTokens: new Set(tokenize(doc.title)) };
    });
    this.df = new Map();
    for (const e of this.entries) for (const word of e.tf.keys()) this.df.set(word, (this.df.get(word) || 0) + 1);
    this.average = this.entries.reduce((n, e) => n + e.length, 0) / this.entries.length;
    this.idf = word => Math.log(1 + (this.entries.length - (this.df.get(word) || 0) + 0.5) / ((this.df.get(word) || 0) + 0.5));
    for (const e of this.entries) e.norm = Math.sqrt([...e.tf].reduce((n, [word, tf]) => n + ((1 + Math.log(tf)) * this.idf(word)) ** 2, 0));
    this.documentTerms = new Map([...corpus.documents.values()].map(doc => {
      const tf = counts(tokenize(doc.text));
      const norm = Math.sqrt([...tf].reduce((n, [word, f]) => n + ((1 + Math.log(f)) * this.idf(word)) ** 2, 0));
      return [doc.doc_id, { tf, norm }];
    }));
  }

  rank(question, asOf, semanticScores = null) {
    const original = [...new Set(tokenize(question))];
    const expanded = [...new Set(tokenize(question, true))];
    const qNorm = Math.sqrt(original.reduce((n, word) => n + this.idf(word) ** 2, 0));
    const qWeight = original.reduce((n, word) => n + this.idf(word), 0) || 1;
    const priors = new Map([...this.documentTerms].map(([id, terms]) => [id, original.reduce((n, word) => n + (terms.tf.has(word) ? (1 + Math.log(terms.tf.get(word))) * this.idf(word) ** 2 : 0), 0) / (terms.norm * qNorm || 1)]));
    const maxPrior = Math.max(...priors.values(), 0.001);
    const namedRegulationYear = /(?:regulations?|directions?)\s*[,\s]*(\d{4})\b/i.exec(question)?.[1];
    const scored = this.entries.filter(e => this.corpus.validOn(e.doc, asOf)).map(e => {
      let bm25 = 0, dot = 0, matched = 0, coverage = 0, title = 0;
      for (const word of expanded) {
        const f = e.tf.get(word) || 0;
        const weight = original.includes(word) ? 1 : 0.32;
        if (f) bm25 += weight * this.idf(word) * f * 2.2 / (f + 1.2 * (0.25 + 0.75 * e.length / this.average));
      }
      for (const word of original) {
        const f = e.tf.get(word) || 0;
        if (f) { dot += (1 + Math.log(f)) * this.idf(word) ** 2; matched++; coverage += this.idf(word); }
        if (e.titleTokens.has(word)) title++;
      }
      const cosine = e.norm && qNorm ? dot / (e.norm * qNorm) : 0;
      const normalizedText = normalize(e.passage.text);
      let phrase = 0;
      for (const match of question.matchAll(/['“"]([^'”"]{4,80})['”"]/g)) if (normalizedText.includes(normalize(match[1]))) phrase += 1;
      const titleMatch = original.length ? title / original.length : 0;
      const documentPrior = this.mode === 'hybrid' ? 0.5 * priors.get(e.doc.doc_id) / maxPrior : 0;
      const namedYearBonus = this.mode === 'hybrid' && namedRegulationYear && e.doc.doc_id.startsWith(`SEBI_${namedRegulationYear}_`) ? 0.5 : 0;
      return { ...e, bm25: bm25 * (1 + 0.18 * titleMatch + documentPrior + namedYearBonus) + phrase * 2, cosine, coverage: coverage / qWeight, matched,
        semantic: semanticScores?.get(chunkKey(e)) ?? null, score: 0 };
    }).filter(e => e.bm25 > 0 || (e.semantic !== null && e.semantic >= 0.25));
    if (this.mode === 'baseline') return scored.sort((a, b) => b.cosine - a.cosine).map(e => ({ ...e, score: e.cosine }));
    const byBM = scored.filter(e => e.bm25 > 0).sort((a, b) => b.bm25 - a.bm25);
    const byCos = scored.filter(e => e.cosine > 0).sort((a, b) => b.cosine - a.cosine);
    byBM.forEach((e, i) => { e.score += 1 / (40 + i + 1); });
    byCos.forEach((e, i) => { e.score += 0.8 / (40 + i + 1); });
    // Rank alone exaggerates an incidental one-word match. Without this
    // reliability weight, two weak lexical votes bury a strong semantic-only
    // candidate—the exact failure seen on natural-language paraphrases.
    if (semanticScores) for (const e of scored) e.score *= Math.min(1, e.matched / 3) * Math.min(1, e.coverage / 0.40);
    if (semanticScores) scored.filter(e => e.semantic >= 0.25).sort((a, b) => b.semantic - a.semantic)
      .forEach((e, i) => { e.score += 2 / (40 + i + 1); });
    return scored.sort((a, b) => b.score - a.score || b.coverage - a.coverage);
  }

  retrieve(question, role, asOf, limit = 6, semanticScores = null) {
    const ranked = this.rank(question, asOf, semanticScores);
    const allowed = ranked.filter(e => canRead(role, e.doc.role));
    const top = ranked[0];
    const bestAllowed = allowed[0];
    // Only the boolean leaves this sealed ranking boundary. Restricted text,
    // names, IDs, counts, and scores never enter the generator or its trace.
    const lexicalBlocked = !!top && !canRead(role, top.doc.role) && top.matched >= 2
      && (top.coverage >= 0.23 || (!bestAllowed && top.cosine >= 0.08))
      && (!bestAllowed || top.bm25 >= bestAllowed.bm25 * 1.05 || top.cosine >= bestAllowed.cosine * 1.25);
    const semanticRanked = semanticScores ? [...ranked].sort((a, b) => b.semantic - a.semantic) : [];
    const semanticTop = semanticRanked[0], semanticAllowed = semanticRanked.find(e => canRead(role, e.doc.role));
    const semanticBlocked = !!semanticTop && !canRead(role, semanticTop.doc.role) && semanticTop.semantic >= 0.40
      && (!semanticAllowed || semanticTop.semantic - semanticAllowed.semantic >= 0.04);
    const blocked = lexicalBlocked || semanticBlocked;
    const sufficient = !!bestAllowed && ((bestAllowed.matched >= 2 && bestAllowed.coverage >= 0.23 && bestAllowed.cosine >= 0.08)
      || (semanticScores && bestAllowed.semantic >= 0.30));
    const seen = new Set();
    const seenText = new Set();
    const hits = [];
    // Protect two semantic candidates from keyword-heavy boilerplate. Fusion
    // alone can otherwise rank a document's title/date above its actual rule.
    const candidates = semanticScores && bestAllowed
      ? [bestAllowed, ...semanticRanked.filter(e => canRead(role, e.doc.role) && e.semantic >= 0.30).slice(0, 2), ...allowed] : allowed;
    if (!blocked) for (const entry of candidates) {
      const text = normalize(entry.passage.text);
      if (seen.has(entry.passage.passage_id) || (semanticScores && seenText.has(text)) || (hits.length && entry.bm25 < bestAllowed.bm25 * 0.28 && (!semanticScores || entry.semantic < 0.30))) continue;
      seen.add(entry.passage.passage_id); hits.push(entry);
      seenText.add(text);
      if (hits.length === limit) break;
    }
    return { blocked, sufficient, hits: blocked ? [] : hits, method: semanticScores ? 'semantic+lexical' : 'lexical' };
  }
}

// Select one contiguous window, never stitched sentences presented as a quote.
// A complete short passage is kept; long passages can focus on a later match.
function focusedWindow(text, size, question) {
  if (text.length <= size) return text;
  const terms = new Set(tokenize(question, true));
  const starts = [0];
  for (const match of text.matchAll(/\n+|[.!?]\s+/g)) if (match.index + match[0].length < text.length - size / 2) starts.push(match.index + match[0].length);
  let chosen = '', best = -1;
  for (const start of starts) {
    let end = Math.min(text.length, start + size);
    if (end < text.length) {
      const boundary = Math.max(text.lastIndexOf('. ', end - 1), text.lastIndexOf('\n', end - 1));
      if (boundary > start + Math.min(200, size / 2)) end = boundary + 1;
      else { const word = text.lastIndexOf(' ', end); if (word > start + size / 2) end = word; }
    }
    const window = text.slice(start, end), tokens = new Set(tokenize(window));
    const score = [...terms].reduce((n, t) => n + (tokens.has(t) ? 1 : 0), 0);
    if (score > best) { chosen = window; best = score; }
  }
  return chosen;
}

export function packEvidence(hits, budget = 3600, { question = '', balanced = false } = {}) {
  const evidence = [];
  let remaining = budget;
  for (const [i, hit] of hits.entries()) {
    if (remaining < 120) break;
    let text = hit.passage.text;
    if (balanced) {
      // Reserve useful space for the next two sources so one long result cannot
      // consume the whole prompt. Reclaim unused space from short passages.
      const reserve = hits.slice(i + 1, i + 3).reduce((n, next) => n + Math.min(next.passage.text.length, Math.floor(budget * 0.20)), 0);
      const allowance = Math.min(remaining, Math.max(Math.min(remaining, 500), remaining - reserve));
      text = focusedWindow(text, allowance, question);
    } else if (text.length > remaining) {
      // Never splice noncontiguous text into a purported quotation.
      let end = Math.min(text.length, remaining);
      const boundary = Math.max(text.lastIndexOf('. ', end), text.lastIndexOf('\n', end));
      if (boundary > Math.min(200, end / 2)) end = boundary + 1;
      text = text.slice(0, end);
    }
    if (!text.trim()) continue;
    evidence.push(Object.freeze({ id: `E${evidence.length + 1}`, doc_id: hit.doc.doc_id, section: hit.passage.passage_id,
      text, title: hit.doc.title, effective_date: hit.doc.effective_date, role: hit.doc.role,
      coverage: Math.round(hit.coverage * 1000) / 1000, score: hit.score }));
    remaining -= text.length;
  }
  return evidence;
}
