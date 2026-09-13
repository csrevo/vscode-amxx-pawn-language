import * as vscode from 'vscode';
import * as path from 'node:path';
import { configuration, includeDirectories } from './config';
import {
  visibleSymbols,
  type ParsedDocument,
  type PawnInclude,
  type PawnSymbol,
} from './core/parser';
import { WorkerClient } from './workerClient';

export interface LocatedSymbol {
  uri: vscode.Uri;
  symbol: PawnSymbol;
  parsed: ParsedDocument;
}
export interface LanguageContext {
  parsed: ParsedDocument;
  documents: Map<string, ParsedDocument>;
  symbols: LocatedSymbol[];
}
interface CacheEntry {
  version: string;
  promise: Promise<ParsedDocument>;
  bytes: number;
}

export class LanguageService {
  private readonly cache = new Map<string, CacheEntry>();
  private cacheBytes = 0;
  private readonly includeCache = new Map<string, { target?: vscode.Uri; expires: number }>();
  private readonly disposables: vscode.Disposable[] = [];

  constructor(readonly worker: WorkerClient) {
    const watcher = vscode.workspace.createFileSystemWatcher('**/*.{sma,inc}');
    this.disposables.push(
      watcher,
      watcher.onDidChange((uri) => this.invalidate(uri)),
      watcher.onDidCreate((uri) => this.invalidate(uri)),
      watcher.onDidDelete((uri) => this.invalidate(uri)),
      vscode.workspace.onDidCloseTextDocument((doc) => this.invalidate(doc.uri)),
      vscode.workspace.onDidChangeTextDocument((event) => this.invalidate(event.document.uri)),
      vscode.workspace.onDidChangeConfiguration((event) => {
        if (event.affectsConfiguration('revo_pawn')) this.clear();
      }),
    );
  }

  private remember(key: string, version: string, source: string): Promise<ParsedDocument> {
    const existing = this.cache.get(key);
    if (existing?.version === version) {
      this.cache.delete(key);
      this.cache.set(key, existing);
      return existing.promise;
    }
    const promise = this.worker.run('parse', source);
    const entry = { version, promise, bytes: Buffer.byteLength(source, 'utf8') };
    this.cacheBytes -= existing?.bytes ?? 0;
    this.cacheBytes += entry.bytes;
    this.cache.delete(key);
    this.cache.set(key, entry);
    while (this.cache.size > 128 || (this.cacheBytes > 8 * 1024 * 1024 && this.cache.size > 1))
      this.remove(this.cache.keys().next().value!);
    void promise.catch(() => {
      if (this.cache.get(key) === entry) this.remove(key);
    });
    return promise;
  }

  async document(document: vscode.TextDocument): Promise<ParsedDocument> {
    const version = document.version;
    const source = document.getText();
    this.checkSize(source, document.uri);
    const parsed = await this.remember(document.uri.toString(), `open:${version}`, source);
    this.checkVersion(document, version);
    return parsed;
  }

  private checkVersion(document: vscode.TextDocument, version: number): void {
    if (document.version !== version || document.isClosed) {
      const error = new Error('Document changed during analysis.');
      error.name = 'AbortError';
      throw error;
    }
  }

  private checkSize(source: string | number, root: vscode.Uri): void {
    const size = typeof source === 'string' ? Buffer.byteLength(source, 'utf8') : source;
    if (size > configuration(root).get<number>('language.maxFileSizeKB', 2048) * 1024)
      throw new Error('File exceeds revo_pawn.language.maxFileSizeKB.');
  }

  async file(uri: vscode.Uri, root: vscode.Uri): Promise<ParsedDocument> {
    const open = vscode.workspace.textDocuments.find(
      (document) => document.uri.toString() === uri.toString() && !document.isClosed,
    );
    if (open) return this.document(open);
    const stat = await vscode.workspace.fs.stat(uri);
    this.checkSize(stat.size, root);
    const version = `${stat.mtime}:${stat.size}`;
    const old = this.cache.get(uri.toString());
    if (old?.version === version) return old.promise;
    const bytes = await vscode.workspace.fs.readFile(uri);
    this.checkSize(bytes.byteLength, root);
    let source: string;
    try {
      source = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    } catch {
      source = new TextDecoder('windows-1252').decode(bytes);
    }
    return this.remember(uri.toString(), version, source);
  }

  async resolve(
    include: PawnInclude,
    from: vscode.Uri,
    root: vscode.Uri,
  ): Promise<vscode.Uri | undefined> {
    const directories = includeDirectories(root);
    if (include.local) directories.unshift(path.dirname(root.fsPath), path.dirname(from.fsPath));
    const key = JSON.stringify([include.name, directories]);
    const cached = this.includeCache.get(key);
    if (cached && cached.expires > Date.now()) return cached.target;
    for (const directory of new Set(directories)) {
      for (const suffix of ['', '.inc', '.p', '.pawn']) {
        const candidate = vscode.Uri.file(path.resolve(directory, include.name + suffix));
        const open = vscode.workspace.textDocuments.some(
          (doc) => doc.uri.toString() === candidate.toString(),
        );
        try {
          if (open || (await vscode.workspace.fs.stat(candidate)).type & vscode.FileType.File) {
            this.includeCache.set(key, { target: candidate, expires: Date.now() + 2000 });
            this.trimIncludes();
            return candidate;
          }
        } catch {
          /* Try the next include path. Missing includes are diagnosed by amxxpc. */
        }
      }
    }
    this.includeCache.set(key, { expires: Date.now() + 2000 });
    this.trimIncludes();
    return undefined;
  }

  private trimIncludes(): void {
    while (this.includeCache.size > 1024)
      this.includeCache.delete(this.includeCache.keys().next().value!);
  }

  async context(
    document: vscode.TextDocument,
    offset: number,
    token: vscode.CancellationToken,
  ): Promise<LanguageContext> {
    const version = document.version;
    const parsed = await this.document(document);
    const documents = new Map<string, ParsedDocument>([[document.uri.toString(), parsed]]);
    const symbols: LocatedSymbol[] = visibleSymbols(parsed.symbols, offset).map((symbol) => ({
      uri: document.uri,
      parsed,
      symbol,
    }));
    const visited = new Set<string>(documents.keys());
    const queue: Array<{ uri: vscode.Uri; parsed: ParsedDocument }> = [
      { uri: document.uri, parsed },
    ];
    const max = configuration(document.uri).get<number>('language.maxIncludeFiles', 256);
    for (let i = 0; i < queue.length && visited.size < max && !token.isCancellationRequested; i++) {
      const item = queue[i]!;
      for (const include of item.parsed.includes) {
        if (token.isCancellationRequested || visited.size >= max) break;
        const uri = await this.resolve(include, item.uri, document.uri);
        if (!uri || visited.has(uri.toString())) continue;
        visited.add(uri.toString());
        try {
          const included = await this.file(uri, document.uri);
          documents.set(uri.toString(), included);
          queue.push({ uri, parsed: included });
          symbols.push(
            ...included.symbols
              .filter((symbol) => symbol.scopeStart === undefined)
              .map((symbol) => ({ uri, parsed: included, symbol })),
          );
        } catch (error) {
          if (error instanceof vscode.FileSystemError) continue;
          throw error;
        }
      }
    }
    this.checkVersion(document, version);
    return { parsed, documents, symbols };
  }

  private remove(key: string): void {
    this.cacheBytes -= this.cache.get(key)?.bytes ?? 0;
    this.cache.delete(key);
  }
  invalidate(uri: vscode.Uri): void {
    this.remove(uri.toString());
    this.includeCache.clear();
  }
  clear(): void {
    this.cache.clear();
    this.cacheBytes = 0;
    this.includeCache.clear();
  }
  dispose(): void {
    this.clear();
    for (const item of this.disposables) item.dispose();
  }
}
