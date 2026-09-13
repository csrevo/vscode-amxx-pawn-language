import { lex, matchDelimiters, tokenAt, type Token } from './lexer';

export type PawnSymbolKind = 'function' | 'variable' | 'constant' | 'enum' | 'macro' | 'parameter';
export interface PawnParameter {
  name: string;
  label: string;
  start: number;
  end: number;
}
export interface PawnSymbol {
  name: string;
  kind: PawnSymbolKind;
  start: number;
  end: number;
  nameStart: number;
  nameEnd: number;
  detail: string;
  documentation: string;
  parameters?: PawnParameter[];
  scopeStart?: number;
  scopeEnd?: number;
}
export interface PawnInclude {
  name: string;
  local: boolean;
  optional: boolean;
  start: number;
  end: number;
}
export interface PawnFold {
  start: number;
  end: number;
  kind?: 'comment' | 'region';
}
export interface ParsedDocument {
  tokens: Token[];
  lineStarts: number[];
  symbols: PawnSymbol[];
  includes: PawnInclude[];
  folds: PawnFold[];
}

export const keywords = [
  'assert',
  'break',
  'case',
  'const',
  'continue',
  'default',
  'defined',
  'do',
  'else',
  'enum',
  'exit',
  'false',
  'for',
  'forward',
  'goto',
  'if',
  'native',
  'new',
  'operator',
  'public',
  'return',
  'sizeof',
  'sleep',
  'state',
  'static',
  'stock',
  'switch',
  'tagof',
  'true',
  'while',
];
const keywordSet = new Set(keywords);
const modifiers = new Set(['stock', 'static', 'public', 'native', 'forward']);

function documentation(source: string, tokens: Token[], index: number): string {
  const previous = tokens[index - 1];
  if (previous?.kind !== 'comment' || source.slice(previous.end, tokens[index]!.start).trim())
    return '';
  return previous.text
    .replace(/^\/\*\*?/, '')
    .replace(/\*\/$/, '')
    .split(/\r?\n/)
    .map((line) => line.replace(/^\s*(?:\*|\/\/)?\s?/, ''))
    .join('\n')
    .trim();
}

export function parsePawn(source: string): ParsedDocument {
  const scan = lex(source);
  const { tokens } = scan;
  const { pairs } = matchDelimiters(tokens);
  const symbols: PawnSymbol[] = [];
  const includes: PawnInclude[] = [];
  const folds: PawnFold[] = [];
  const scopes: Array<{ start: number; end: number }> = [];
  const functionBodies = new Map<number, PawnSymbol>();
  const names = new Set<number>();
  const preprocessorFolds: number[] = [];
  const regions: number[] = [];
  let parenDepth = 0;

  const addVariable = (
    index: number,
    kind: PawnSymbolKind,
    start: number,
    detail: string,
    scope?: { start: number; end: number },
  ): void => {
    const token = tokens[index]!;
    if (names.has(token.start)) return;
    names.add(token.start);
    symbols.push({
      name: token.text,
      kind,
      start,
      end: token.end,
      nameStart: token.start,
      nameEnd: token.end,
      detail,
      documentation: documentation(source, tokens, index),
      ...(scope ? { scopeStart: scope.start, scopeEnd: scope.end } : {}),
    });
  };

  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]!;
    if (t.kind === 'directive') {
      const include = /^#\s*(tryinclude|include)\s+(?:<([^>]+)>|"([^"]+)"|([^\s/]+))/.exec(t.text);
      if (include) {
        const name = (include[2] ?? include[3] ?? include[4]!).trim();
        const nameStart =
          t.start + t.text.indexOf(name, include[0].indexOf(include[1]!) + include[1]!.length);
        includes.push({
          name,
          local: include[2] === undefined,
          optional: include[1] === 'tryinclude',
          start: nameStart,
          end: nameStart + name.length,
        });
      }
      const macro = /^#\s*define\s+([A-Za-z_@][\w@]*)/.exec(t.text);
      if (macro) {
        const nameStart = t.start + t.text.indexOf(macro[1]!, t.text.indexOf('define') + 6);
        symbols.push({
          name: macro[1]!,
          kind: 'macro',
          start: t.start,
          end: t.end,
          nameStart,
          nameEnd: nameStart + macro[1]!.length,
          detail: t.text,
          documentation: documentation(source, tokens, i),
        });
      }
      if (/^#\s*if\b/.test(t.text)) preprocessorFolds.push(t.line);
      if (/^#\s*endif\b/.test(t.text)) {
        const start = preprocessorFolds.pop();
        if (start !== undefined && t.line > start)
          folds.push({ start, end: t.line, kind: 'region' });
      }
      if (t.endLine > t.line) folds.push({ start: t.line, end: t.endLine });
      continue;
    }
    if (t.kind === 'comment') {
      if (t.endLine > t.line) folds.push({ start: t.line, end: t.endLine, kind: 'comment' });
      if (/^\/\/\s*#?region\b/.test(t.text)) regions.push(t.line);
      if (/^\/\/\s*#?endregion\b/.test(t.text)) {
        const start = regions.pop();
        if (start !== undefined) folds.push({ start, end: t.line, kind: 'region' });
      }
      continue;
    }
    if (t.text === '(') parenDepth++;
    if (t.text === ')') parenDepth = Math.max(0, parenDepth - 1);
    if (t.text === '{') {
      const close = pairs.get(i);
      if (close !== undefined) {
        scopes.push({ start: t.start, end: tokens[close]!.end });
        if (tokens[close]!.line > t.line) folds.push({ start: t.line, end: tokens[close]!.line });
        const fn = functionBodies.get(i);
        if (fn)
          for (const parameter of fn.parameters ?? []) {
            symbols.push({
              name: parameter.name,
              kind: 'parameter',
              start: parameter.start,
              end: parameter.end,
              nameStart: parameter.start,
              nameEnd: parameter.end,
              detail: parameter.label,
              documentation: '',
              scopeStart: fn.start,
              scopeEnd: fn.end,
            });
          }
      }
    }
    if (t.text === '}') {
      scopes.pop();
      continue;
    }

    if (
      scopes.length === 0 &&
      parenDepth === 0 &&
      t.kind === 'identifier' &&
      !keywordSet.has(t.text) &&
      tokens[i + 1]?.text === '('
    ) {
      const close = pairs.get(i + 1);
      if (close !== undefined) {
        let after = close + 1;
        while (tokens[after]?.kind === 'comment') after++;
        // State-qualified Pawn functions: public foo() <automaton:state> { ... }
        if (tokens[after]?.text === '<') {
          while (after < tokens.length && tokens[after]!.text !== '>') after++;
          after++;
        }
        let begin = i;
        while (
          begin > 0 &&
          tokens[begin - 1]!.line === t.line &&
          tokens[begin - 1]!.kind !== 'comment' &&
          tokens[begin - 1]!.kind !== 'directive' &&
          ![';', '}', '{'].includes(tokens[begin - 1]!.text)
        )
          begin--;
        const prefix = tokens.slice(begin, i);
        const declaration =
          tokens[after]?.text === '{' || prefix.some((token) => modifiers.has(token.text));
        if (declaration && !prefix.some((token) => ['=', 'new', 'return'].includes(token.text))) {
          const params: PawnParameter[] = [];
          let paramStart = i + 2;
          for (let p = paramStart; p <= close; p++) {
            if (p < close && ['(', '[', '{'].includes(tokens[p]!.text)) {
              p = pairs.get(p) ?? p;
              continue;
            }
            if (p === close || tokens[p]!.text === ',') {
              const list = tokens.slice(paramStart, p);
              const eq = list.findIndex((token) => token.text === '=');
              const declaration = eq >= 0 ? list.slice(0, eq) : list;
              let parameter: Token | undefined;
              let tagDepth = 0;
              for (let n = 0; n < declaration.length; n++) {
                const part = declaration[n]!;
                if (part.text === '{') tagDepth++;
                if (part.text === '}') tagDepth--;
                if (part.text === '[') break;
                if (
                  !tagDepth &&
                  part.kind === 'identifier' &&
                  part.text !== 'const' &&
                  declaration[n + 1]?.text !== ':'
                ) {
                  parameter = part;
                  break;
                }
              }
              if (parameter)
                params.push({
                  name: parameter.text,
                  label: source.slice(tokens[paramStart]!.start, tokens[p - 1]!.end).trim(),
                  start: parameter.start,
                  end: parameter.end,
                });
              else if (list.some((token) => token.text === '...'))
                params.push({
                  name: '...',
                  label: '...',
                  start: list[0]!.start,
                  end: list.at(-1)!.end,
                });
              paramStart = p + 1;
            }
          }
          const bodyEnd = tokens[after]?.text === '{' ? pairs.get(after) : undefined;
          const fn: PawnSymbol = {
            name: t.text,
            kind: 'function',
            start: tokens[begin]!.start,
            end: tokens[bodyEnd ?? close]!.end,
            nameStart: t.start,
            nameEnd: t.end,
            detail: source.slice(tokens[begin]!.start, tokens[close]!.end).replace(/\s+/g, ' '),
            documentation: documentation(source, tokens, begin),
            parameters: params,
          };
          symbols.push(fn);
          names.add(t.start);
          if (bodyEnd !== undefined) functionBodies.set(after, fn);
          i = close;
          continue;
        }
      }
    }

    if (t.text === 'enum') {
      let open = i + 1;
      while (
        open < tokens.length &&
        !['{', ';'].includes(tokens[open]!.text) &&
        tokens[open]!.kind !== 'directive'
      )
        open++;
      if (tokens[open]?.text === '{') {
        const close = pairs.get(open);
        const enumName = tokens
          .slice(i + 1, open)
          .find((token) => token.kind === 'identifier' && token.text !== '_');
        if (enumName)
          symbols.push({
            name: enumName.text,
            kind: 'enum',
            start: t.start,
            end: tokens[close ?? open]!.end,
            nameStart: enumName.start,
            nameEnd: enumName.end,
            detail: `enum ${enumName.text}`,
            documentation: documentation(source, tokens, i),
          });
        if (close !== undefined) {
          let expectName = true;
          for (let p = open + 1; p < close; p++) {
            const item = tokens[p]!;
            if (expectName && item.kind === 'identifier' && tokens[p + 1]?.text !== ':') {
              addVariable(
                p,
                'constant',
                item.start,
                enumName ? `${enumName.text}.${item.text}` : item.text,
                scopes.at(-1),
              );
              expectName = false;
            }
            if (['(', '[', '{'].includes(item.text)) p = pairs.get(p) ?? p;
            if (item.text === ',') expectName = true;
          }
        }
      }
    }

    if (t.text === 'new' || t.text === 'const' || (t.text === 'static' && scopes.length > 0)) {
      const constant = t.text === 'const' || tokens[i + 1]?.text === 'const';
      let expectName = true;
      for (let p = i + 1; p < tokens.length; p++) {
        const item = tokens[p]!;
        if (item.kind === 'directive' || [';', '}'].includes(item.text)) break;
        if (
          p > i + 1 &&
          item.line > tokens[p - 1]!.endLine &&
          ![',', '='].includes(tokens[p - 1]!.text)
        )
          break;
        if (item.text === '(' && expectName) break;
        if (
          expectName &&
          item.kind === 'identifier' &&
          !keywordSet.has(item.text) &&
          tokens[p + 1]?.text !== ':'
        ) {
          addVariable(
            p,
            constant ? 'constant' : 'variable',
            t.start,
            source.slice(t.start, item.end).replace(/\s+/g, ' '),
            scopes.at(-1),
          );
          expectName = false;
        }
        if (['(', '[', '{'].includes(item.text)) p = pairs.get(p) ?? p;
        if (item.text === ',') expectName = true;
      }
    }
  }
  return { tokens, lineStarts: scan.lineStarts, symbols, includes, folds };
}

export function visibleSymbols(symbols: readonly PawnSymbol[], offset: number): PawnSymbol[] {
  const visible = symbols.filter(
    (symbol) =>
      symbol.scopeStart === undefined ||
      (offset >= symbol.scopeStart &&
        offset <= symbol.scopeEnd! &&
        (symbol.kind === 'parameter' || symbol.nameStart <= offset)),
  );
  // Inner scopes and locals win over globals with the same name.
  visible.sort((a, b) => (b.scopeStart ?? -1) - (a.scopeStart ?? -1));
  return [...new Map(visible.map((symbol) => [symbol.name, symbol] as const).reverse()).values()];
}

export function callAt(
  tokens: readonly Token[],
  offset: number,
): { name: string; parameter: number } | undefined {
  const at = tokenAt(tokens, Math.max(0, offset - 1));
  if (at && ['string', 'character', 'comment', 'directive'].includes(at.kind) && offset < at.end)
    return undefined;
  let nesting = 0;
  let parameter = 0;
  for (let i = tokens.length - 1; i >= 0; i--) {
    const t = tokens[i]!;
    if (t.start >= offset || t.kind === 'comment' || t.kind === 'string' || t.kind === 'character')
      continue;
    if ([')', ']', '}'].includes(t.text)) nesting++;
    else if (['(', '[', '{'].includes(t.text)) {
      if (nesting) nesting--;
      else if (t.text === '(') {
        const name = tokens[i - 1];
        if (name?.kind === 'identifier' && !keywordSet.has(name.text))
          return { name: name.text, parameter };
        return undefined;
      } else return undefined;
    } else if (t.text === ',' && nesting === 0) parameter++;
    else if ((t.text === ';' || t.kind === 'directive') && nesting === 0) return undefined;
  }
  return undefined;
}
