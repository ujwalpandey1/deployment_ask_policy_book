import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, writeFile } from 'node:fs/promises';
import { ROOT } from '../src/config.js';

const execute = promisify(execFile);
const docker = (...args) => execute('docker', args, { cwd: ROOT, maxBuffer: 4 * 1024 * 1024 });
const name = `policy-atlas-qa-${process.pid}-${Date.now()}`;
const started = Date.now();
let container;
try {
  await docker('build', '-t', 'policy-atlas:qa', '.');
  const launched = await docker('run', '--detach', '--rm', '--name', name,
    '--network', 'none', '--read-only', '--memory', '256m', '--cpus', '1',
    '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges:true',
    '--tmpfs', '/app/runtime:uid=1000,gid=1000,mode=700',
    '--env', 'AUTH_MODE=runner', '--env', 'RUNNER_TOKEN=offline-container-test-credential',
    '--env', 'GENERATION_MODE=extractive', 'policy-atlas:qa');
  container = launched.stdout.trim();
  assert.match(container, /^[a-f0-9]{64}$/);
  const checked = await docker('exec', container, 'node', '--input-type=module', '-e', `
    import assert from 'node:assert/strict';
    import { access, writeFile } from 'node:fs/promises';
    const base = 'http://127.0.0.1:4600';
    let ready = false;
    for (let attempt = 0; attempt < 60; attempt++) {
      try { ready = (await fetch(base + '/healthz')).ok; } catch {}
      if (ready) break;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    assert.equal(ready, true);
    assert.equal(process.getuid(), 1000);
    for (const file of ['/app/.env', '/app/vendor/op05/questions_dev.jsonl', '/app/vendor/op05/questions_heldout.jsonl', '/app/vendor/op05/grader.py']) {
      await assert.rejects(access(file), {code: 'ENOENT'});
    }
    await assert.rejects(writeFile('/app/web/qa-write-probe', 'probe'), {code: 'EROFS'});
    const headers = {'Content-Type': 'application/json', Authorization: 'Bearer offline-container-test-credential'};
    const post = (role, auth = true) => fetch(base + '/ask', {method: 'POST', headers: auth ? headers : {'Content-Type': 'application/json'}, body: JSON.stringify({id: 'container-' + role, question: 'What are the fee waiver limits?', role, as_of: '2026-09-07'})});
    assert.equal((await post('ops', false)).status, 401);
    const answer = await (await post('ops')).json();
    assert.equal(answer.status, 'answered');
    assert.match(answer.answer, /2,500/);
    const denied = await (await post('public')).json();
    assert.equal(denied.status, 'not_permitted');
    assert.deepEqual(denied.citations, []);
    const docs = await (await fetch(base + '/api/documents?role=public', {headers})).json();
    assert.equal(docs.documents.length, 25);
    console.log(JSON.stringify({passed: true, checks: ['readiness', 'non-root user', 'no credentials or gold in image', 'read-only application', 'runner authentication', 'exact cited answer', 'role refusal', 'public catalog isolation'], platform: process.platform, arch: process.arch, node: process.version}));
  `);
  const inspected = JSON.parse((await docker('inspect', container)).stdout)[0];
  const report = { ...JSON.parse(checked.stdout.trim()), timestamp: new Date().toISOString(), duration_ms: Date.now() - started,
    image_id: inspected.Image, isolation: { network: inspected.HostConfig.NetworkMode, read_only: inspected.HostConfig.ReadonlyRootfs,
      memory_bytes: inspected.HostConfig.Memory, cpu_nanos: inspected.HostConfig.NanoCpus },
    scope: 'Offline Linux container smoke test under Docker Desktop; not independent model-load qualification. No API key enters the container.' };
  await mkdir('results', { recursive: true });
  await writeFile('results/container-smoke.json', JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
} finally {
  if (container) await docker('stop', '--time', '5', container);
}
