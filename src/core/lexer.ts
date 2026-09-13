/** Lossless Pawn lexer. Offsets are UTF-16, as required by the VS Code API. */
export type TokenKind =
  | 'identifier'
  | 'number'
  | 'string'
  | 'character'
  | 'comment'
  | 'directive'
  | 'operator'
  | 'punctuation'
  | 'unknown';

export interface Token {
  kind: TokenKind;
  text: string;
  start: number;
  end: number;
  line: number;
  endLine: number;
}

export interface LexResult {
  tokens: Token[];
  lineStarts: number[];
  errors: string[];
}

const operators = [
  '>>>=',
  '<<=',
  '>>=',
  '...',
  '>>>',
  '++',
  '--',
  '==',
  '!=',
  '<=',
  '>=',
  '&&',
  '||',
  '<<',
  '>>',
  '+=',
  '-=',
  '*=',
  '/=',
  '%=',
  '&=',
  '|=',
  '^=',
  '..',
];
const identifierStart = /[A-Za-z_@]/;
const identifierPart = /[A-Za-z0-9_@]/;

export function lex(source: string): LexResult {
  const tokens: Token[] = [];
  const lineStarts = [0];
  const errors: string[] = [];
  let i = 0;
  let line = 0;
  let onlyWhitespace = true;
  let ctrlchar = '^';
  let conditionalDepth = 0;

  const advance = (): void => {
    if (source[i] === '\r') {
      if (source[i + 1] === '\n') i++;
      lineStarts.push(i + 1);
      line++;
      onlyWhitespace = true;
    } else if (source[i] === '\n') {
      lineStarts.push(i + 1);
      line++;
      onlyWhitespace = true;
    }
    i++;
  };

  while (i < source.length) {
    const c = source[i]!;
    if (/\s/.test(c) || (i === 0 && c === '\uFEFF')) {
      advance();
      continue;
    }
    const start = i;
    const startLine = line;
    let kind: TokenKind;
    if (c === '#' && onlyWhitespace) {
      kind = 'directive';
      let inBlock = false;
      let quote = '';
      while (i < source.length) {
        const d = source[i]!;
        if (d === '\n' || d === '\r') {
          let last = i - 1;
          while (last >= start && /[ \t]/.test(source[last]!)) last--;
          if (!inBlock && source[last] !== '\\') break;
          advance();
          continue;
        }
        if (inBlock) {
          if (d === '*' && source[i + 1] === '/') {
            i += 2;
            inBlock = false;
          } else advance();
        } else if (quote) {
          if (d === ctrlchar && i + 1 < source.length) {
            i += 2;
          } else {
            if (d === quote) quote = '';
            advance();
          }
        } else if (d === '/' && source[i + 1] === '*') {
          inBlock = true;
          i += 2;
        } else if (d === '/' && source[i + 1] === '/') {
          while (i < source.length && source[i] !== '\n' && source[i] !== '\r') i++;
        } else {
          if (d === '"' || d === "'") quote = d;
          advance();
        }
      }
      if (inBlock) errors.push('Unterminated comment in a preprocessor directive.');
      const directive = source.slice(start, i);
      if (/^#\s*if\b/.test(directive)) conditionalDepth++;
      if (/^#\s*endif\b/.test(directive)) conditionalDepth = Math.max(0, conditionalDepth - 1);
      if (/^#\s*pragma\s+ctrlchar\b/.test(directive)) {
        const value = directive
          .replace(/^#\s*pragma\s+ctrlchar\b/, '')
          .replace(/\/\/.*$/, '')
          .trim();
        if (conditionalDepth)
          errors.push('Conditional #pragma ctrlchar cannot be resolved safely.');
        if (!value) ctrlchar = '^';
        else if (/^'(.)'$/.test(value)) ctrlchar = value[1]!;
        else if (/^(?:0x[\da-f]+|\d+)$/i.test(value)) ctrlchar = String.fromCharCode(Number(value));
        else errors.push('Unsupported #pragma ctrlchar expression.');
      }
    } else if (c === '/' && source[i + 1] === '/') {
      kind = 'comment';
      while (i < source.length) {
        if (source[i] === '\n' || source[i] === '\r') {
          let last = i - 1;
          while (last >= start && /[ \t]/.test(source[last]!)) last--;
          if (source[last] !== '\\') break;
        }
        advance();
      }
    } else if (c === '/' && source[i + 1] === '*') {
      kind = 'comment';
      i += 2;
      while (i < source.length && !(source[i] === '*' && source[i + 1] === '/')) advance();
      if (i === source.length) errors.push('Unterminated block comment.');
      else i += 2;
    } else {
      let quoteAt = i;
      // Pawn has !"packed", ^"raw", !^"packed raw" and ^!"packed raw".
      if (c === '!' || c === ctrlchar) {
        quoteAt++;
        if (
          (c === '!' && source[quoteAt] === ctrlchar) ||
          (c === ctrlchar && source[quoteAt] === '!')
        )
          quoteAt++;
        if (source[quoteAt] !== '"') quoteAt = i;
      }
      if (source[quoteAt] === '"' || c === "'") {
        const quote = source[quoteAt]!;
        kind = quote === '"' ? 'string' : 'character';
        const raw = source.slice(i, quoteAt).includes(ctrlchar);
        i = quoteAt + 1;
        let closed = false;
        while (i < source.length) {
          if (source[i] === quote) {
            i++;
            closed = true;
            break;
          }
          if (source[i] === '\n' || source[i] === '\r') {
            let last = i - 1;
            while (last >= start && /[ \t]/.test(source[last]!)) last--;
            if (source[last] !== '\\') {
              errors.push('Unterminated string or character literal.');
              break;
            }
          }
          if (
            !raw &&
            source[i] === ctrlchar &&
            source[i + 1] !== '\n' &&
            source[i + 1] !== '\r' &&
            i + 1 < source.length
          )
            i += 2;
          else advance();
        }
        if (!closed && i === source.length)
          errors.push('Unterminated string or character literal.');
      } else if (identifierStart.test(c)) {
        kind = 'identifier';
        i++;
        while (i < source.length && identifierPart.test(source[i]!)) i++;
      } else if (/[0-9]/.test(c)) {
        kind = 'number';
        if (c === '0' && /[xXbB]/.test(source[i + 1] ?? '')) {
          i += 2;
          while (i < source.length && /[\da-fA-F_]/.test(source[i]!)) i++;
        } else {
          while (i < source.length && /[\d_]/.test(source[i]!)) i++;
          if (source[i] === '.' && /\d/.test(source[i + 1] ?? '')) {
            i++;
            while (i < source.length && /[\d_]/.test(source[i]!)) i++;
          }
          if (/[eE]/.test(source[i] ?? '') && /[+\-\d]/.test(source[i + 1] ?? '')) {
            i++;
            if (/[+-]/.test(source[i] ?? '')) i++;
            while (i < source.length && /[\d_]/.test(source[i]!)) i++;
          }
        }
      } else {
        const op = operators.find((operator) => source.startsWith(operator, i));
        if (op) {
          kind = 'operator';
          i += op.length;
        } else {
          kind = '{}()[],;'.includes(c)
            ? 'punctuation'
            : '+-*/%=!<>&|^~?:.'.includes(c)
              ? 'operator'
              : 'unknown';
          i++;
        }
      }
    }
    tokens.push({
      kind,
      text: source.slice(start, i),
      start,
      end: i,
      line: startLine,
      endLine: line,
    });
    onlyWhitespace = false;
  }
  return { tokens, lineStarts, errors };
}

export interface Delimiters {
  pairs: Map<number, number>;
  errors: string[];
}

export function matchDelimiters(tokens: readonly Token[]): Delimiters {
  const pairs = new Map<number, number>();
  const stack: number[] = [];
  const errors: string[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i]!;
    if (token.kind !== 'punctuation') continue;
    if ('({['.includes(token.text)) {
      stack.push(i);
      if (stack.length > 256) {
        errors.push('Nesting exceeds the safe limit of 256.');
        break;
      }
    } else if (')}]'.includes(token.text)) {
      const start = stack.pop();
      if (start === undefined || '({['[')}]'.indexOf(token.text)] !== tokens[start]!.text) {
        errors.push(`Unbalanced delimiter on line ${token.line + 1}.`);
      } else {
        pairs.set(start, i);
        pairs.set(i, start);
      }
    }
  }
  if (stack.length)
    errors.push('Unclosed delimiter. Conditional branches may have different syntax.');
  return { pairs, errors };
}

export function tokenAt(tokens: readonly Token[], offset: number): Token | undefined {
  let low = 0;
  let high = tokens.length - 1;
  while (low <= high) {
    const mid = (low + high) >>> 1;
    const token = tokens[mid]!;
    if (offset < token.start) high = mid - 1;
    else if (offset >= token.end) low = mid + 1;
    else return token;
  }
  return undefined;
}
