import { test } from 'node:test';
import assert from 'node:assert/strict';
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';

const execute = promisify(execFile);

test('a types-only dependency update aligns the editor requirement before packaging', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'revo-dependency-update-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, 'scripts'));
  await mkdir(join(root, 'node_modules/@types/vscode'), { recursive: true });
  const script = join(root, 'scripts/sync-vscode-engine.mjs');
  await copyFile(resolve('scripts/sync-vscode-engine.mjs'), script);

  // Simulate a types-only update, including a DefinitelyTyped-specific patch.
  const manifest = {
    name: 'fixture',
    engines: { vscode: '^1.95.0', node: '>=22' },
    devDependencies: { '@types/vscode': '1.137.7' },
  };
  const lock = {
    lockfileVersion: 3,
    packages: {
      '': manifest,
      'node_modules/@types/vscode': { version: '1.137.7', integrity: 'preserve-me' },
    },
  };
  await writeFile(join(root, 'package.json'), JSON.stringify(manifest, null, 2) + '\n');
  await writeFile(join(root, 'package-lock.json'), JSON.stringify(lock, null, 2) + '\n');
  await writeFile(
    join(root, 'node_modules/@types/vscode/package.json'),
    JSON.stringify({ version: '1.137.7' }),
  );

  // Resolving paths from the script must work even from a different directory.
  await execute(process.execPath, [script], { cwd: tmpdir(), windowsHide: true });
  const updatedManifest = await readFile(join(root, 'package.json'), 'utf8');
  const updatedLock = await readFile(join(root, 'package-lock.json'), 'utf8');
  manifest.engines.vscode = '^1.137.0';
  assert.deepEqual(JSON.parse(updatedManifest), manifest);
  assert.deepEqual(JSON.parse(updatedLock), lock);

  await execute(process.execPath, [script], { windowsHide: true });
  assert.equal(await readFile(join(root, 'package.json'), 'utf8'), updatedManifest);
  assert.equal(await readFile(join(root, 'package-lock.json'), 'utf8'), updatedLock);
});
