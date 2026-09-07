import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { AuditLog } from '../src/audit.js';
import { temp } from './helpers.js';

test('concurrent audit writes form one durable ordered hash chain and survive restart', async () => {
  const directory = await temp(); const audit = await AuditLog.create(directory);
  await Promise.all(Array.from({ length: 40 }, (_, i) => audit.append({ request_id: `q-${i}`, status: 'answered', role: 'ops' })));
  assert.equal(audit.recent().length, 40);
  const copy = audit.recent(); copy[0].status = 'corrupted'; assert.equal(audit.recent()[0].status, 'answered');
  await audit.close();
  const reopened = await AuditLog.create(directory); assert.equal((await reopened.append({ status: 'not_permitted' })).sequence, 41); await reopened.close();
  const file = path.join(directory, 'audit.jsonl'); await writeFile(file, (await readFile(file, 'utf8')).replace('q-1', 'q-9'));
  await assert.rejects(AuditLog.create(directory), /hash-chain/);
});

test('partial writes are not silently discarded on startup', async () => {
  const dir = await temp(); await writeFile(path.join(dir, 'audit.jsonl'), '{"partial":');
  await assert.rejects(AuditLog.create(dir), /incomplete/);
});

test('a second process cannot open the same audit directory', async () => {
  const directory = await temp(); const first = await AuditLog.create(directory);
  await assert.rejects(AuditLog.create(directory), /already owned/);
  await first.close();
  const second = await AuditLog.create(directory); await second.close();
});
