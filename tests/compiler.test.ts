import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as path from 'node:path';
import { expandPath, validateCompilerArguments } from '../src/core/paths';
import { parseCompilerDiagnostics } from '../src/core/diagnostics';
import { runCompiler } from '../src/core/process';

test('parses Windows paths with spaces, line spans and fatal errors from both streams', () => {
  const parsed = parseCompilerDiagnostics(
    'C:\\some dir\\file.sma(12) : warning 217: loose indentation\ninclude/file.inc(4 -- 7) : error 017: undefined symbol "x"\nfile.sma(0) : fatal error 100: cannot read from file\nDone.',
  );
  assert.equal(parsed.length, 3);
  assert.equal(parsed[0]!.file, 'C:\\some dir\\file.sma');
  assert.equal(parsed[0]!.startLine, 11);
  assert.equal(parsed[1]!.endLine, 6);
  assert.equal(parsed[2]!.startLine, 0);
  assert.equal(parsed[2]!.severity, 'error');
});

test('path expansion is explicit, resource-relative and never invokes a shell', () => {
  const root = path.resolve('fixtures/project');
  const file = path.join(root, 'scripts/test.sma');
  assert.equal(
    expandPath('${fileDirname}/compiled', { workspaceFolder: root, file }),
    path.join(root, 'scripts/compiled'),
  );
  assert.equal(
    expandPath('${env:SDK}/include', { workspaceFolder: root, file, env: { SDK: root } }),
    path.join(root, 'include'),
  );
  assert.throws(
    () => expandPath('${env:MISSING}', { workspaceFolder: root, file, env: {} }),
    /Unresolved/,
  );
  assert.equal(
    expandPath('includes', { workspaceFolder: root, file }),
    path.join(root, 'includes'),
  );
});

test('compiler arguments reject input/output overrides and accept normal options', () => {
  assert.deepEqual(validateCompilerArguments(['-d2', '-O2', 'DEBUG=1']), ['-d2', '-O2', 'DEBUG=1']);
  for (const arg of ['-obad.amxx', '-iother', '-Dwrong', 'other.sma', '', 'bad\nvalue'])
    assert.throws(() => validateCompilerArguments([arg]));
});

test('process invocation preserves shell metacharacters as a single literal argument', async () => {
  const literal = 'a b & echo injected | "$HOME" $(bad)';
  const result = await runCompiler({
    executable: process.execPath,
    arguments: ['-e', 'process.stdout.write(process.argv[1]);', literal],
    cwd: process.cwd(),
    timeoutMs: 5000,
  });
  assert.equal(result.code, 0);
  assert.equal(result.output, literal);
});

test('captures diagnostics emitted on stderr and nonzero exit codes', async () => {
  const result = await runCompiler({
    executable: process.execPath,
    arguments: [
      '-e',
      'process.stderr.write("file.sma(2) : error 017: missing\\n"); process.exitCode=1;',
    ],
    cwd: process.cwd(),
    timeoutMs: 5000,
  });
  assert.equal(result.code, 1);
  assert.equal(parseCompilerDiagnostics(result.output).length, 1);
});

test('processes are killed on timeout and cancellation', async () => {
  await assert.rejects(
    runCompiler({
      executable: process.execPath,
      arguments: ['-e', 'setInterval(()=>{},1000)'],
      cwd: process.cwd(),
      timeoutMs: 50,
    }),
    /timed out/,
  );
  const abort = new AbortController();
  const pending = runCompiler({
    executable: process.execPath,
    arguments: ['-e', 'setInterval(()=>{},1000)'],
    cwd: process.cwd(),
    timeoutMs: 5000,
    signal: abort.signal,
  });
  abort.abort();
  await assert.rejects(pending, /cancelled/);
});

test('output growth and missing executables fail predictably', async () => {
  await assert.rejects(
    runCompiler({
      executable: process.execPath,
      arguments: ['-e', 'console.log("x".repeat(2000))'],
      cwd: process.cwd(),
      timeoutMs: 5000,
      maxOutputBytes: 100,
    }),
    /output exceeded/,
  );
  await assert.rejects(
    runCompiler({
      executable: path.resolve('missing-compiler.exe'),
      arguments: [],
      cwd: process.cwd(),
      timeoutMs: 5000,
    }),
    /ENOENT/,
  );
});
