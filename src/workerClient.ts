import { Worker } from 'node:worker_threads';
import type { WorkerRequest } from './worker';
import type { FormatRequestOptions, FormatResult } from './core/formatter';
import type { ParsedDocument } from './core/parser';

interface Pending {
  request: WorkerRequest;
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  cleanup: () => void;
  cancelled: boolean;
}

export class WorkerClient {
  private worker?: Worker;
  private sequence = 0;
  private active?: Pending;
  private timer?: ReturnType<typeof setTimeout>;
  private readonly queue: Pending[] = [];
  private disposed = false;

  constructor(
    private readonly filename: string,
    private readonly timeoutMs = 15_000,
  ) {}

  run(
    operation: 'parse',
    source: string,
    options?: undefined,
    signal?: AbortSignal,
  ): Promise<ParsedDocument>;
  run(
    operation: 'format',
    source: string,
    options?: FormatRequestOptions,
    signal?: AbortSignal,
  ): Promise<FormatResult>;
  run(
    operation: 'parse' | 'format',
    source: string,
    options?: FormatRequestOptions,
    signal?: AbortSignal,
  ): Promise<unknown> {
    if (this.disposed) return Promise.reject(new Error('The language worker has been disposed.'));
    if (signal?.aborted) return Promise.reject(aborted());
    if (this.queue.length >= 64)
      return Promise.reject(
        new Error('The language worker queue is full. Retry after pending requests finish.'),
      );
    return new Promise((resolve, reject) => {
      const pending: Pending = {
        request: { id: ++this.sequence, operation, source, options },
        resolve,
        reject,
        cleanup: () => signal?.removeEventListener('abort', cancel),
        cancelled: false,
      };
      const cancel = (): void => {
        pending.cancelled = true;
        pending.cleanup();
        reject(aborted());
        const index = this.queue.indexOf(pending);
        if (index >= 0) this.queue.splice(index, 1);
      };
      signal?.addEventListener('abort', cancel, { once: true });
      this.queue.push(pending);
      this.pump();
    });
  }

  private pump(): void {
    if (this.disposed || this.active || !this.queue.length) return;
    if (!this.worker) {
      const worker = new Worker(this.filename, {
        execArgv: [],
        resourceLimits: { maxOldGenerationSizeMb: 256 },
      });
      this.worker = worker;
      worker.on('message', (message: { id: number; result?: unknown; error?: string }) => {
        if (this.worker !== worker || this.active?.request.id !== message.id) return;
        const pending = this.active;
        this.active = undefined;
        clearTimeout(this.timer);
        pending.cleanup();
        if (!pending.cancelled) {
          if (message.error) pending.reject(new Error(message.error));
          else pending.resolve(message.result);
        }
        this.pump();
      });
      worker.on('error', (error) => {
        if (this.worker === worker)
          this.fail(error instanceof Error ? error : new Error(String(error)));
      });
      worker.on('exit', (code) => {
        if (this.worker === worker) this.fail(new Error(`Language worker exited (${code}).`));
      });
    }
    this.active = this.queue.shift()!;
    this.timer = setTimeout(
      () => this.fail(new Error('Language request timed out; the worker was restarted.')),
      this.timeoutMs,
    );
    this.worker.postMessage(this.active.request);
  }

  private fail(error: Error): void {
    clearTimeout(this.timer);
    this.active?.cleanup();
    this.active?.reject(error);
    this.active = undefined;
    const old = this.worker;
    this.worker = undefined;
    void old?.terminate();
    this.pump();
  }

  dispose(): void {
    this.disposed = true;
    clearTimeout(this.timer);
    this.active?.cleanup();
    this.active?.reject(aborted());
    this.active = undefined;
    for (const pending of this.queue) {
      pending.cleanup();
      pending.reject(aborted());
    }
    this.queue.length = 0;
    const old = this.worker;
    this.worker = undefined;
    void old?.terminate();
  }
}

function aborted(): Error {
  const error = new Error('Request cancelled.');
  error.name = 'AbortError';
  return error;
}
