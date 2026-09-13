import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as path from 'node:path';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { WorkerClient } from '../src/workerClient';

test('the packaged worker parses and formats without a VS Code runtime', async () => {
  const worker = new WorkerClient(path.resolve('dist/worker.js'));
  try {
    const [parsed, formatted] = await Promise.all([
      worker.run('parse', 'public hello() {}'),
      worker.run('format', 'public hello(){return 1;}'),
    ]);
    assert.equal(parsed.symbols[0]!.name, 'hello');
    assert.match(formatted.text, /    return 1;/);
  } finally {
    worker.dispose();
  }
});

test('cancelled and disposed requests reject and release pending jobs', async () => {
  const worker = new WorkerClient(path.resolve('dist/worker.js'));
  const abort = new AbortController();
  abort.abort();
  await assert.rejects(worker.run('parse', '', undefined, abort.signal), /cancelled/);
  const pending = worker.run('parse', 'new x;');
  worker.dispose();
  await assert.rejects(pending, /cancelled/);
  await assert.rejects(worker.run('parse', ''), /disposed/);
});

test('non-Error worker failures reject active and queued requests as Error objects', async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), 'revo-worker-error-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const filename = path.join(root, 'throwing-worker.cjs');
  await writeFile(filename, 'throw "worker failure";\n');
  const worker = new WorkerClient(filename);
  const isWorkerFailure = (error: unknown): boolean =>
    error instanceof Error && error.message === 'worker failure';
  try {
    await Promise.all([
      assert.rejects(worker.run('parse', 'new first;'), isWorkerFailure),
      assert.rejects(worker.run('parse', 'new second;'), isWorkerFailure),
    ]);
  } finally {
    worker.dispose();
  }
});
