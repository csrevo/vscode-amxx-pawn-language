import * as vscode from 'vscode';
import * as path from 'node:path';
import { expandPath, type PathContext } from './core/paths';
import type { FormatOptions } from './core/formatter';

export const section = 'revo_pawn';
export const selector: vscode.DocumentSelector = [
  { language: 'amxxpawn', scheme: 'file' },
  { language: 'amxxpawn', scheme: 'untitled' },
];
export function configuration(uri: vscode.Uri): vscode.WorkspaceConfiguration {
  return vscode.workspace.getConfiguration(section, uri);
}

export function pathContext(uri: vscode.Uri): PathContext {
  const folder = vscode.workspace.getWorkspaceFolder(uri)?.uri.fsPath;
  const file =
    uri.scheme === 'file' ? uri.fsPath : path.join(folder ?? process.cwd(), 'untitled.sma');
  return { workspaceFolder: folder ?? path.dirname(file), file };
}

export function includeDirectories(uri: vscode.Uri): string[] {
  const config = configuration(uri);
  const context = pathContext(uri);
  const paths = config
    .get<string[]>('language.includePaths', [])
    .map((entry) => expandPath(entry, context));
  const compiler = config.get<string>('compiler.path', '');
  paths.push(path.join(path.dirname(context.file), 'include'));
  if (compiler) paths.push(path.join(path.dirname(expandPath(compiler, context)), 'include'));
  return [...new Set(paths)];
}

export function formatterOptions(uri: vscode.Uri, editor: vscode.FormattingOptions): FormatOptions {
  const config = configuration(uri);
  return {
    tabSize: editor.tabSize,
    insertSpaces: editor.insertSpaces,
    braceStyle: config.get<FormatOptions['braceStyle']>('format.braceStyle', 'allman'),
    maxBlankLines: config.get<number>('format.maxBlankLines', 2),
    insertFinalNewline:
      typeof editor.insertFinalNewline === 'boolean'
        ? editor.insertFinalNewline
        : config.get<boolean>('format.insertFinalNewline', true),
  };
}
