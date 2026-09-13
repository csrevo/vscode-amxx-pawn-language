import * as vscode from 'vscode';
import * as path from 'node:path';
import { configuration, formatterOptions, includeDirectories, selector } from './config';
import { tokenAt } from './core/lexer';
import { callAt, keywords, type PawnSymbolKind, type ParsedDocument } from './core/parser';
import { Compiler } from './compiler';
import { LanguageService, type LocatedSymbol } from './languageService';
import { WorkerClient } from './workerClient';

const symbolKinds: Record<PawnSymbolKind, vscode.SymbolKind> = {
  function: vscode.SymbolKind.Function,
  variable: vscode.SymbolKind.Variable,
  constant: vscode.SymbolKind.Constant,
  enum: vscode.SymbolKind.Enum,
  macro: vscode.SymbolKind.Constant,
  parameter: vscode.SymbolKind.Variable,
};
const completionKinds: Record<PawnSymbolKind, vscode.CompletionItemKind> = {
  function: vscode.CompletionItemKind.Function,
  variable: vscode.CompletionItemKind.Variable,
  constant: vscode.CompletionItemKind.Constant,
  enum: vscode.CompletionItemKind.Enum,
  macro: vscode.CompletionItemKind.Constant,
  parameter: vscode.CompletionItemKind.Variable,
};
const standardIncludes = new Set([
  'amxmodx',
  'amxmisc',
  'cellarray',
  'cellstack',
  'celltrie',
  'core',
  'cstrike',
  'csx',
  'engine',
  'engine_const',
  'fakemeta',
  'fakemeta_const',
  'fakemeta_stocks',
  'file',
  'float',
  'fun',
  'hamsandwich',
  'ham_const',
  'message_const',
  'newmenus',
  'nvault',
  'regex',
  'sockets',
  'sqlx',
  'string',
  'textparse',
  'xs',
]);

export function activate(context: vscode.ExtensionContext): void {
  const output = vscode.window.createOutputChannel('Revo Pawn');
  const worker = new WorkerClient(context.asAbsolutePath('dist/worker.js'));
  const service = new LanguageService(worker);
  const diagnostics = vscode.languages.createDiagnosticCollection('revo_pawn');
  const compiler = new Compiler(output, diagnostics, service);
  const logged = new Set<string>();

  const safely = async <T>(action: () => Promise<T>): Promise<T | undefined> => {
    try {
      return await action();
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') return undefined;
      const message = error instanceof Error ? error.message : String(error);
      if (!logged.has(message)) {
        output.appendLine(message);
        logged.add(message);
        if (logged.size > 100) logged.clear();
      }
      return undefined;
    }
  };

  const formatting = async (
    document: vscode.TextDocument,
    options: vscode.FormattingOptions,
    token: vscode.CancellationToken,
    selection?: vscode.Range,
  ): Promise<vscode.TextEdit[]> => {
    if (
      !configuration(document.uri).get<boolean>('format.enable', true) ||
      token.isCancellationRequested
    )
      return [];
    const source = document.getText();
    if (
      Buffer.byteLength(source, 'utf8') >
      configuration(document.uri).get<number>('language.maxFileSizeKB', 2048) * 1024
    ) {
      output.appendLine(
        `Formatting skipped: ${document.fileName} exceeds revo_pawn.language.maxFileSizeKB.`,
      );
      return [];
    }
    const version = document.version;
    const abort = new AbortController();
    const subscription = token.onCancellationRequested(() => abort.abort());
    try {
      if (token.isCancellationRequested) return [];
      const selectionLines = selection
        ? {
            startLine: selection.start.line,
            endLine:
              selection.end.character === 0 && selection.end.line > selection.start.line
                ? selection.end.line - 1
                : selection.end.line,
          }
        : undefined;
      const result = await worker.run(
        'format',
        source,
        { ...formatterOptions(document.uri, options), selection: selectionLines },
        abort.signal,
      );
      if (token.isCancellationRequested || document.version !== version) return [];
      if (result.skippedReason)
        output.appendLine(`Formatting skipped (${document.fileName}): ${result.skippedReason}`);
      if (!result.changed) return [];
      if (!selection)
        return [
          vscode.TextEdit.replace(
            new vscode.Range(document.positionAt(0), document.positionAt(source.length)),
            result.text,
          ),
        ];
      const edit = result.rangeEdit;
      return edit
        ? [
            vscode.TextEdit.replace(
              new vscode.Range(document.positionAt(edit.start), document.positionAt(edit.end)),
              edit.text,
            ),
          ]
        : [];
    } finally {
      subscription.dispose();
    }
  };

  context.subscriptions.push(
    output,
    worker,
    service,
    diagnostics,
    compiler,
    vscode.commands.registerCommand('revo_pawn.compile', () => compiler.compile()),
    vscode.commands.registerCommand('revo_pawn.compileLocal', () =>
      compiler.compile(undefined, true),
    ),
    vscode.commands.registerCommand('revo_pawn.cancelCompilation', () => compiler.cancel()),
    vscode.commands.registerCommand('revo_pawn.showOutput', () => output.show()),
    vscode.languages.registerDocumentFormattingEditProvider(selector, {
      provideDocumentFormattingEdits: (document, options, token) =>
        safely(() => formatting(document, options, token)),
    }),
    vscode.languages.registerDocumentRangeFormattingEditProvider(selector, {
      provideDocumentRangeFormattingEdits: (document, range, options, token) =>
        safely(() => formatting(document, options, token, range)),
    }),
    vscode.languages.registerCompletionItemProvider(
      selector,
      {
        provideCompletionItems: (document, position, token) =>
          safely(async () => {
            const before = document.lineAt(position).text.slice(0, position.character);
            const include = /^\s*#\s*(?:tryinclude|include)\s*[<"]([^>"]*)$/.exec(before);
            if (include) return includeCompletions(document.uri, include[1]!, token);
            const offset = document.offsetAt(position);
            const data = await service.context(document, offset, token);
            if (token.isCancellationRequested || suppressed(data.parsed, offset)) return [];
            const byName = new Map<string, vscode.CompletionItem>();
            for (const { symbol } of data.symbols) {
              if (byName.has(symbol.name)) continue;
              const item = new vscode.CompletionItem(symbol.name, completionKinds[symbol.kind]);
              item.detail = symbol.detail;
              item.documentation = plainDocumentation(symbol.documentation);
              item.sortText =
                symbol.scopeStart !== undefined ? `0_${symbol.name}` : `1_${symbol.name}`;
              byName.set(symbol.name, item);
            }
            for (const keyword of keywords)
              if (!byName.has(keyword))
                byName.set(
                  keyword,
                  new vscode.CompletionItem(keyword, vscode.CompletionItemKind.Keyword),
                );
            return [...byName.values()];
          }),
      },
      '.',
      '/',
      '<',
      '"',
    ),
    vscode.languages.registerHoverProvider(selector, {
      provideHover: (document, position, token) =>
        safely(async () => {
          const offset = document.offsetAt(position);
          const data = await service.context(document, offset, token);
          if (token.isCancellationRequested) return undefined;
          const word = tokenAt(data.parsed.tokens, offset);
          if (word?.kind !== 'identifier') return undefined;
          const found = data.symbols.find((item) => item.symbol.name === word.text);
          if (!found) return undefined;
          const content = new vscode.MarkdownString().appendCodeblock(
            found.symbol.detail,
            'amxxpawn',
          );
          if (found.symbol.documentation) content.appendText(`\n\n${found.symbol.documentation}`);
          content.isTrusted = false;
          return new vscode.Hover(
            content,
            new vscode.Range(document.positionAt(word.start), document.positionAt(word.end)),
          );
        }),
    }),
    vscode.languages.registerDefinitionProvider(selector, {
      provideDefinition: (document, position, token) =>
        safely(async () => {
          const offset = document.offsetAt(position);
          const data = await service.context(document, offset, token);
          if (token.isCancellationRequested) return [];
          const include = data.parsed.includes.find(
            (item) => offset >= item.start && offset <= item.end,
          );
          if (include) {
            const uri = await service.resolve(include, document.uri, document.uri);
            return uri ? [new vscode.Location(uri, new vscode.Position(0, 0))] : [];
          }
          const word = tokenAt(data.parsed.tokens, offset);
          if (word?.kind !== 'identifier') return [];
          const found = data.symbols.find((item) => item.symbol.name === word.text);
          return found ? [location(found)] : [];
        }),
    }),
    vscode.languages.registerSignatureHelpProvider(
      selector,
      {
        provideSignatureHelp: (document, position, token) =>
          safely(async () => {
            const offset = document.offsetAt(position);
            const data = await service.context(document, offset, token);
            if (token.isCancellationRequested) return undefined;
            const call = callAt(data.parsed.tokens, offset);
            if (!call) return undefined;
            const definitions = data.symbols.filter(
              (item) => item.symbol.kind === 'function' && item.symbol.name === call.name,
            );
            if (!definitions.length) return undefined;
            const help = new vscode.SignatureHelp();
            const unique = new Set<string>();
            for (const { symbol } of definitions) {
              if (unique.has(symbol.detail)) continue;
              unique.add(symbol.detail);
              const signature = new vscode.SignatureInformation(
                symbol.detail,
                plainDocumentation(symbol.documentation),
              );
              signature.parameters = (symbol.parameters ?? []).map(
                (parameter) => new vscode.ParameterInformation(parameter.label),
              );
              signature.activeParameter = Math.max(
                0,
                Math.min(call.parameter, signature.parameters.length - 1),
              );
              help.signatures.push(signature);
            }
            help.activeSignature = 0;
            help.activeParameter = help.signatures[0]?.activeParameter ?? 0;
            return help;
          }),
      },
      '(',
      ',',
    ),
    vscode.languages.registerDocumentSymbolProvider(selector, {
      provideDocumentSymbols: (document, token) =>
        safely(async () => {
          const data = await service.document(document);
          if (token.isCancellationRequested) return [];
          return data.symbols
            .filter((symbol) => symbol.scopeStart === undefined)
            .map(
              (symbol) =>
                new vscode.DocumentSymbol(
                  symbol.name,
                  symbol.detail,
                  symbolKinds[symbol.kind],
                  new vscode.Range(
                    document.positionAt(symbol.start),
                    document.positionAt(symbol.end),
                  ),
                  new vscode.Range(
                    document.positionAt(symbol.nameStart),
                    document.positionAt(symbol.nameEnd),
                  ),
                ),
            );
        }),
    }),
    vscode.languages.registerFoldingRangeProvider(selector, {
      provideFoldingRanges: (document, _context, token) =>
        safely(async () => {
          const data = await service.document(document);
          if (token.isCancellationRequested) return [];
          return data.folds
            .filter((fold) => fold.end > fold.start)
            .map(
              (fold) =>
                new vscode.FoldingRange(
                  fold.start,
                  fold.end,
                  fold.kind === 'comment'
                    ? vscode.FoldingRangeKind.Comment
                    : fold.kind === 'region'
                      ? vscode.FoldingRangeKind.Region
                      : undefined,
                ),
            );
        }),
    }),
    vscode.languages.registerDocumentLinkProvider(selector, {
      provideDocumentLinks: (document, token) =>
        safely(async () => {
          const data = await service.document(document);
          const links: vscode.DocumentLink[] = [];
          for (const include of data.includes) {
            if (token.isCancellationRequested) break;
            let target = await service.resolve(include, document.uri, document.uri);
            const base = include.name.replace(/\.inc$/, '');
            if (
              !target &&
              configuration(document.uri).get<boolean>('language.webApiLinks', false) &&
              standardIncludes.has(base)
            )
              target = vscode.Uri.parse(`https://www.amxmodx.org/api/${encodeURIComponent(base)}`);
            if (target)
              links.push(
                new vscode.DocumentLink(
                  new vscode.Range(
                    document.positionAt(include.start),
                    document.positionAt(include.end),
                  ),
                  target,
                ),
              );
          }
          return links;
        }),
    }),
  );
}

function suppressed(parsed: ParsedDocument, offset: number): boolean {
  const item = tokenAt(parsed.tokens, Math.max(0, offset - 1));
  return !!item && ['comment', 'string', 'character', 'directive'].includes(item.kind);
}

function plainDocumentation(text: string): vscode.MarkdownString {
  const markdown = new vscode.MarkdownString().appendText(text);
  markdown.isTrusted = false;
  return markdown;
}

function parsedPosition(parsed: ParsedDocument, offset: number): vscode.Position {
  let low = 0;
  let high = parsed.lineStarts.length;
  while (low + 1 < high) {
    const mid = (low + high) >>> 1;
    if (parsed.lineStarts[mid]! > offset) high = mid;
    else low = mid;
  }
  return new vscode.Position(low, offset - parsed.lineStarts[low]!);
}

function location(item: LocatedSymbol): vscode.Location {
  return new vscode.Location(
    item.uri,
    new vscode.Range(
      parsedPosition(item.parsed, item.symbol.nameStart),
      parsedPosition(item.parsed, item.symbol.nameEnd),
    ),
  );
}

async function includeCompletions(
  uri: vscode.Uri,
  prefix: string,
  token: vscode.CancellationToken,
): Promise<vscode.CompletionItem[]> {
  const directories = [path.dirname(uri.fsPath), ...includeDirectories(uri)];
  const subdirectory =
    prefix.includes('/') || prefix.includes('\\')
      ? prefix.slice(0, Math.max(prefix.lastIndexOf('/'), prefix.lastIndexOf('\\')) + 1)
      : '';
  const found = new Map<string, vscode.CompletionItem>();
  for (const directory of directories) {
    if (token.isCancellationRequested) break;
    try {
      const entries = await vscode.workspace.fs.readDirectory(
        vscode.Uri.file(path.resolve(directory, subdirectory)),
      );
      for (const [name, type] of entries.slice(0, 2000)) {
        if (type & vscode.FileType.Directory) {
          const item = new vscode.CompletionItem(name, vscode.CompletionItemKind.Folder);
          item.insertText = `${name}/`;
          found.set(name, item);
        } else if (/\.inc$/i.test(name)) {
          const label = name.replace(/\.inc$/i, '');
          found.set(label, new vscode.CompletionItem(label, vscode.CompletionItemKind.File));
        }
      }
    } catch {
      /* Missing optional include directories are expected before SDK setup. */
    }
  }
  return [...found.values()];
}
