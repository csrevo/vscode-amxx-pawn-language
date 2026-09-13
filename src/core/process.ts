import { spawn } from 'node:child_process';
import { StringDecoder } from 'node:string_decoder';

export interface CompilerProcessOptions {
  executable: string;
  arguments: readonly string[];
  cwd: string;
  timeoutMs: number;
  signal?: AbortSignal;
  onOutput?: (chunk: string) => void;
  maxOutputBytes?: number;
}
export interface CompilerProcessResult {
  code: number;
  output: string;
}

export function runCompiler(options: CompilerProcessOptions): Promise<CompilerProcessResult> {
  if (options.signal?.aborted) return Promise.reject(new Error('Compilation cancelled.'));
  return new Promise((resolve, reject) => {
    const child = spawn(options.executable, [...options.arguments], {
      cwd: options.cwd,
      shell: false,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const stdoutDecoder = new StringDecoder('utf8');
    const stderrDecoder = new StringDecoder('utf8');
    const chunks: string[] = [];
    let bytes = 0;
    let failure: Error | undefined;
    let settled = false;
    const stop = (error: Error): void => {
      failure ??= error;
      child.kill('SIGKILL');
    };
    const abort = (): void => stop(new Error('Compilation cancelled.'));
    const timer = setTimeout(
      () => stop(new Error(`Compilation timed out after ${options.timeoutMs / 1000}s.`)),
      options.timeoutMs,
    );
    const cleanup = (): void => {
      clearTimeout(timer);
      options.signal?.removeEventListener('abort', abort);
    };
    const output = (chunk: Buffer, decoder: StringDecoder): void => {
      bytes += chunk.byteLength;
      if (bytes > (options.maxOutputBytes ?? 4 * 1024 * 1024)) {
        stop(new Error('Compiler output exceeded the 4 MiB limit.'));
        return;
      }
      const text = decoder.write(chunk);
      chunks.push(text);
      options.onOutput?.(text);
    };
    options.signal?.addEventListener('abort', abort, { once: true });
    if (options.signal?.aborted) abort();
    child.stdout.on('data', (chunk: Buffer) => output(chunk, stdoutDecoder));
    child.stderr.on('data', (chunk: Buffer) => output(chunk, stderrDecoder));
    child.once('error', (error) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    });
    child.once('close', (code) => {
      if (settled) return;
      settled = true;
      cleanup();
      chunks.push(stdoutDecoder.end(), stderrDecoder.end());
      if (failure) reject(failure);
      else resolve({ code: code ?? -1, output: chunks.join('') });
    });
  });
}
