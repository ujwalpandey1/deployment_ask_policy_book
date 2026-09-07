import { createHash, randomUUID } from 'node:crypto';

export const ROLES = Object.freeze({ public: 0, ops: 1, legal: 2 });
export const sha256 = value => createHash('sha256').update(value).digest('hex');
export const normalize = value => value.normalize('NFKC').replace(/\u00ad/g, '').replace(/\s+/g, ' ').trim().toLowerCase();
export const today = () => new Date().toISOString().slice(0, 10);
export const requestId = () => randomUUID();
export const canRead = (role, documentRole) => Object.hasOwn(ROLES, role) && Object.hasOwn(ROLES, documentRole) && ROLES[role] >= ROLES[documentRole];
export const percent = (a, b) => b ? Math.round(a / b * 10000) / 10000 : null;
export const percentile = (values, p) => values.length ? [...values].sort((a, b) => a - b)[Math.max(0, Math.ceil(values.length * p) - 1)] : null;

export class AppError extends Error {
  constructor(code, message, status = 400, usage = null) {
    super(message); this.code = code; this.status = status; this.usage = usage;
  }
}

export function isDate(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
    && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
}

export function validateQuestion(body, { strict = true } = {}) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new AppError('invalid_request', 'Send a JSON object.');
  if (strict && Object.keys(body).some(k => !['id', 'question', 'role', 'as_of'].includes(k))) throw new AppError('invalid_request', 'Only id, question, role and as_of are accepted.');
  if (typeof body.id !== 'string' || !body.id.trim() || body.id.length > 180 || /[\u0000-\u001f]/.test(body.id)) throw new AppError('invalid_id', 'id must be a non-empty string, up to 180 characters.');
  if (typeof body.question !== 'string' || !body.question.trim() || body.question.length > 4000) throw new AppError('invalid_question', 'question must contain between 1 and 4000 characters.');
  if (!Object.hasOwn(ROLES, body.role)) throw new AppError('invalid_role', 'role must be public, ops or legal.');
  if (body.as_of !== undefined && !isDate(body.as_of)) throw new AppError('invalid_date', 'as_of must be a valid YYYY-MM-DD date.');
  return { id: body.id, question: body.question.trim(), role: body.role, as_of: body.as_of ?? today() };
}

export async function readJsonl(filename) {
  const { readFile } = await import('node:fs/promises');
  return (await readFile(filename, 'utf8')).split(/\r?\n/).filter(line => line.trim()).map((line, i) => {
    try { return JSON.parse(line); } catch { throw new Error(`Invalid JSONL at ${filename}:${i + 1}`); }
  });
}

export function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}
