const $ = selector => document.querySelector(selector);
const icon = name => `<svg class="icon" aria-hidden="true"><use href="#i-${name}"/></svg>`;
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const state = { view: 'ask', role: 'ops', asOf: new Date().toISOString().slice(0, 10), meta: null, result: null, history: [], busy: false, token: '', scope: 0, controller: null, filter: 'All', docs: [] };
const titles = { ask: 'Ask the book', library: 'Source library', timeline: 'Policy timeline', assurance: 'Assurance lab', audit: 'Audit trail' };
const roleName = () => ({ ops: 'Operations', public: 'Public access', legal: 'Legal & compliance' }[state.role]);
const shortDate = date => new Date(`${date}T12:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
const scopeQuery = () => `role=${state.role}&as_of=${state.asOf}`;
const niceTitle = doc => doc.title.replace(/^RBI (?:Auction of |Reserve Ba |Master Dir |Issuance C )/i, '').replace(/^Securities and exchange board of india /i, 'SEBI · ').replace(/^Harbour servicing policy \(internal\)$/i, 'Harbour servicing policy');

async function api(url, options = {}) {
  const response = await fetch(url, { ...options, headers: { ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...(state.token ? { Authorization: `Bearer ${state.token}` } : {}), ...options.headers } });
  const data = await response.json();
  if (!response.ok) {
    if (response.status === 401 && !$('#credential-dialog').open) $('#credential-dialog').showModal();
    throw new Error(data.error?.message || 'Could not complete this request.');
  }
  return data;
}

function toast(message) {
  $('#toast').textContent = message;
  $('#toast').classList.add('visible');
  clearTimeout(toast.timer); toast.timer = setTimeout(() => $('#toast').classList.remove('visible'), 3200);
}

function heading(eyebrow, title, description, aside = '') {
  return `<div class="page-heading"><div><span class="eyebrow">${eyebrow}</span><h1>${title}</h1><p>${description}</p></div>${aside ? `<span class="heading-aside">${aside}</span>` : ''}</div>`;
}

function formatText(text) {
  return text.split(/\n\s*\n/).map(block => {
    const clean = esc(block).replace(/^#{1,6}\s+/gm, '').replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>').replace(/`([^`]+)`/g, '<code>$1</code>');
    if (/^\s*- /m.test(block)) return `<ul>${clean.split(/\n(?=- )/).map(line => `<li>${line.replace(/^- /, '').replace(/\n/g, '<br>')}</li>`).join('')}</ul>`;
    return `<p>${clean.replace(/\n/g, '<br>')}</p>`;
  }).join('');
}

const prompts = [
  { icon: 'layers', tag: 'INTERNAL POLICY', title: 'What are the limits for fee waivers?', sub: 'Check thresholds & escalation', question: 'What are the limits and conditions for fee waivers?' },
  { icon: 'clock', tag: 'PAYMENTS', title: 'Can I schedule a payment 90 days ahead?', sub: 'Understand what is permitted', question: 'Can I schedule a new payment 90 days ahead? What are the payment limits?' },
  { icon: 'shield', tag: 'CUSTOMER CARE', title: 'Who is eligible for a hardship plan?', sub: 'Find conditions & exceptions', question: 'What are the eligibility conditions and term limits for hardship plans?' },
  { icon: 'doc', tag: 'REGULATORY', title: 'What is the minimum corpus for an AIF?', sub: 'Explore the regulator rulebook', question: 'What is the minimum corpus requirement for each scheme of an Alternative Investment Fund? Does it differ for social impact funds?' },
];

function bookCard() {
  const m = state.meta;
  return `<div class="book-card"><div class="book-card-header"><span class="book-card-icon">${icon('book')}</span><div><h2>Your policy book</h2><p>One place. Every source.</p></div><span class="online-badge"><span class="ready-dot"></span>Ready</span></div>
    <div class="book-stats"><div class="book-stat"><strong>${m?.documents ?? '—'}</strong><span>accessible documents</span></div><div class="book-stat"><strong>${m?.passages ?? '—'}</strong><span>source passages</span></div></div>
    <div class="source-group-list">${[['RBI', 'RBI circulars & directions', 'R'], ['SEBI', 'SEBI regulations', 'S'], ['Internal', 'Harbour policies', 'H']].map(([key, label, initial]) => `<div class="source-group"><span class="authority-icon">${initial}</span><span>${label}</span><span class="count">${m?.authorities[key] ?? '—'}</span></div>`).join('')}</div>
    <div class="book-card-footer"><span>${icon('lock')} ${esc(roleName())} scope</span><button data-view="library">View sources ${icon('arrow')}</button></div></div>`;
}

function principles() {
  return `<div class="principles"><h3>A little less guesswork.</h3>${[
    ['doc', 'Evidence you can inspect', 'Exact passages, with a link to the source section.'],
    ['clock', 'The right rule, at the right time', 'Effective dates and superseding versions checked.'],
    ['shield', 'Your permissions come first', 'Restricted passages stay outside your answer.'],
  ].map(([i, title, text]) => `<div class="principle">${icon(i)}<div><strong>${title}</strong><p>${text}</p></div></div>`).join('')}</div>
  <div class="mode-note">${icon('info')}<div><strong>${state.meta?.mode === 'model' ? 'Model-assisted answers' : 'Source extract mode'}</strong><br>${state.meta?.mode === 'model' ? 'Answers use a budget model and verified source quotes. Inspect evidence before acting.' : 'Read the original policy wording. Configure a model for synthesized answers and reasoning.'}</div></div>`;
}

function renderAsk() {
  $('#page').innerHTML = heading('YOUR POLICY, IN PLAIN SIGHT', 'Ask the policy book.', 'From a question to a clear answer. With the evidence to back it up.', `${icon('shield')} Grounded in your sources`)
    + `<div class="ask-layout"><section class="ask-main" aria-label="Ask a policy question"><form id="ask-form" class="composer"><div class="composer-top">${icon('spark')} What would you like to know?</div><textarea id="question" aria-label="Your policy question" maxlength="4000" placeholder="Ask about a policy, a limit, or a rule that needs a second look…" required></textarea><div class="composer-bottom"><span class="composer-hint">${icon('lock')} ${esc(roleName())} <span>·</span> ⌘ Enter to ask</span><button class="primary-button" id="ask-button" type="submit">Ask the book ${icon('up')}</button></div></form><div class="composer-note">${icon('info')} Answers use the released policy book. This workspace does not monitor live regulatory changes.</div><div id="answer-region" aria-live="polite"></div>
    <div id="suggestion-region"><p class="section-label">A good place to start</p><div class="suggestions">${prompts.map((p, i) => `<button class="suggestion" data-prompt="${i}"><div class="suggestion-top"><span class="suggestion-icon">${icon(p.icon)}</span><span class="suggestion-tag">${p.tag}</span>${icon('arrow').replace('class="icon"', 'class="icon suggestion-arrow"')}</div><span class="suggestion-title">${p.title}</span><span class="suggestion-sub">${p.sub}</span></button>`).join('')}</div></div>
    <div class="recent-area"><div class="recent-title"><p class="section-label">${icon('clock')} Recent in this session</p><span>ONLY IN THIS TAB</span></div><div id="recent-list"></div></div></section><aside class="context-panel" id="context-panel" aria-label="Policy context">${bookCard()}${principles()}</aside></div>`;
  $('#ask-form').addEventListener('submit', submitQuestion);
  $('#question').addEventListener('keydown', event => { if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) { event.preventDefault(); $('#ask-form').requestSubmit(); } });
  renderRecent();
  if (state.result) { $('#question').value = state.result.question; renderAnswer(state.result.answer); }
}

function renderRecent() {
  const target = $('#recent-list'); if (!target) return;
  target.innerHTML = state.history.length ? state.history.slice(0, 4).map((h, i) => `<button class="recent-item" data-history="${i}">${icon('doc')}<span>${esc(h.question)}</span>${icon('chevron')}</button>`).join('') : `<div class="empty-recent">${icon('clock')}Your questions will appear here. Start with something on your mind.</div>`;
}

async function submitQuestion(event) {
  event?.preventDefault();
  const question = $('#question')?.value.trim();
  if (!question || state.busy) return;
  const scope = state.scope;
  state.busy = true; state.controller = new AbortController();
  $('#ask-button').disabled = true;
  $('#answer-region').innerHTML = `<div class="loading-card" role="status"><div class="loading-head"><span class="spinner"></span>Finding the right passage in your book…</div><div class="skeleton"></div><div class="skeleton"></div><div class="skeleton short"></div></div>`;
  $('#suggestion-region').hidden = true;
  try {
    const result = await api('/api/ask', { method: 'POST', signal: state.controller.signal, body: JSON.stringify({ id: crypto.randomUUID(), question, role: state.role, as_of: state.asOf }) });
    if (state.scope !== scope) return;
    state.result = { question, answer: result };
    state.history.unshift(state.result); state.history = state.history.slice(0, 8);
    if (state.view === 'ask') { renderAnswer(result); renderRecent(); }
  } catch (error) {
    if (error.name !== 'AbortError' && state.scope === scope && $('#answer-region')) $('#answer-region').innerHTML = `<div class="error-card" role="alert"><strong>We couldn’t complete that answer.</strong><p>${esc(error.message)}</p></div>`;
  } finally {
    if (state.scope === scope) { state.busy = false; if ($('#ask-button')) $('#ask-button').disabled = false; }
  }
}

function renderAnswer(result) {
  const denied = result.status !== 'answered';
  const title = result.status === 'not_permitted' ? 'Access is required' : result.status === 'not_in_corpus' ? 'Not enough evidence in the book' : result.meta.mode === 'extractive' ? 'From your policy book' : 'An answer, with evidence';
  $('#answer-region').innerHTML = `<article class="answer-panel"><div class="answer-header"><span class="answer-state ${denied ? 'denied' : ''}">${icon(denied ? 'lock' : 'check')}${title}</span><span class="answer-meta">${Math.round(result.latency_ms)} ms · ${result.meta.mode === 'extractive' ? 'Source extract' : 'Model-assisted'}${result.meta.cache_hit ? ' · Cached' : ''}</span></div><div class="answer-body">${denied ? `<p>${esc(result.answer)}</p>` : result.statements.map(s => `<div>${formatText(s.text)}<p>${s.evidence_ids.map(id => `<button class="source-badge" data-evidence="${esc(id)}" aria-label="Open evidence ${esc(id)}">${esc(id)} ↗</button>`).join('')}</p></div>`).join('')}</div><div class="answer-footer"><span>${icon(denied ? 'shield' : 'check')} ${denied ? 'No source content disclosed' : `${result.citations.length} citation${result.citations.length === 1 ? '' : 's'} checked against source bytes`}</span><div class="answer-tools"><button class="text-button" data-action="copy">${icon('copy')} Copy</button><button class="text-button" data-action="export">${icon('download')} Export</button></div></div></article>
    <details class="trace"><summary>${icon('layers')} How this answer was checked <span>↗</span></summary>${result.meta.trace.map(t => `<div class="trace-row"><div><strong>${esc(t.stage)}</strong><p>${esc(t.detail)}</p></div><span>${t.ms} ms</span></div>`).join('')}<div class="trace-row"><div><strong>Audit receipt</strong><p class="monospace">${esc(result.meta.receipt?.hash || 'Unavailable')}</p></div><span>#${result.meta.receipt?.sequence || '—'}</span></div><p class="small">Quote checks establish provenance. Semantic correctness is evaluated separately.</p></details>`;
  if (result.meta.checks?.arithmetic_receipts_withheld) {
    $('.answer-footer').insertAdjacentHTML('beforebegin', `<div class="info-banner arithmetic-warning" role="note">${icon('info')}Arithmetic review needed: an unsupported calculation receipt was withheld. Check the numeric/date interpretation against the source.</div>`);
  }
  const usage = result.meta.usage;
  if (usage) $('.trace').insertAdjacentHTML('beforeend', `<div class="trace-row"><div><strong>Usage for this request</strong><p>${esc(usage.model || (result.meta.cache_hit ? 'Cached answer · no new model call' : 'No model call'))}<br>${usage.input_tokens ?? 'Unknown'} input · ${usage.output_tokens ?? 'Unknown'} output tokens · ${usage.calls ?? 'Unknown'} API calls</p></div><span>${usage.cost_usd === null ? 'Unknown spend' : `$${usage.cost_usd.toFixed(6)}`}</span></div>`);
  if (usage?.embeddings) $('.trace').insertAdjacentHTML('beforeend', `<div class="trace-row"><div><strong>Search usage (included above)</strong><p>${esc(usage.embeddings.model)} · ${usage.embeddings.input_tokens ?? 'Unknown'} input tokens<br>${usage.embeddings.calls ?? 'Unknown'} embedding calls · ${usage.calls === null ? 'Unknown' : usage.calls - (usage.embeddings.calls || 0)} answer-model calls</p></div><span>${usage.embeddings.cost_usd === null ? 'Unknown spend' : `$${usage.embeddings.cost_usd.toFixed(6)}`}</span></div>`);
  if (result.meta.refusal_reason && result.status === 'not_in_corpus') $('.answer-body').insertAdjacentHTML('beforeend', `<p class="small muted refusal-detail">${result.meta.refusal_reason === 'evidence_insufficient' ? 'The model checked the retrieved excerpts but could not support an answer. This does not prove the full book has no answer.' : 'Search did not find a strong enough match for this role and date. The answer model was not called.'} Include the policy topic and full context, or ask a policy owner to review.</p>`);
  for (const calculation of result.calculations || []) $('.trace').insertAdjacentHTML('beforeend', `<div class="trace-row"><div><strong>Checked arithmetic receipt</strong><p>${esc(calculation.operation)}(${calculation.operands.map(o => esc(o.value)).join(', ')}) = ${esc(calculation.result)} ${esc(calculation.unit)}${calculation.exact ? '' : ' · truncated to six decimals'}</p><p>Operation and source operands checked; interpretation still needs review.</p></div>${icon('check')}</div>`);
  $('#suggestion-region').hidden = true;
  $('#context-panel').classList.add('answer-context');
  $('#context-panel').innerHTML = bookCard() + (result.citations.length ? `<div class="evidence-heading"><h3>Your supporting evidence</h3>${result.citations.length} SOURCE${result.citations.length === 1 ? '' : 'S'}</div>${result.citations.map(c => `<button class="evidence-card" data-evidence="${esc(c.evidence_id)}"><div class="evidence-card-top"><span class="evidence-number">${esc(c.evidence_id)}</span><strong>${esc(niceTitle(c))}</strong></div><blockquote>${esc(c.quote)}</blockquote><div class="evidence-bottom"><span>${icon('check')} Verbatim checked</span><span>View passage ${icon('arrow')}</span></div></button>`).join('')}` : principles());
}

async function renderLibrary() {
  $('#page').innerHTML = heading('THE SOURCE OF EVERY ANSWER', 'A well-kept policy book.', 'Browse the documents available to your role. Open any section to read the original.')
    + `<div class="toolbar"><label class="search-box">${icon('search')}<input id="doc-search" type="search" placeholder="Search document titles…" aria-label="Search documents"></label><div class="filters">${['All', 'RBI', 'SEBI', 'Internal'].map(a => `<button class="filter ${a === state.filter ? 'active' : ''}" data-filter="${a}">${a}</button>`).join('')}</div></div><div class="library-grid" id="library-grid"><p class="muted">Loading your sources…</p></div>`;
  $('#doc-search').addEventListener('input', updateLibrary);
  const scope = state.scope;
  try {
    const response = await api(`/api/documents?${scopeQuery()}`);
    if (scope !== state.scope || state.view !== 'library') return;
    state.docs = response.documents; updateLibrary();
  } catch (error) { if ($('#library-grid')) $('#library-grid').innerHTML = `<div class="error-card">${esc(error.message)}</div>`; }
}

function updateLibrary() {
  const q = $('#doc-search')?.value.toLowerCase() || '';
  const docs = state.docs.filter(d => (state.filter === 'All' || d.authority === state.filter) && `${d.title} ${d.authority}`.toLowerCase().includes(q));
  $('#library-grid').innerHTML = docs.length ? docs.map(d => `<button class="document-card" data-doc="${esc(d.doc_id)}"><div class="doc-top"><span class="doc-icon">${icon(d.authority === 'Internal' ? 'lock' : 'doc')}</span><span class="tag ${d.state === 'historical' ? 'historical' : ''}">${esc(d.authority)} · ${esc(d.state)}</span></div><h3>${esc(niceTitle(d))}</h3><div class="doc-bottom"><span>${d.passage_count} sections · ${shortDate(d.effective_date)}</span>${icon('arrow')}</div></button>`).join('') : `<div class="library-empty">No accessible documents match your search.</div>`;
}

async function showSource(docId, section = '', asOf = state.asOf) {
  const sourceRequest = (showSource.sequence = (showSource.sequence || 0) + 1);
  const dialog = $('#source-dialog');
  $('#source-content').innerHTML = '<h2 id="source-title">Loading source…</h2>';
  if (!dialog.open) dialog.showModal();
  const scope = state.scope;
  try {
    const d = await api(`/api/documents/${encodeURIComponent(docId)}?role=${state.role}&as_of=${encodeURIComponent(asOf)}`);
    if (scope !== state.scope || !dialog.open || sourceRequest !== showSource.sequence) return;
    $('#source-content').innerHTML = `<h2 id="source-title">${esc(niceTitle(d))}</h2><div class="source-meta"><span class="tag">${esc(d.authority)}</span><span class="tag">${esc(d.role)} access</span><span class="tag">Effective ${shortDate(d.effective_date)}</span><span class="tag ${d.state === 'historical' ? 'historical' : ''}">${esc(d.state)}</span></div><p class="small muted">The text below is the indexed source. A quote’s wording is preserved, including any original formatting.</p>${d.passages.map(p => `<section class="source-section ${p.section === section ? 'current-section' : ''}" ${p.section === section ? 'id="selected-passage"' : ''}><h3>${esc(p.section.split('#').at(-1))}</h3><pre>${esc(p.text)}</pre></section>`).join('')}<div class="source-fingerprint">SHA-256 · original document bytes<code>${esc(d.sha256)}</code><p><a href="${esc(d.source_url)}" target="_blank" rel="noopener noreferrer">View corpus provenance ↗</a></p></div>`;
    if ($('#selected-passage')) $('#selected-passage').scrollIntoView({ block: 'center' });
  } catch (error) { if (scope === state.scope && dialog.open && sourceRequest === showSource.sequence) $('#source-content').innerHTML = `<h2 id="source-title">Source unavailable</h2><p>${esc(error.message)}</p>`; }
}

async function renderTimeline() {
  $('#page').innerHTML = heading('POLICY HAS A MEMORY', 'The rule, at that moment.', 'Compare answers across dates and inspect the effective dates in your book.')
    + `<div class="compare-card"><h2>Ask the same question. At two points in time.</h2><p>The same permission checks apply to both answers.</p><form id="compare-form" class="form-grid"><label class="form-label question-field">Your question<input id="compare-question" required maxlength="4000" placeholder="What are the payment scheduling limits?"></label><label class="form-label">First date<input id="before-date" type="date" value="2025-12-01" required></label><label class="form-label">Second date<input id="after-date" type="date" value="${state.asOf}" required></label><button class="primary-button" type="submit" id="compare-button">Compare ${icon('arrow')}</button></form><div id="compare-results"></div></div>
    <p class="section-label">Effective dates in your accessible sources</p><div class="info-banner">${icon('info')}These dates come from the released manifest. A newer date alone does not establish supersession; explicit version links control it.</div><div id="timeline-list" class="timeline-list"></div>`;
  $('#compare-form').addEventListener('submit', async event => {
    event.preventDefault(); const scope = state.scope; $('#compare-button').disabled = true;
    try {
      const result = await api('/api/compare', { method: 'POST', body: JSON.stringify({ question: $('#compare-question').value, role: state.role, before: $('#before-date').value, after: $('#after-date').value }) });
      if (scope !== state.scope || state.view !== 'timeline') return;
      $('#compare-results').innerHTML = `<div class="info-banner">${icon(result.changed ? 'refresh' : 'check')}${result.changed ? 'The answer differs across these dates. Review the underlying evidence.' : 'The answer is the same for both selected dates.'}</div><div class="compare-results">${[result.before, result.after].map(r => `<div class="comparison-box"><strong>${shortDate(r.meta.as_of)} · ${esc(r.status.replaceAll('_', ' '))}</strong>${formatText(r.answer)}${r.citations.map(c => `<button class="text-button" data-doc="${esc(c.doc_id)}" data-section="${esc(c.section)}" data-source-date="${esc(r.meta.as_of)}">Open source ${icon('arrow')}</button>`).join('')}</div>`).join('')}</div>`;
    } catch (error) { if ($('#compare-results')) $('#compare-results').innerHTML = `<div class="error-card">${esc(error.message)}</div>`; }
    finally { if ($('#compare-button')) $('#compare-button').disabled = false; }
  });
  const scope = state.scope;
  try {
    const { documents } = await api(`/api/documents?${scopeQuery()}`);
    if (scope !== state.scope || state.view !== 'timeline') return;
    const dates = [...new Set(documents.map(d => d.effective_date))].sort().reverse();
    $('#timeline-list').innerHTML = dates.map(date => `<div class="timeline-row"><time>${shortDate(date)}</time><div class="timeline-docs">${documents.filter(d => d.effective_date === date).map(d => `<button data-doc="${esc(d.doc_id)}">${esc(niceTitle(d))} ${d.supersedes.length ? ' · supersedes an earlier version' : ''} ↗</button>`).join('')}</div></div>`).join('');
  } catch (error) { toast(error.message); }
}

function renderAssurance() {
  $('#page').innerHTML = heading('TRUST IS SOMETHING YOU CAN CHECK', 'Look under the hood.', 'Explore the checks behind each answer, and test what happens when policy changes.')
    + `<div class="assurance-grid">${[
      ['doc', 'A quote is a source span.', 'The server constructs citations from selected evidence. Every returned quote is checked against its exact section and source document.'],
      ['shield', 'Access travels with the question.', 'Restricted evidence stays out of generation. Source inspection, answers and audit views each enforce requester permissions.'],
      ['refresh', 'A new book gets a new identity.', 'Source bytes and metadata identify the index. A reload validates the whole update before publishing it and invalidates old answers.'],
    ].map(([i, title, description]) => `<article class="assurance-card">${icon(i)}<h3>${title}</h3><p>${description}</p></article>`).join('')}</div>
    <div class="lab-card"><div class="lab-header"><div><span class="eyebrow">A SMALL, CONTROLLED EXPERIMENT</span><h2>What happens when the rules change?</h2><p>Six synthetic cases. A new version, an amendment, a withdrawal, and an access change.</p></div><button class="primary-button" data-action="lab" id="lab-button">Run rehearsal ${icon('arrow')}</button></div><div id="lab-results" class="lab-results"></div></div>
    <div class="info-banner">${icon('info')}This rehearsal uses a separate fictional policy book. It does not change your sources or establish a score on the private evaluation pack.</div>
    <div class="compare-card"><h2>What these checks do — and what remains to measure</h2><p>Verbatim evidence establishes provenance, not the correctness of an interpretation. The official judge must separately evaluate answer accuracy, citation support, contradiction and temporal questions. Full semantic access review and private freshness evaluation remain independent checks.</p><p class="monospace">Current corpus · ${esc(state.meta?.corpus_version || 'Loading…')}</p></div>`;
}

async function runRehearsal() {
  const scope = state.scope; $('#lab-button').disabled = true;
  try {
    const result = await api('/api/lab', { method: 'POST', body: JSON.stringify({ role: state.role }) });
    if (scope !== state.scope || state.view !== 'assurance') return;
    $('#lab-results').innerHTML = `<p class="section-label">${icon('check')} ${result.passed} of ${result.total} synthetic checks passed</p>${result.cases.map(c => `<div class="lab-result"><strong>${esc(c.name)}</strong><div><p>${esc(c.question)}</p><div class="change"><span>${esc(c.before.answer)}</span>${icon('arrow')}<span>${esc(c.after.answer)}</span></div></div>${icon(c.passed ? 'check' : 'close')}</div>`).join('')}`;
  } catch (error) { if ($('#lab-results')) $('#lab-results').innerHTML = `<div class="error-card">${esc(error.message)}</div>`; }
  finally { if ($('#lab-button')) $('#lab-button').disabled = false; }
}

async function renderAudit() {
  $('#page').innerHTML = heading('AN ANSWER LEAVES A RECORD', 'Nothing lost in the margins.', 'A durable record of requests, evidence checks, and usage. Sensitive question text is not stored.')
    + '<div id="audit-content"><p class="muted">Loading activity…</p></div>';
  const scope = state.scope;
  try {
    const { events, stats, window: windowLabel } = await api(`/api/audit?${scopeQuery()}`);
    if (scope !== state.scope || state.view !== 'audit') return;
    $('#audit-content').innerHTML = `<div class="stats-grid">${[[stats.requests, 'visible requests'], [stats.answered, 'answered'], [stats.refused, 'evidence / access refusals'], [stats.latency_p95_ms === null ? '—' : `${Math.round(stats.latency_p95_ms)} ms`, 'observed p95 latency']].map(([v, label]) => `<div class="metric-card"><strong>${v}</strong><span>${label}</span></div>`).join('')}</div><p class="small muted">${esc(windowLabel)} · observed local traffic, not a qualification benchmark</p><div class="table-container"><table><thead><tr><th>Receipt</th><th>Time</th><th>Decision</th><th>Scope</th><th>Evidence</th><th>Hash</th></tr></thead><tbody>${events.length ? events.map(e => `<tr><td>#${e.sequence}</td><td>${new Date(e.timestamp).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</td><td><span class="status-label ${e.kind === 'error' ? 'error' : e.status !== 'answered' ? 'refused' : ''}">${esc((e.status || e.code || 'error').replaceAll('_', ' '))}</span></td><td>${esc(e.role)}</td><td>${e.citations?.length ?? 0} citations${e.cache_hit ? ' · cached' : ''}</td><td><code>${esc(e.hash.slice(0, 16))}…</code></td></tr>`).join('') : '<tr><td colspan="6">No requests yet. Ask the policy book to create your first record.</td></tr>'}</tbody></table></div><div class="info-banner">${icon('shield')}Records form a SHA-256 hash chain verified on restart. Export and externally anchor the chain head to detect whole-log replacement or deletion.</div>`;
  } catch (error) { if ($('#audit-content')) $('#audit-content').innerHTML = `<div class="error-card">${esc(error.message)}</div>`; }
}

function navigate(view) {
  if (!Object.hasOwn(titles, view)) return;
  state.view = view; $('#breadcrumb').textContent = titles[view];
  document.querySelectorAll('.nav-item').forEach(el => { const active = el.dataset.view === view; el.classList.toggle('active', active); if (active) el.setAttribute('aria-current', 'page'); else el.removeAttribute('aria-current'); });
  $('#sidebar').classList.remove('open');
  ({ ask: renderAsk, library: renderLibrary, timeline: renderTimeline, assurance: renderAssurance, audit: renderAudit }[view])();
}

async function refreshScope() {
  state.scope++; state.controller?.abort(); state.busy = false; state.result = null; state.history = []; state.docs = [];
  if ($('#source-dialog').open) $('#source-dialog').close();
  $('#source-content').replaceChildren();
  const scope = state.scope;
  $('#index-status').textContent = 'Loading permitted sources';
  $('#page').innerHTML = '<div class="loading-card"><div class="loading-head"><span class="spinner"></span>Opening your policy book…</div></div>';
  try {
    const meta = await api(`/api/meta?${scopeQuery()}`);
    if (scope !== state.scope) return;
    state.meta = meta; $('#nav-count').textContent = meta.documents;
    $('#index-status').textContent = state.meta.retrieval === 'semantic+lexical' ? 'Semantic index ready' : 'Policy index ready';
    $('#session-mode').textContent = meta.auth_mode === 'demo' ? 'LOCAL DEMO' : 'AUTHENTICATED';
    $('#role').disabled = meta.auth_mode === 'tokens';
    navigate(state.view);
  } catch (error) {
    if (scope !== state.scope) return;
    state.meta = null; $('#nav-count').textContent = '—'; $('#index-status').textContent = 'Connection needed';
    $('#page').innerHTML = heading('YOUR POLICY WORKSPACE', 'Let’s open the book.', 'Connect to the service to get started.') + `<div class="error-card">${esc(error.message)}</div><button class="primary-button" data-action="retry">Retry connection ${icon('refresh')}</button>`;
  }
}

function exportAnswer() {
  if (!state.result) return;
  const blob = new Blob([JSON.stringify({ question: state.result.question, role: state.role, ...state.result.answer }, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob), anchor = document.createElement('a');
  anchor.href = url; anchor.download = `policy-answer-${state.result.answer.id}.json`; anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000); toast('Answer and evidence exported.');
}

document.addEventListener('click', async event => {
  const el = event.target.closest('button'); if (!el) return;
  if (el.dataset.view) { navigate(el.dataset.view); return; }
  if (el.dataset.prompt !== undefined) { $('#question').value = prompts[Number(el.dataset.prompt)].question; await submitQuestion(); return; }
  if (el.dataset.doc) { await showSource(el.dataset.doc, el.dataset.section, el.dataset.sourceDate); return; }
  if (el.dataset.evidence) { const c = state.result?.answer.citations.find(c => c.evidence_id === el.dataset.evidence); if (c) await showSource(c.doc_id, c.section); return; }
  if (el.dataset.filter) { state.filter = el.dataset.filter; document.querySelectorAll('.filter').forEach(b => b.classList.toggle('active', b.dataset.filter === state.filter)); updateLibrary(); return; }
  if (el.dataset.history !== undefined) { state.result = state.history[Number(el.dataset.history)]; $('#question').value = state.result.question; renderAnswer(state.result.answer); return; }
  switch (el.dataset.action) {
    case 'new': state.controller?.abort(); state.scope++; state.busy = false; state.result = null; navigate('ask'); $('#question').focus(); break;
    case 'menu': $('#sidebar').classList.toggle('open'); break;
    case 'close-source': $('#source-dialog').close(); break;
    case 'credentials': $('#credential-dialog').showModal(); break;
    case 'close-credentials': $('#credential-dialog').close(); break;
    case 'retry': await refreshScope(); break;
    case 'lab': await runRehearsal(); break;
    case 'export': exportAnswer(); break;
    case 'copy': try { await navigator.clipboard.writeText(state.result.answer.answer + '\n\n' + state.result.answer.citations.map(c => `[${c.evidence_id}] ${c.title}\n${c.section}\n${c.quote}`).join('\n\n')); toast('Answer and citations copied.'); } catch { toast('Clipboard unavailable. Use Export instead.'); } break;
  }
});

$('#role').addEventListener('change', () => { state.role = $('#role').value; refreshScope(); });
$('#as-of').value = state.asOf;
$('#as-of').addEventListener('change', () => { if ($('#as-of').value) { state.asOf = $('#as-of').value; refreshScope(); } });
$('#credential-form').addEventListener('submit', async event => {
  event.preventDefault(); state.token = $('#access-token').value.trim(); $('#access-token').value = ''; $('#credential-dialog').close();
  try { const meta = await api('/api/meta'); state.role = meta.role; $('#role').value = state.role; } catch (error) { toast(error.message); }
  await refreshScope();
});
document.addEventListener('keydown', event => { if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); if (state.view !== 'ask') navigate('ask'); $('#question')?.focus(); } });
for (const dialog of document.querySelectorAll('dialog')) dialog.addEventListener('click', event => { if (event.target === dialog) { const r = dialog.getBoundingClientRect(); if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) dialog.close(); } });
await refreshScope();
