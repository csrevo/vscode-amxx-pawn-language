import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as path from 'node:path';
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
