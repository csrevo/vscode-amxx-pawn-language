import * as vscode from 'vscode';
import * as path from 'node:path';
import { mkdir, stat, rename, rm } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { configuration, includeDirectories, pathContext } from './config';
import { expandPath, validateCompilerArguments } from './core/paths';
import { parseCompilerDiagnostics } from './core/diagnostics';
import { runCompiler } from './core/process';
import type { LanguageService } from './languageService';

interface BuildDiagnostics {
  files: Set<string>;
  diagnostics: Map<string, vscode.Diagnostic[]>;
}

export class Compiler {
  private abort?: AbortController;
  private generation = 0;
  private readonly builds = new Map<string, BuildDiagnostics>();
  private readonly disposables: vscode.Disposable[] = [];
  private readonly saving = new Set<string>();

  constructor(
    private readonly output: vscode.OutputChannel,
    private readonly diagnostics: vscode.DiagnosticCollection,
    private readonly language: LanguageService,
  ) {
    this.disposables.push(
      vscode.workspace.onDidChangeTextDocument((event) => {
        for (const [key, build] of this.builds)
          if (build.files.has(event.document.uri.toString())) this.builds.delete(key);
        this.publish();
      }),
      vscode.workspace.onDidSaveTextDocument((document) => {
        if (
          !this.saving.has(document.uri.toString()) &&
          document.languageId === 'amxxpawn' &&
          /\.sma$/i.test(document.fileName) &&
          vscode.workspace.isTrusted &&
          configuration(document.uri).get<boolean>('compiler.compileOnSave', false)
        )
          void this.compile(document, false, true);
      }),
    );
  }

  async compile(
    document?: vscode.TextDocument,
    local = false,
    automatic = false,
  ): Promise<boolean> {
    document ??= vscode.window.activeTextEditor?.document;
    if (!document || document.uri.scheme !== 'file' || !/\.sma$/i.test(document.fileName)) {
      if (!automatic)
        void vscode.window.showWarningMessage('Revo Pawn: open a saved .sma file to compile.');
      return false;
    }
    if (!vscode.workspace.isTrusted) {
      if (!automatic)
        void vscode.window.showWarningMessage(
          'Revo Pawn: the workspace must be trusted before running amxxpc.',
        );
      return false;
    }
    this.abort?.abort();
    const generation = ++this.generation;
    const abort = new AbortController();
    this.abort = abort;
    const uri = document.uri;
    const config = configuration(uri);
    let temporaryOutput: string | undefined;
    try {
      this.saving.add(uri.toString());
      try {
        if (document.isDirty && !(await document.save()))
          throw new Error('The source file could not be saved.');
      } finally {
        this.saving.delete(uri.toString());
      }
      if (abort.signal.aborted) return false;
      const executableName = process.platform === 'win32' ? 'amxxpc.exe' : 'amxxpc';
      const configured = config.get<string>('compiler.path', '');
      const executable =
        local || !configured
          ? path.join(path.dirname(document.fileName), executableName)
          : expandPath(configured, pathContext(uri));
      if (process.platform === 'win32' && !/\.exe$/i.test(executable))
        throw new Error('compiler.path must point to an .exe file on Windows.');
      if (!(await stat(executable)).isFile())
        throw new Error('The configured amxxpc path is not a file.');
      const extra = validateCompilerArguments(config.get<string[]>('compiler.arguments', []));
      const directory = expandPath(
        config.get<string>('compiler.outputDirectory', '${fileDirname}/compiled'),
        pathContext(uri),
      );
      await mkdir(directory, { recursive: true });
      const target = path.join(
        directory,
        `${path.basename(document.fileName, path.extname(document.fileName))}.amxx`,
      );
      temporaryOutput = path.join(directory, `.revo-${randomUUID()}.amxx`);
      const includes = includeDirectories(uri);
      includes.push(path.join(path.dirname(executable), 'include'));
      const args = [
        document.fileName,
        ...extra,
        ...[...new Set(includes)].map((entry) => `-i${entry}`),
        `-o${temporaryOutput}`,
      ];
      const cancellation = new vscode.CancellationTokenSource();
      const cancelContext = (): void => cancellation.cancel();
      abort.signal.addEventListener('abort', cancelContext, { once: true });
      let context;
      try {
        context = await this.language.context(document, 0, cancellation.token);
      } finally {
        abort.signal.removeEventListener('abort', cancelContext);
        cancellation.dispose();
      }
      if (abort.signal.aborted) return false;
      const dependencies = new Set(context.documents.keys());
      // Compile the same include contents that IntelliSense shows.
      for (const open of vscode.workspace.textDocuments) {
        if (dependencies.has(open.uri.toString()) && open.isDirty) {
          this.saving.add(open.uri.toString());
          try {
            if (!(await open.save())) throw new Error(`Could not save ${open.fileName}.`);
          } finally {
            this.saving.delete(open.uri.toString());
          }
        }
      }
      const versions = new Map(
        vscode.workspace.textDocuments
          .filter((item) => dependencies.has(item.uri.toString()))
          .map((item) => [item.uri.toString(), item.version]),
      );
      this.output.appendLine(`\nCompiling ${document.fileName}`);
      if (!automatic && config.get<boolean>('compiler.showOutput', true)) this.output.show(true);
      const result = await runCompiler({
        executable,
        arguments: args,
        cwd: path.dirname(document.fileName),
        timeoutMs: config.get<number>('compiler.timeoutSeconds', 60) * 1000,
        signal: abort.signal,
        onOutput: (chunk) => this.output.append(chunk),
      });
      if (abort.signal.aborted || generation !== this.generation) return false;
      const parsed = parseCompilerDiagnostics(result.output);
      const grouped = new Map<string, vscode.Diagnostic[]>();
      for (const item of parsed) {
        const fileUri = vscode.Uri.file(path.resolve(path.dirname(document.fileName), item.file));
        dependencies.add(fileUri.toString());
        const diagnostic = new vscode.Diagnostic(
          new vscode.Range(item.startLine, 0, item.endLine, Number.MAX_SAFE_INTEGER),
          item.message,
          item.severity === 'error'
            ? vscode.DiagnosticSeverity.Error
            : vscode.DiagnosticSeverity.Warning,
        );
        diagnostic.source = 'amxxpc';
        diagnostic.code = item.code;
        const list = grouped.get(fileUri.toString()) ?? [];
        list.push(diagnostic);
        grouped.set(fileUri.toString(), list);
      }
      const stale = vscode.workspace.textDocuments.some(
        (item) =>
          versions.has(item.uri.toString()) && versions.get(item.uri.toString()) !== item.version,
      );
      if (!stale) {
        this.builds.set(uri.toString(), { files: dependencies, diagnostics: grouped });
        this.publish();
      }
      const success = result.code === 0 && !parsed.some((item) => item.severity === 'error');
      if (!success) {
        this.output.appendLine(
          `Compilation failed (exit ${result.code}). The previous .amxx was preserved.`,
        );
        return false;
      }
      if (!(await stat(temporaryOutput)).size)
        throw new Error('amxxpc exited successfully but did not produce a nonempty plugin.');
      if (stale) {
        this.output.appendLine('Source changed during compilation; the stale build was discarded.');
        return false;
      }
      await rename(temporaryOutput, target);
      temporaryOutput = undefined;
      this.output.appendLine(`Built: ${target}`);
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.output.appendLine(`Revo Pawn: ${message}`);
      if (!automatic && !abort.signal.aborted)
        void vscode.window.showErrorMessage(`Revo Pawn: ${message}`);
      return false;
    } finally {
      if (temporaryOutput) await rm(temporaryOutput, { force: true }).catch(() => undefined);
      if (this.abort === abort) this.abort = undefined;
    }
  }

  cancel(): void {
    this.abort?.abort();
  }

  private publish(): void {
    this.diagnostics.clear();
    const combined = new Map<string, vscode.Diagnostic[]>();
    for (const build of this.builds.values())
      for (const [uri, items] of build.diagnostics) {
        const existing = combined.get(uri) ?? [];
        for (const item of items)
          if (
            !existing.some(
              (other) =>
                other.range.isEqual(item.range) &&
                other.code === item.code &&
                other.message === item.message,
            )
          )
            existing.push(item);
        combined.set(uri, existing);
      }
    this.diagnostics.set([...combined].map(([uri, items]) => [vscode.Uri.parse(uri), items]));
  }

  dispose(): void {
    this.cancel();
    for (const item of this.disposables) item.dispose();
    this.builds.clear();
  }
}
