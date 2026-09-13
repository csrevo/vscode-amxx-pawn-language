import { lex, matchDelimiters, type Token } from './lexer';

export interface FormatOptions {
  tabSize: number;
  insertSpaces: boolean;
  braceStyle: 'allman' | 'preserve';
  maxBlankLines: number;
  insertFinalNewline: boolean;
}

export const defaultFormatOptions: FormatOptions = {
  tabSize: 4,
  insertSpaces: true,
  braceStyle: 'allman',
  maxBlankLines: 2,
  insertFinalNewline: true,
};

export interface FormatResult {
  text: string;
  changed: boolean;
  skippedReason?: string;
  rangeEdit?: { start: number; end: number; text: string };
}
export type FormatRequestOptions = Partial<FormatOptions> & {
  selection?: { startLine: number; endLine: number };
};

const controls = new Set(['if', 'for', 'while', 'switch']);
const continuation = new Set([
  '=',
  '+',
  '-',
  '*',
  '/',
  '%',
  '&&',
  '||',
  '&',
  '|',
  '^',
  '<',
  '>',
  '<=',
  '>=',
  '==',
  '!=',
  '<<',
  '>>',
  '>>>',
  '+=',
  '-=',
  '*=',
  '/=',
  ',',
  '?',
  ':',
  '...',
  '..',
]);
const prefixKeywords = new Set([
  'return',
  'case',
  'assert',
  'sizeof',
  'tagof',
  'defined',
  'new',
  'const',
  'static',
]);

/** A layout planner, not a compiler. It only adds breaks at structural boundaries. */
class Layout {
  readonly indent: number[];
  readonly breaks = new Set<number>();
  readonly blocks = new Set<number>();
  readonly tags = new Set<number>();
  readonly ternary = new Set<number>();
  private operations = 0;

  constructor(
    private readonly tokens: Token[],
    private readonly pairs: Map<number, number>,
    private readonly options: FormatOptions,
  ) {
    this.indent = Array<number>(tokens.length).fill(0);
    this.sequence(0, tokens.length, 0, 0);
    // A colon with a matching question mark in the same delimiter context is ternary.
    const questions: number[][] = [[]];
    for (let i = 0; i < tokens.length; i++) {
      const t = tokens[i]!.text;
      if (['(', '[', '{'].includes(t)) questions.push([]);
      else if ([')', ']', '}'].includes(t)) {
        if (questions.length > 1) questions.pop();
      } else if (t === '?') questions.at(-1)!.push(i);
      else if (t === ':' && questions.at(-1)!.length) {
        // A tag immediately attached to its operand, e.g. cond ? Float:x : y.
        const prev = tokens[i - 1];
        const next = tokens[i + 1];
        const tagged =
          prev?.kind === 'identifier' &&
          next &&
          tokens[i]!.end === next.start &&
          prev.end === tokens[i]!.start;
        if (!tagged) {
          questions.at(-1)!.pop();
          this.ternary.add(i);
        }
      } else if (t === ';') questions.at(-1)!.length = 0;
    }
  }

  private next(i: number, end: number): number {
    while (i < end && this.tokens[i]!.kind === 'comment') i++;
    return i;
  }

  private header(start: number, end: number, level: number): void {
    let depth = 0;
    const firstLine = this.tokens[start]?.line;
    let continuedLine = -1;
    for (let i = start; i < end; i++) {
      const t = this.tokens[i]!;
      if ([')', ']', '}'].includes(t.text)) depth = Math.max(0, depth - 1);
      const previous = this.tokens[i - 1];
      if (
        i > start &&
        previous &&
        t.line > previous.endLine &&
        (continuation.has(previous.text) || continuation.has(t.text))
      )
        continuedLine = t.line;
      this.indent[i] =
        level + (t.line !== firstLine && (depth > 0 || t.line === continuedLine) ? 1 : 0);
      if (['(', '[', '{'].includes(t.text)) depth++;
      if (t.text === '{' && this.tokens[(this.pairs.get(i) ?? -2) + 1]?.text === ':') {
        this.tags.add(i);
        this.tags.add(this.pairs.get(i)!);
      }
    }
  }

  private block(
    open: number,
    end: number,
    level: number,
    depth: number,
    isSwitch = false,
    isEnum = false,
  ): number {
    const close = this.pairs.get(open);
    if (close === undefined || close >= end) return open + 1;
    this.blocks.add(open);
    this.blocks.add(close);
    this.indent[open] = level;
    this.indent[close] = level;
    if (this.options.braceStyle === 'allman') this.breaks.add(open);
    this.breaks.add(open + 1);
    this.breaks.add(close);
    this.breaks.add(close + 1);
    this.sequence(open + 1, close, level + 1, depth + 1, isSwitch, isEnum);
    return close + 1;
  }

  private body(start: number, end: number, level: number, depth: number, isSwitch = false): number {
    const code = this.next(start, end);
    if (this.tokens[code]?.text === '{') {
      this.header(start, code, level);
      return this.block(code, end, level, depth, isSwitch);
    }
    if (this.tokens[code]?.text !== ';') this.breaks.add(start);
    this.header(start, code, level + 1);
    return this.statement(code, end, level + 1, depth + 1);
  }

  private statement(start: number, end: number, level: number, depth: number): number {
    if (depth > 256 || ++this.operations > this.tokens.length * 4 + 10)
      throw new Error('Formatting complexity limit reached.');
    const first = this.tokens[start]!;
    this.indent[start] = level;
    if (first.kind === 'comment' || first.kind === 'directive') return start + 1;
    if (first.text === '{') return this.block(start, end, level, depth);
    if (controls.has(first.text)) {
      const open = this.next(start + 1, end);
      const close = this.pairs.get(open);
      if (this.tokens[open]?.text === '(' && close !== undefined) {
        this.header(start, close + 1, level);
        let after = this.body(close + 1, end, level, depth, first.text === 'switch');
        const next = this.next(after, end);
        if (first.text === 'if' && this.tokens[next]?.text === 'else') {
          this.header(after, next + 1, level);
          this.breaks.add(next);
          const following = this.next(next + 1, end);
          if (this.tokens[following]?.text === 'if') {
            this.header(next + 1, following, level);
            after = this.statement(following, end, level, depth + 1);
          } else after = this.body(next + 1, end, level, depth);
        }
        return after;
      }
    }
    if (first.text === 'do') {
      const after = this.body(start + 1, end, level, depth);
      const next = this.next(after, end);
      if (this.tokens[next]?.text === 'while' && this.tokens[next + 1]?.text === '(') {
        const close = this.pairs.get(next + 1);
        if (close !== undefined) {
          const finish = this.tokens[close + 1]?.text === ';' ? close + 2 : close + 1;
          this.header(after, finish, level);
          this.breaks.add(next);
          this.breaks.add(finish);
          return finish;
        }
      }
      return after;
    }
    let i = start;
    let initializer = false;
    let isEnum = first.text === 'enum';
    while (i < end) {
      const t = this.tokens[i]!;
      if (i > start && t.kind === 'directive') break;
      if (i > start && t.line > this.tokens[i - 1]!.endLine) {
        const previous = this.tokens[i - 1]!.text;
        const continues =
          continuation.has(previous) ||
          continuation.has(t.text) ||
          t.text === '{' ||
          t.text === '(' ||
          t.text === '[';
        if (!continues && !isEnum) break;
      }
      if (t.text === '=') initializer = true;
      if (t.text === ';') {
        i++;
        this.breaks.add(i);
        break;
      }
      if (t.text === '(' || t.text === '[' || t.text === '{') {
        const close = this.pairs.get(i);
        if (close === undefined) {
          i++;
          continue;
        }
        if (t.text === '{') {
          if (this.tokens[close + 1]?.text === ':') {
            this.tags.add(i);
            this.tags.add(close);
          } else if (!initializer && first.text !== 'return') {
            this.header(start, i, level);
            const after = this.block(i, end, level, depth, false, isEnum);
            if (this.tokens[after]?.text === ';') {
              this.indent[after] = level;
              this.breaks.delete(after);
              return after + 1;
            }
            return after;
          }
        }
        i = close + 1;
        continue;
      }
      if (t.text === '}') break;
      if (t.text === 'enum') isEnum = true;
      i++;
    }
    const after = Math.max(start + 1, i);
    this.header(start, after, level);
    return after;
  }

  private sequence(
    start: number,
    end: number,
    level: number,
    depth: number,
    isSwitch = false,
    isEnum = false,
  ): void {
    let i = start;
    let caseBody = false;
    while (i < end) {
      if (isSwitch && ['case', 'default'].includes(this.tokens[i]!.text)) {
        const first = i;
        while (i < end) {
          if (['(', '['].includes(this.tokens[i]!.text)) i = this.pairs.get(i) ?? i;
          if (this.tokens[i]!.text === ':') {
            const next = this.tokens[i + 1];
            if (!(this.tokens[i - 1]?.text === '_' && next && next.start === this.tokens[i]!.end))
              break;
          }
          i++;
        }
        if (i < end) i++;
        this.header(first, i, level);
        this.breaks.add(first);
        this.breaks.add(i);
        caseBody = true;
      } else if (isEnum) {
        const first = i;
        while (i < end && this.tokens[i]!.text !== ',') {
          if (['(', '[', '{'].includes(this.tokens[i]!.text)) i = this.pairs.get(i) ?? i;
          i++;
        }
        if (i < end) i++;
        this.header(first, i, level);
        this.breaks.add(i);
      } else {
        i = this.statement(i, end, level + (caseBody ? 1 : 0), depth + 1);
      }
    }
  }
}

function inlineSpace(tokens: Token[], index: number, layout: Layout, source: string): string {
  const a = tokens[index - 1];
  const b = tokens[index]!;
  if (!a) return '';
  const left = a.text;
  const right = b.text;
  if (a.kind === 'unknown' || b.kind === 'unknown') return source.slice(a.end, b.start);
  if (a.kind === 'comment' || b.kind === 'comment') return ' ';
  if (right === ',' || right === ';' || right === ')' || right === ']') return '';
  if (left === '(' || left === '[' || right === '[') return '';
  if (left === '.') return '';
  if (right === '.') return left === ',' ? ' ' : '';
  if (right === '(')
    return controls.has(left) || prefixKeywords.has(left) || ['exit', 'sleep'].includes(left)
      ? ' '
      : a.kind === 'identifier' || left === ')'
        ? ''
        : ' ';
  if (right === ':') return layout.ternary.has(index) ? ' ' : '';
  if (left === ':') {
    if (layout.ternary.has(index - 1)) return ' ';
    // Preserve the lexical distinction between tags, labels and ternary colons.
    return /\s/.test(source.slice(a.end, b.start)) ? ' ' : '';
  }
  if (right === '++' || right === '--')
    return a.kind === 'identifier' || left === ')' || left === ']' ? '' : ' ';
  if (left === '++' || left === '--') return b.kind === 'identifier' ? '' : ' ';
  if (left === '!' || left === '~') return '';
  if (left === '+' || left === '-' || left === '&') {
    const before = tokens[index - 2];
    const unary =
      !before ||
      ['(', '[', '=', ',', ':', '?', '{'].includes(before.text) ||
      prefixKeywords.has(before.text) ||
      (before.kind === 'operator' && !['++', '--'].includes(before.text));
    if (unary && b.kind !== 'operator') return '';
  }
  if (left === '{' || right === '}') {
    if (layout.tags.has(right === '}' ? index : index - 1)) return '';
    if (left === '{' && right === '}') return '';
    return ' ';
  }
  return ' ';
}

function protectedLines(source: string, tokens: Token[]): Set<number> {
  const lines = new Set<number>();
  let off: number | undefined;
  for (const t of tokens) {
    if (t.kind === 'directive' || t.endLine > t.line) {
      for (let line = t.line; line <= t.endLine; line++) lines.add(line);
    }
    if (t.kind === 'comment' && /^\/\/\s*revo-format\s+off\b/.test(t.text)) off ??= t.line;
    if (t.kind === 'comment' && /^\/\/\s*revo-format\s+on\b/.test(t.text) && off !== undefined) {
      for (let line = off; line <= t.endLine; line++) lines.add(line);
      off = undefined;
    }
  }
  const physical = source.split(/\r\n|\r|\n/);
  if (off !== undefined) for (let line = off; line < physical.length; line++) lines.add(line);
  // Continuation whitespace belongs to a logical Pawn line and is kept verbatim.
  for (let i = 0; i < physical.length; i++)
    if (/\\[ \t]*$/.test(physical[i]!)) {
      lines.add(i);
      lines.add(i + 1);
    }
  return lines;
}

export function formatPawn(source: string, input: Partial<FormatOptions> = {}): FormatResult {
  const options = { ...defaultFormatOptions, ...input };
  options.tabSize = Math.max(1, Math.min(16, Math.trunc(options.tabSize) || 4));
  options.maxBlankLines = Math.max(0, Math.min(10, Math.trunc(options.maxBlankLines) || 0));
  const scan = lex(source);
  const delimiters = matchDelimiters(scan.tokens);
  const problems = [...scan.errors, ...delimiters.errors];
  if (
    scan.tokens.some(
      (token) =>
        token.text === '__LINE__' ||
        (token.kind === 'directive' && /\b__LINE__\b/.test(token.text)),
    )
  )
    problems.push('Source depends on physical line numbers (__LINE__).');
  if (scan.tokens.some((token) => token.kind === 'unknown' && token.text !== '\\'))
    problems.push('Unsupported syntax was preserved.');
  if (problems.length) return { text: source, changed: false, skippedReason: problems[0] };
  const eol = source.match(/\r\n|\n|\r/)?.[0] ?? '\n';
  const unit = options.insertSpaces ? ' '.repeat(options.tabSize) : '\t';
  const tokens = scan.tokens;
  let layout: Layout;
  try {
    layout = new Layout(tokens, delimiters.pairs, options);
  } catch {
    return { text: source, changed: false, skippedReason: 'Formatting complexity limit reached.' };
  }
  const protectedSet = protectedLines(source, tokens);
  const output: string[] = [];
  const bom = source.startsWith('\uFEFF') ? '\uFEFF' : '';
  let previous: Token | undefined;
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]!;
    const gap = source.slice(previous?.end ?? bom.length, t.start);
    const oldBreaks = gap.match(/\r\n|\r|\n/g)?.length ?? 0;
    const protectGap = protectedSet.has(t.line) || (previous && protectedSet.has(previous.endLine));
    if (protectGap) {
      // Preserve lines containing directives, literals and explicitly excluded code exactly.
      if (previous && oldBreaks > 0 && !protectedSet.has(t.line)) {
        const lastBreak = Math.max(gap.lastIndexOf('\n'), gap.lastIndexOf('\r'));
        output.push(gap.slice(0, lastBreak + 1), unit.repeat(layout.indent[i]!));
      } else output.push(gap);
    } else if (!previous) {
      output.push(
        eol.repeat(Math.min(oldBreaks, options.maxBlankLines)),
        unit.repeat(layout.indent[i]!),
      );
    } else {
      const trailingComment = t.kind === 'comment' && t.line === previous.endLine;
      const forced =
        layout.breaks.has(i) && !trailingComment && ![';', ',', ')', ']'].includes(t.text);
      if (oldBreaks || forced || previous.text.startsWith('//') || previous.kind === 'directive') {
        output.push(
          eol.repeat(Math.max(1, Math.min(oldBreaks, options.maxBlankLines + 1))),
          unit.repeat(layout.indent[i]!),
        );
      } else output.push(inlineSpace(tokens, i, layout, source));
    }
    output.push(t.text);
    previous = t;
  }
  let text = bom + output.join('');
  if (previous && protectedSet.has(previous.endLine)) text += source.slice(previous.end);
  else if (options.insertFinalNewline || /(?:\r\n|\r|\n)$/.test(source)) text += eol;
  if (!tokens.length) text = bom + (source.replace(/\s|\uFEFF/g, '') ? source : '');
  // Fail closed if spacing merged/split any token, changed a literal, comment or macro.
  const check = lex(text);
  if (
    check.errors.length ||
    check.tokens.length !== tokens.length ||
    check.tokens.some(
      (token, i) => token.kind !== tokens[i]!.kind || token.text !== tokens[i]!.text,
    )
  ) {
    return {
      text: source,
      changed: false,
      skippedReason: 'Token preservation check failed; the document was left unchanged.',
    };
  }
  return { text, changed: text !== source };
}

/** Format whole lines using surrounding syntax; refuse boundaries inside literals. */
export function formatPawnSelection(
  source: string,
  startLine: number,
  endLine: number,
  options: Partial<FormatOptions> = {},
): FormatResult {
  const result = formatPawn(source, options);
  if (!result.changed) return result;
  const original = lex(source);
  const formatted = lex(result.text);
  const start = original.lineStarts[startLine];
  const end = original.lineStarts[endLine + 1] ?? source.length;
  if (start === undefined || end < start) return { text: source, changed: false };
  const first = original.tokens.findIndex((item) => item.end > start);
  let last = original.tokens.length - 1;
  while (last >= 0 && original.tokens[last]!.start >= end) last--;
  if (
    first < 0 ||
    last < first ||
    original.tokens[first]!.start < start ||
    original.tokens[last]!.end > end
  )
    return { text: source, changed: false };
  const formattedFirst = formatted.tokens[first]!;
  const formattedLast = formatted.tokens[last]!;
  const text = result.text.slice(
    formatted.lineStarts[formattedFirst.line],
    formatted.lineStarts[formattedLast.endLine + 1] ?? result.text.length,
  );
  if (source.slice(start, end) === text) return { text: source, changed: false };
  return {
    text: source.slice(0, start) + text + source.slice(end),
    changed: true,
    rangeEdit: { start, end, text },
  };
}
