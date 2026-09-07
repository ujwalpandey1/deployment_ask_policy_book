import { createHash } from 'node:crypto';
import { mkdir, readFile, copyFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const commit = 'd87699bb97de6504b33f681eed66918a4d433ba0';
const source = 'https://github.com/Deployment-inc/Deployment.inc-Hiring-Problems';
const sha = data => createHash('sha256').update(data).digest('hex');
const args = process.argv.slice(2);
const sourceDir = args.includes('--from') ? args[args.indexOf('--from') + 1] : null;
const verifyOnly = args.includes('--verify');
const target = name => name.startsWith('references/OP-05/')
  ? path.join(root, 'vendor/op05', name.slice('references/OP-05/'.length))
  : path.join(root, 'vendor/upstream', name);

async function get(name) {
  if (sourceDir) return readFile(path.join(sourceDir, name));
  const res = await fetch(`https://raw.githubusercontent.com/Deployment-inc/Deployment.inc-Hiring-Problems/${commit}/${name}`, {
    redirect: 'error', signal: AbortSignal.timeout(30000),
  });
  if (!res.ok) throw new Error(`Download failed: ${name} (${res.status})`);
  return Buffer.from(await res.arrayBuffer());
}

const releaseBytes = verifyOnly ? await readFile(target('RELEASE_MANIFEST.json')) : await get('RELEASE_MANIFEST.json');
const release = JSON.parse(releaseBytes);
const rootFiles = new Set(['LICENSE.md', 'MODELS.md', 'CALIBRATION.md', 'JUDGMENT_REVIEW.md', 'SUBMISSION_SCHEMA.md', 'EVALUATION_PROTOCOL.md']);
const selected = Object.entries(release.files).filter(([name]) => name.startsWith('references/OP-05/') || rootFiles.has(name));
for (const [name, hash] of selected) {
  const bytes = verifyOnly ? await readFile(target(name)) : await get(name);
  if (sha(bytes) !== hash) throw new Error(`Release checksum mismatch: ${name}`);
  if (!verifyOnly) {
    await mkdir(path.dirname(target(name)), { recursive: true });
    if (sourceDir) await copyFile(path.join(sourceDir, name), target(name));
    else await writeFile(target(name), bytes);
  }
}
if (!verifyOnly) {
  await writeFile(target('RELEASE_MANIFEST.json'), releaseBytes);
  await writeFile(path.join(root, 'vendor/provenance.json'), JSON.stringify({ source, commit, release: release.release,
    release_sha256: sha(releaseBytes), files_verified: selected.length,
    note: 'Upstream corpus, questions, scorer and documentation preserved byte-for-byte. Runtime reads only the corpus.' }, null, 2) + '\n');
}
console.log(`${verifyOnly ? 'Verified' : 'Imported'} ${selected.length} pinned upstream files (${commit.slice(0, 12)}).`);
