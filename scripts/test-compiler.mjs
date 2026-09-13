import { readdir, readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';

const require = createRequire(import.meta.url);
const { formatPawn } = require('../.test-build/src/core/formatter.js');
const { runCompiler } = require('../.test-build/src/core/process.js');
const { parseCompilerDiagnostics } = require('../.test-build/src/core/diagnostics.js');
const sdk = resolve(process.env.AMXX_SDK ?? '.tools/amxx-sdk/addons/amxmodx/scripting');
const executable = join(sdk, process.platform === 'win32' ? 'amxxpc.exe' : 'amxxpc');
const output = resolve('.tools/compiler-tests');
await mkdir(output, { recursive: true });
const formattedIncludes = join(output, 'include');
let includeCount = 0;
async function prepareIncludes(relative = '') {
  for (const entry of await readdir(join(sdk, 'include', relative), { withFileTypes: true })) {
    const name = join(relative, entry.name);
    if (entry.isDirectory()) await prepareIncludes(name);
    else if (entry.name.endsWith('.inc')) {
      const source = await readFile(join(sdk, 'include', name), 'utf8');
      const result = formatPawn(source);
      assert.equal(result.skippedReason, undefined, `${name}: ${result.skippedReason}`);
      await mkdir(join(formattedIncludes, name, '..'), { recursive: true });
      await writeFile(join(formattedIncludes, name), result.text, 'utf8');
      includeCount++;
    }
  }
}
await prepareIncludes();
const files = (await readdir(sdk)).filter((file) => file.endsWith('.sma'));
const results = [];
for (const file of files) {
  const original = await readFile(join(sdk, file), 'utf8');
  const formatted = formatPawn(original);
  assert.equal(formatted.skippedReason, undefined, `${file}: ${formatted.skippedReason}`);
  assert.equal(formatPawn(formatted.text).text, formatted.text, `${file}: not idempotent`);
  // Identical input filename in each compile eliminates path-related binary differences.
  const input = join(output, file);
  const binaries = [];
  const diagnostics = [];
  for (const [label, source] of [
    ['before', original],
    ['after', formatted.text],
  ]) {
    await writeFile(input, source, 'utf8');
    const destination = join(output, `${file}.${label}.amxx`);
    const includeDirectory = label === 'before' ? join(sdk, 'include') : formattedIncludes;
    const result = await runCompiler({
      executable,
      arguments: [input, `-i${includeDirectory}`, `-o${destination}`, '-d0'],
      cwd: output,
      timeoutMs: 30000,
    });
    await writeFile(join(output, `${file}.${label}.log`), result.output);
    assert.equal(result.code, 0, `${file} ${label}:\n${result.output}`);
    assert.equal(
      parseCompilerDiagnostics(result.output).some((d) => d.severity === 'error'),
      false,
      `${file} ${label}:\n${result.output}`,
    );
    binaries.push(await readFile(destination));
    diagnostics.push(parseCompilerDiagnostics(result.output));
  }
  assert.deepEqual(
    binaries[1],
    binaries[0],
    `${file}: emitted AMXX binary changed after formatting`,
  );
  results.push({
    file,
    binaryIdentical: true,
    bytes: binaries[0].length,
    warningsBefore: diagnostics[0].length,
    warningsAfter: diagnostics[1].length,
  });
}
await writeFile(
  join(output, 'report.json'),
  JSON.stringify({ sdk, includeCount, results }, null, 2),
);
console.log(
  `${results.length} official SDK plugins and ${includeCount} includes formatted; all before/after AMXX binaries identical (-d0).`,
);
