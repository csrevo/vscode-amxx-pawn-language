import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Registry, INITIAL } from 'vscode-textmate';
import { loadWASM, OnigScanner, OnigString } from 'vscode-oniguruma';

test('TextMate grammar runs on the same regex engine used by VS Code', async () => {
  const wasm = await readFile(require.resolve('vscode-oniguruma/release/onig.wasm'));
  await loadWASM(wasm.buffer.slice(wasm.byteOffset, wasm.byteOffset + wasm.byteLength));
  const registry = new Registry({
    onigLib: Promise.resolve({
      createOnigScanner: (patterns) => new OnigScanner(patterns),
      createOnigString: (text) => new OnigString(text),
    }),
    loadGrammar: async () =>
      JSON.parse(
        await readFile('syntaxes/pawn.tmLanguage.json', 'utf8'),
      ) as import('vscode-textmate').IRawGrammar,
  });
  try {
    const grammar = await registry.loadGrammar('source.amxxpawn');
    assert.ok(grammar);
    for (const [source, expected] of [
      ['if (id) return 1;', 'keyword.control.pawn'],
      ['new Float:value = 1.5;', 'storage.type.tag.pawn'],
      ['foo("^"text^"");', 'constant.character.escape.pawn'],
      ['// comment with { }', 'comment.line.double-slash.pawn'],
      ['#include <amxmodx>', 'string.quoted.other.include.pawn'],
      ['#define MACRO(%1) %1', 'variable.parameter.macro.pawn'],
      ['foo(^"raw string");', 'string.quoted.double.raw.pawn'],
    ])
      assert.ok(
        grammar
          .tokenizeLine(source!, INITIAL)
          .tokens.some((token) => token.scopes.includes(expected!)),
        `${source}: missing scope ${expected}`,
      );
  } finally {
    registry.dispose();
  }
});

test('manifest exposes only revo_pawn settings and references existing entry points', async () => {
  const manifest = JSON.parse(await readFile('package.json', 'utf8')) as {
    contributes: {
      configuration: { properties: Record<string, unknown> };
      commands: Array<{ command: string }>;
    };
    main: string;
  };
  assert.ok(
    Object.keys(manifest.contributes.configuration.properties).every((key) =>
      key.startsWith('revo_pawn.'),
    ),
  );
  assert.ok(
    manifest.contributes.commands.every((command) => command.command.startsWith('revo_pawn.')),
  );
  assert.ok((await readFile(manifest.main)).length > 0);
  assert.ok((await readFile('dist/worker.js')).length > 0);
});
