import { mkdir, readFile, open, unlink } from 'node:fs/promises';
import path from 'node:path';
import { sha256, stableStringify } from './util.js';

export class AuditLog {
  #tail = '0'.repeat(64);
  #sequence = 0;
  #queue = Promise.resolve();
  #recent = [];
  #handle;
  #failure = null;
  #lease;
  #lockPath;

  static async create(directory) {
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const log = new AuditLog();
    const filename = path.join(directory, 'audit.jsonl');
    log.#lockPath = path.join(directory, 'audit.lock');
    try { log.#lease = await open(log.#lockPath, 'wx', 0o600); }
    catch (error) {
      if (error.code === 'EEXIST') throw new Error('Audit directory is already owned. After a crash, verify the previous process has stopped before removing audit.lock.');
      throw error;
    }
    try {
    await log.#lease.writeFile(JSON.stringify({ pid: process.pid, started_at: new Date().toISOString() }) + '\n');
    let bytes = '';
    try { bytes = await readFile(filename, 'utf8'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (bytes && !bytes.endsWith('\n')) throw new Error('Audit log ends in an incomplete record. Preserve it and investigate.');
    for (const line of bytes.split('\n').filter(Boolean)) {
      const row = JSON.parse(line), { hash, ...payload } = row;
      if (payload.previous_hash !== log.#tail || payload.sequence !== log.#sequence + 1 || hash !== sha256(stableStringify(payload))) throw new Error('Audit hash-chain verification failed.');
      log.#tail = hash; log.#sequence = row.sequence; log.#recent.push(row);
      if (log.#recent.length > 500) log.#recent.shift();
    }
    log.#handle = await open(filename, 'a', 0o600);
    return log;
    } catch (error) {
      await log.#lease.close(); await unlink(log.#lockPath); throw error;
    }
  }

  append(event) {
    const immutable = structuredClone(event);
    const task = this.#queue.then(async () => {
      if (this.#failure) throw this.#failure;
      const payload = { ...immutable, timestamp: new Date().toISOString(), sequence: this.#sequence + 1, previous_hash: this.#tail };
      const row = { ...payload, hash: sha256(stableStringify(payload)) };
      try {
        await this.#handle.writeFile(JSON.stringify(row) + '\n');
        await this.#handle.sync();
      } catch (error) { this.#failure = error; throw error; }
      this.#tail = row.hash; this.#sequence = row.sequence;
      this.#recent.push(row); if (this.#recent.length > 500) this.#recent.shift();
      return { sequence: row.sequence, hash: row.hash };
    });
    this.#queue = task.catch(() => {});
    return task;
  }

  recent() { return structuredClone(this.#recent); }
  get healthy() { return !this.#failure; }
  async close() { await this.#queue; await this.#handle.close(); await this.#lease.close(); await unlink(this.#lockPath); }
}
