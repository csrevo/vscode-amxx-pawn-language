import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatPawn, formatPawnSelection, type FormatOptions } from '../src/core/formatter';
import { lex } from '../src/core/lexer';

function formatted(source: string, options?: Partial<FormatOptions>): string {
  const result = formatPawn(source, options);
  assert.equal(result.skippedReason, undefined, result.skippedReason ?? 'Formatting must succeed.');
  assert.equal(
    formatPawn(result.text, options).text,
    result.text,
    'Formatting must be idempotent.',
  );
  assert.deepEqual(
    lex(result.text).tokens.map(({ kind, text }) => [kind, text]),
    lex(source).tokens.map(({ kind, text }) => [kind, text]),
    'Every token, literal, comment and directive must be preserved.',
  );
  return result.text;
}

test('expands compact functions, calls and explicit statements', () => {
  assert.equal(
    formatted('public plugin_init(){new x=1;foo(x,2);return x;}'),
    'public plugin_init()\n{\n    new x = 1;\n    foo(x, 2);\n    return x;\n}\n',
  );
});

test('indents nested unbraced statements and dangling else correctly', () => {
  assert.equal(
    formatted('public f(){if(a)if(b)foo();else bar();else baz();}'),
    'public f()\n{\n    if (a)\n        if (b)\n            foo();\n        else\n            bar();\n    else\n        baz();\n}\n',
  );
});

test('for header semicolons and empty loop bodies stay intact', () => {
  assert.equal(
    formatted('public f(){for(new i=0;i<10;i++){x+=i;}while(x--); }'),
    'public f()\n{\n    for (new i = 0; i < 10; i++)\n    {\n        x += i;\n    }\n    while (x--);\n}\n',
  );
});

test('do/while is kept together as a statement', () => {
  assert.equal(
    formatted('public f(){do{x++;}while(x<3);foo();}'),
    'public f()\n{\n    do\n    {\n        x++;\n    }\n    while (x < 3);\n    foo();\n}\n',
  );
});

test('switch handles case lists, blocks, default and tag overrides', () => {
  const result = formatted(
    'public f(){switch(x){case 1,2:{foo();}case _:VALUE:bar();default:baz();}}',
  );
  assert.match(result, /        case 1, 2:\n            \{/);
  assert.match(result, /        case _:VALUE:\n            bar\(\);/);
  assert.match(result, /        default:\n            baz\(\);/);
});

test('semicolon-free code preserves every original statement boundary', () => {
  const source = 'public f()\n{\nnew a=1\nnew b=2\nif(a)\nb++\nreturn\nfoo()\n}';
  const result = formatted(source);
  assert.match(result, /    new a = 1\n    new b = 2/);
  assert.match(result, /    if \(a\)\n        b\+\+\n    return\n    foo\(\)/);
  assert.equal(lex(result).tokens.filter((item) => item.text === ';').length, 0);
});

test('keeps continued expressions and strings intact', () => {
  const source = 'public f(){\nnew x=1+\n2;\nnew s[]="hello \\\n  world";\nfoo(x,s);\n}';
  const result = formatted(source);
  assert.ok(result.includes('"hello \\\n  world"'));
  assert.ok(result.includes('new x = 1 +\n'));
});

test('preserves string escapes, raw and packed strings, URL text and character literals', () => {
  const source =
    'public f(){foo("^"hello^" // { }",\'^n\',!"packed",^"raw",!^"raw packed",^!"raw packed");}';
  formatted(source);
});

test('preserves macro definitions and their continuations verbatim', () => {
  const source = '#define MACRO(%1) do { \\\n  foo(%1); \\\n} while (0)\n\npublic f(){MACRO(3);}';
  const result = formatted(source);
  assert.ok(result.startsWith(source.slice(0, source.indexOf('public'))));
});

test('supports ctrlchar changes, reset and numeric values', () => {
  formatted(
    '#pragma ctrlchar 92\npublic f(){foo("\\"hello\\"");}\n#pragma ctrlchar\npublic g(){foo("^"hello^"");}\n',
  );
  formatted('#pragma ctrlchar \'\\\'\npublic f(){foo("\\n");}\n');
});

test('conditional escape changes are preserved instead of guessed', () => {
  const source = '#if X\n#pragma ctrlchar 92\n#endif\npublic f(){foo("text");}';
  const result = formatPawn(source);
  assert.equal(result.text, source);
  assert.match(result.skippedReason!, /Conditional/);
});

test('arrays, dimensions, tags, enumerations and unary operators', () => {
  const source =
    'enum _:Data{A,B[3],Float:C};\nnew Float:g_values[2][2]={{1.0,2.0},{3.0,4.0}};\nstock Float:f({Float,_}:value,&out){out=-1;return Float:value+floatabs(-value);}';
  const result = formatted(source);
  assert.match(result, /\{Float,_\}:value|\{Float, _\}:value/);
  assert.match(result, /out = -1/);
  assert.match(result, /floatabs\(-value\)/);
  assert.match(result, /    A,\n    B\[3\],\n    Float:C/);
});

test('named arguments and skipped defaults retain readable spacing', () => {
  assert.equal(
    formatted('public f(){foo(1,_,.value=2,.enabled=true);}'),
    'public f()\n{\n    foo(1, _, .value = 2, .enabled = true);\n}\n',
  );
});

test('return expressions retain a space before parentheses', () => {
  assert.equal(formatted('public f(){return (1+2);}'), 'public f()\n{\n    return (1 + 2);\n}\n');
});

test('line-sensitive source is preserved', () => {
  const source = '#define HERE __LINE__\npublic f(){foo(HERE);}';
  assert.equal(formatPawn(source).text, source);
  assert.match(formatPawn(source).skippedReason!, /physical line/);
});

test('selection formatting uses context without changing adjacent lines', () => {
  const source = 'public f()\n{\nnew x=1;foo(x);\nnew untouched=2;\n}\n';
  const result = formatPawnSelection(source, 2, 2);
  assert.equal(result.text, 'public f()\n{\n    new x = 1;\n    foo(x);\nnew untouched=2;\n}\n');
  assert.ok(result.rangeEdit);
  assert.equal(formatPawnSelection('/* hello\n world */\nnew x=1;', 1, 2).changed, false);
});

test('multiline expressions and declarations indent their continuation', () => {
  const result = formatted('public f()\n{\nnew a=1+\n2;\nnew b,\nc;\n}');
  assert.ok(result.includes('    new a = 1 +\n        2;'));
  assert.ok(result.includes('    new b,\n        c;'));
});

test('comments are never rewritten or turned into code', () => {
  const source =
    'public f(){x=1;// note with { }\n/* block\n * exact   text\n */\ny=2;/* trailing */z=3;}';
  const result = formatted(source);
  assert.ok(result.includes('/* block\n * exact   text\n */'));
  assert.ok(result.includes('// note with { }\n'));
});

test('comment between an unbraced condition and its body', () => {
  const result = formatted('public f(){\nif(x)\n// body\nfoo();\nelse\nbar();\n}');
  assert.match(result, /    if \(x\)\n        \/\/ body\n        foo\(\);\n    else\n        bar/);
});

test('line comments with backslash continuation remain opaque', () => {
  const source = 'public f(){\n// comment \\\nnot_real_code();\nfoo();\n}';
  formatted(source);
});

test('disabled regions are byte-for-byte preserved', () => {
  const region = '// revo-format off\n  new table[]={  1,2,  3 };\n// revo-format on';
  const result = formatted(`public f(){\n${region}\nfoo(1,2);\n}`);
  assert.ok(result.includes(region));
  assert.match(result, /foo\(1, 2\)/);
});

test('preserves CRLF, BOM and configured tabs', () => {
  const result = formatted('\uFEFFpublic f()\r\n{\r\nnew x=1;\r\n}\r\n', { insertSpaces: false });
  assert.ok(result.startsWith('\uFEFF'));
  assert.ok(result.includes('\r\n\tnew x = 1;'));
  assert.equal(result.replace(/\r\n/g, '').includes('\n'), false);
});

test('preserve brace style retains attached and detached braces', () => {
  const result = formatted('public f(){foo();}\npublic g()\n{bar();}', { braceStyle: 'preserve' });
  assert.ok(result.startsWith('public f() {\n'));
  assert.ok(result.includes('public g()\n{\n'));
});

test('whitespace-only input and final newline settings', () => {
  assert.equal(formatted('  \n \t\n'), '');
  assert.equal(formatted('new x=1;', { insertFinalNewline: false }), 'new x = 1;');
  assert.equal(formatted('new a=1;\n\n\n\nnew b=2;'), 'new a = 1;\n\n\nnew b = 2;\n');
});

for (const source of [
  'public f(){',
  'public f(){foo("unterminated);}',
  'public f(){/*',
  'public f(){a[2);}',
  `public f(){${'('.repeat(300)}x${')'.repeat(300)};}`,
]) {
  test(`fails closed for malformed or excessive nesting: ${source.slice(0, 35)}`, () => {
    const result = formatPawn(source);
    assert.equal(result.text, source);
    assert.ok(result.skippedReason);
  });
}

test('seeded spacing permutations preserve tokens and are idempotent', () => {
  let seed = 731;
  const base =
    'public f(id){new Float:v[3]={1.0,2.0,3.0};for(new i=0;i<3;i++){if(v[i]>0.0)foo(id,v[i]);else bar();}return 1;}';
  const tokens = lex(base).tokens;
  for (let n = 0; n < 150; n++) {
    const source = tokens
      .map((item, i) => {
        seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
        const gap = i && !['++', '--'].includes(item.text) ? [' ', '  ', '\t'][seed % 3] : '';
        return gap + item.text;
      })
      .join('');
    formatted(source);
  }
});
