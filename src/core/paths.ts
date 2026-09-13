import * as path from 'node:path';
import * as os from 'node:os';

export interface PathContext {
  workspaceFolder: string;
  file: string;
  env?: NodeJS.ProcessEnv;
}

export function expandPath(value: string, context: PathContext): string {
  const env = context.env ?? process.env;
  const expanded = value.replace(/\$\{([^}]+)\}/g, (_match, variable: string) => {
    if (variable === 'workspaceFolder') return context.workspaceFolder;
    if (variable === 'file') return context.file;
    if (variable === 'fileDirname') return path.dirname(context.file);
    if (variable === 'fileBasenameNoExtension')
      return path.basename(context.file, path.extname(context.file));
    if (variable.startsWith('env:') && env[variable.slice(4)] !== undefined)
      return env[variable.slice(4)]!;
    throw new Error(`Unresolved path variable: \${${variable}}`);
  });
  const homeExpanded =
    expanded === '~' ? os.homedir() : expanded.replace(/^~[/\\]/, `${os.homedir()}${path.sep}`);
  return path.resolve(context.workspaceFolder, homeExpanded);
}

export function validateCompilerArguments(args: readonly string[]): string[] {
  for (const arg of args) {
    if (typeof arg !== 'string' || !arg || /[\r\n\0]/.test(arg))
      throw new Error('Compiler arguments must be nonempty strings without control characters.');
    if (!arg.startsWith('-') && !/^[A-Za-z_][\w]*=.+$/.test(arg))
      throw new Error(`Unexpected compiler input: ${arg}. Use one compiler option per item.`);
    if (/^-[oiD]/.test(arg))
      throw new Error(
        'Configure outputDirectory and includePaths instead of -o, -i or -D arguments.',
      );
  }
  return [...args];
}
