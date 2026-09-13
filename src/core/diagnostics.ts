export interface CompilerDiagnostic {
  file: string;
  startLine: number;
  endLine: number;
  severity: 'error' | 'warning';
  code: string;
  message: string;
}

export function parseCompilerDiagnostics(output: string): CompilerDiagnostic[] {
  const result: CompilerDiagnostic[] = [];
  const pattern =
    /^(.+?)\((\d+)(?:\s*--\s*(\d+))?\)\s*:\s*(fatal error|error|warning)\s+(\d+)\s*:\s*(.*)$/;
  for (const line of output.replace(/\u001b\[[\d;]*m/g, '').split(/\r?\n/)) {
    const match = pattern.exec(line.trim());
    if (!match) continue;
    const startLine = Math.max(0, Number(match[2]) - 1);
    result.push({
      file: match[1]!,
      startLine,
      endLine: Math.max(startLine, Number(match[3] ?? match[2]) - 1),
      severity: match[4] === 'warning' ? 'warning' : 'error',
      code: match[5]!,
      message: match[6]!,
    });
  }
  return result;
}
