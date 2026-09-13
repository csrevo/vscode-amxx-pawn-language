import { performance } from 'node:perf_hooks';
import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
const require = createRequire(import.meta.url);
// Exercise the shipping worker, including startup and message serialization.
const { Worker } = await import('node:worker_threads');
const worker = new Worker(new URL('../dist/worker.js', import.meta.url), { execArgv: [] });
let id = 0;
function run(source) {
  return new Promise((resolve, reject) => {
    worker.once('message', (message) =>
      message.error ? reject(new Error(message.error)) : resolve(message.result),
    );
    worker.postMessage({ id: ++id, operation: 'format', source });
  });
}
const source = Array.from(
  { length: 2000 },
  (_, i) =>
    `stock function_${i}(id){new v[3]={1,2,3};for(new n=0;n<3;n++){if(v[n])foo(id,v[n]);}return id;}\n`,
).join('');
const start = performance.now();
await run('public warmup(){}');
const startupMs = performance.now() - start;
const measurements = [];
for (let i = 0; i < 10; i++) {
  const start = performance.now();
  await run(source);
  measurements.push(performance.now() - start);
}
await worker.terminate();
measurements.sort((a, b) => a - b);
const report = {
  node: process.version,
  platform: process.platform,
  bytes: Buffer.byteLength(source),
  functions: 2000,
  samples: measurements.length,
  workerStartupMs: +startupMs.toFixed(2),
  medianMs: +measurements[5].toFixed(2),
  p90Ms: +measurements[8].toFixed(2),
};
await mkdir('artifacts', { recursive: true });
await writeFile('artifacts/benchmark.json', JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
