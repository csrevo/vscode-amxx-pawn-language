import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parsePawn, callAt, visibleSymbols } from '../src/core/parser';
import { lex, tokenAt } from '../src/core/lexer';

test('finds functions, tagged arguments, docs, globals, parameters and lexical locals', () => {
  const source =
    '#include <amxmodx>\n#define LIMIT 32\nnew global;\n/** Calculate a value.\n * @param id Player.\n */\nstock Float:calculate(id, const name[], Float:amount = 1.0)\n{\nnew value;\n{new inner;}\nreturn amount;\n}\npublic next(){new unrelated;}';
  const parsed = parsePawn(source);
  const fn = parsed.symbols.find((symbol) => symbol.name === 'calculate')!;
  assert.equal(fn.kind, 'function');
  assert.deepEqual(
    fn.parameters?.map((p) => p.name),
    ['id', 'name', 'amount'],
  );
  assert.match(fn.documentation, /Calculate a value/);
  assert.ok(parsed.symbols.some((s) => s.name === 'LIMIT' && s.kind === 'macro'));
  const visible = visibleSymbols(parsed.symbols, source.indexOf('return amount'));
  assert.ok(visible.some((s) => s.name === 'value'));
  assert.ok(visible.some((s) => s.name === 'id'));
  assert.ok(!visible.some((s) => s.name === 'inner' || s.name === 'unrelated'));
});

test('native and forward declarations do not require a body or semicolon', () => {
  const parsed = parsePawn(
    'native do_work(id, const text[], any:...);\nforward plugin_init()\nstock sum(a,b){return a+b;}',
  );
  assert.deepEqual(
    parsed.symbols.filter((s) => s.kind === 'function').map((s) => s.name),
    ['do_work', 'plugin_init', 'sum'],
  );
  assert.equal(parsed.symbols.find((s) => s.name === 'do_work')!.parameters?.length, 3);
});

test('multiple accepted tags are not mistaken for parameter names', () => {
  const parsed = parsePawn('native any:get_value({Float,_}:value, &Float:output, const label[]);');
  assert.deepEqual(
    parsed.symbols[0]!.parameters?.map((p) => p.name),
    ['value', 'output', 'label'],
  );
});

test('includes retain quote semantics and exact source positions', () => {
  const source = '#include <amxmodx>\n#tryinclude "local/file.inc"\n#include other\n';
  const includes = parsePawn(source).includes;
  assert.deepEqual(
    includes.map((i) => [i.name, i.local, i.optional]),
    [
      ['amxmodx', false, false],
      ['local/file.inc', true, true],
      ['other', true, false],
    ],
  );
  for (const include of includes)
    assert.equal(source.slice(include.start, include.end), include.name);
});

test('strings and comments cannot create symbols or includes', () => {
  const parsed = parsePawn(
    '// native fake();\n/* #include <bad> */\nnew text[]="public fake() {}";\npublic real(){}',
  );
  assert.deepEqual(parsed.includes, []);
  assert.ok(!parsed.symbols.some((s) => s.name === 'fake'));
  assert.ok(parsed.symbols.some((s) => s.name === 'real'));
});

test('signature argument counting ignores nested calls, arrays and literals', () => {
  const source = 'public f(){target(nested(1,2), array[index(1,2)], "a,b", ';
  const parsed = lex(source);
  assert.deepEqual(callAt(parsed.tokens, source.length), { name: 'target', parameter: 3 });
  assert.equal(callAt(lex('if (').tokens, 4), undefined);
});

test('symbols shadow globals, stop at scope boundaries and exclude later locals', () => {
  const source = 'new value;\npublic f(){new value; foo(value); new later;}';
  const visible = visibleSymbols(parsePawn(source).symbols, source.indexOf('foo('));
  assert.equal(visible.filter((s) => s.name === 'value').length, 1);
  assert.ok(visible.find((s) => s.name === 'value')!.scopeStart !== undefined);
  assert.ok(!visible.some((s) => s.name === 'later'));
});

test('folding ranges cover blocks, docs, conditionals and regions', () => {
  const parsed = parsePawn(
    '// region Test\n#if DEBUG\n/* doc\nline */\npublic f()\n{\nfoo();\n}\n#endif\n// endregion\n',
  );
  assert.ok(parsed.folds.some((f) => f.start === 0 && f.end === 9 && f.kind === 'region'));
  assert.ok(parsed.folds.some((f) => f.start === 1 && f.end === 8));
  assert.ok(parsed.folds.some((f) => f.start === 2 && f.end === 3 && f.kind === 'comment'));
  assert.ok(parsed.folds.some((f) => f.start === 5 && f.end === 7));
});

test('UTF-16 offsets survive Unicode in strings and comments', () => {
  const source = '// ação 🚀\r\nnew valor=1;';
  const parsed = lex(source);
  const token = tokenAt(parsed.tokens, source.indexOf('valor'))!;
  assert.equal(token.text, 'valor');
  assert.equal(source.slice(token.start, token.end), 'valor');
  assert.equal(parsed.lineStarts[1], source.indexOf('new'));
});
