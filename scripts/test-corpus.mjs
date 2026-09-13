import { readdir, readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, join, relative, basename, isAbsolute } from 'node:path';
import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { formatPawn } = require('../.test-build/src/core/formatter.js');
const { lex } = require('../.test-build/src/core/lexer.js');
const { parsePawn } = require('../.test-build/src/core/parser.js');
const args = process.argv.slice(2);
if (args.length < 3 || args[0] !== '--out')
  throw new Error('Usage: node scripts/test-corpus.mjs --out .tools/corpus folder [folder ...]');
const output = resolve(args[1]);
const toolsRoot = resolve('.tools');
if (!output.startsWith(toolsRoot + '\\') && !output.startsWith(toolsRoot + '/'))
  throw new Error("Corpus output must be inside this project's .tools directory.");
const roots = args.slice(2).map((entry) => resolve(entry));
if (new Set(roots.map((root) => basename(root))).size !== roots.length)
  throw new Error('Corpus root folders must have distinct names.');
for (const root of roots) {
  const rel = relative(root, output);
  if (!rel || (!isAbsolute(rel) && !rel.startsWith('..')))
    throw new Error('Test output cannot be inside a source folder.');
}
await mkdir(output, { recursive: true });
const fingerprint = (bytes) => createHash('sha256').update(bytes).digest('hex');
const files = [];
async function walk(root, folder) {
  for (const entry of await readdir(folder, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) continue;
    const filename = join(folder, entry.name);
    if (entry.isDirectory()) await walk(root, filename);
    else if (/\.(sma|inc)$/i.test(entry.name)) files.push({ root, filename });
  }
}
for (const root of roots) await walk(root, root);
const results = [];
for (const { root, filename } of files) {
  const original = await readFile(filename);
  let encoding = 'utf8';
  let source;
  try {
    source = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(original);
  } catch {
    encoding = 'windows-1252';
    source = new TextDecoder('windows-1252').decode(original);
  }
  const start = performance.now();
  const formatted = formatPawn(source);
  const milliseconds = performance.now() - start;
  const again = formatPawn(formatted.text);
  const tokens = (text) => lex(text).tokens.map((item) => [item.kind, item.text]);
  const functions = (text) =>
    parsePawn(text)
      .symbols.filter((item) => item.kind === 'function')
      .map((item) => [item.name, item.parameters?.map((p) => p.name)]);
  const originalTokens = JSON.stringify(tokens(source));
  const originalFunctions = JSON.stringify(functions(source));
  const variants = [
    { name: 'allman-4-spaces', options: { tabSize: 4 } },
    { name: 'allman-2-spaces', options: { tabSize: 2 } },
    { name: 'allman-tabs', options: { insertSpaces: false } },
    { name: 'preserve-4-spaces', options: { braceStyle: 'preserve' } },
  ].map(({ name, options }) => {
    const first = formatPawn(source, options);
    return {
      name,
      passed:
        !first.skippedReason &&
        first.text === formatPawn(first.text, options).text &&
        JSON.stringify(tokens(first.text)) === originalTokens &&
        JSON.stringify(functions(first.text)) === originalFunctions,
    };
  });
  const name = join(basename(root), relative(root, filename));
  for (const dir of ['original', 'formatted'])
    await mkdir(join(output, dir, name, '..'), { recursive: true });
  // Original snapshots retain the source encoding; formatted snapshots are UTF-8 for inspection.
  await writeFile(join(output, 'original', name), original);
  await writeFile(join(output, 'formatted', name), formatted.text, 'utf8');
  const result = {
    name,
    originalPath: filename,
    bytes: original.byteLength,
    encoding,
    originalSha256: fingerprint(original),
    changed: formatted.changed,
    skippedReason: formatted.skippedReason,
    tokensPreserved: JSON.stringify(tokens(source)) === JSON.stringify(tokens(formatted.text)),
    idempotent: formatted.text === again.text,
    functionSignaturesPreserved:
      JSON.stringify(functions(source)) === JSON.stringify(functions(formatted.text)),
    functions: functions(source).length,
    variants,
    milliseconds: Math.round(milliseconds * 100) / 100,
  };
  results.push(result);
}
for (const result of results)
  result.originalUnchanged =
    fingerprint(await readFile(result.originalPath)) === result.originalSha256;
const summary = {
  files: results.length,
  bytes: results.reduce((n, result) => n + result.bytes, 0),
  changed: results.filter((r) => r.changed).length,
  skipped: results.filter((r) => r.skippedReason).length,
  tokenFailures: results.filter((r) => !r.tokensPreserved).length,
  idempotenceFailures: results.filter((r) => !r.idempotent).length,
  signatureFailures: results.filter((r) => !r.functionSignaturesPreserved).length,
  modifiedOriginals: results.filter((r) => !r.originalUnchanged).length,
  variantsTested: results.reduce((n, r) => n + r.variants.length, 0),
  variantFailures: results.reduce((n, r) => n + r.variants.filter((v) => !v.passed).length, 0),
  milliseconds: Math.round(results.reduce((n, r) => n + r.milliseconds, 0) * 100) / 100,
};
await writeFile(
  join(output, 'report.json'),
  JSON.stringify({ generatedAt: new Date().toISOString(), summary, results }, null, 2),
);
console.log(JSON.stringify(summary, null, 2));
for (const result of results)
  if (
    result.skippedReason ||
    !result.idempotent ||
    !result.functionSignaturesPreserved ||
    !result.tokensPreserved ||
    result.variants.some((v) => !v.passed)
  )
    console.log(JSON.stringify(result));
if (
  summary.tokenFailures ||
  summary.idempotenceFailures ||
  summary.signatureFailures ||
  summary.modifiedOriginals ||
  summary.variantFailures
)
  process.exitCode = 1;
