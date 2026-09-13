import { parentPort } from 'node:worker_threads';
import { formatPawn, formatPawnSelection, type FormatRequestOptions } from './core/formatter';
import { parsePawn } from './core/parser';

export interface WorkerRequest {
  id: number;
  operation: 'parse' | 'format';
  source: string;
  options?: FormatRequestOptions;
}

parentPort?.on('message', (request: WorkerRequest) => {
  try {
    if (
      typeof request.source !== 'string' ||
      Buffer.byteLength(request.source, 'utf8') > 16 * 1024 * 1024
    )
      throw new Error('The document exceeds the worker size limit.');
    const selection = request.options?.selection;
    const result =
      request.operation === 'parse'
        ? parsePawn(request.source)
        : selection
          ? formatPawnSelection(
              request.source,
              selection.startLine,
              selection.endLine,
              request.options,
            )
          : formatPawn(request.source, request.options);
    parentPort?.postMessage({ id: request.id, result });
  } catch (error) {
    parentPort?.postMessage({
      id: request.id,
      error: error instanceof Error ? error.message : String(error),
    });
  }
});
