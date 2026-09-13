import { readFile, writeFile } from 'node:fs/promises';
import { formatPawn } from './core/formatter';

/** Standalone formatter for CI. Never guesses an encoding when writing a file. */
async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const check = args.includes('--check');
  const write = args.includes('--write');
  const files = args.filter((arg) => !arg.startsWith('--'));
  if (
    (!check && !write) ||
    (check && write) ||
    !files.length ||
    args.some((arg) => arg.startsWith('--') && !['--check', '--write'].includes(arg))
  )
    throw new Error('Usage: node dist/cli.js (--check | --write) file.sma [file.inc ...]');
  for (const file of files) {
    if (!/\.(sma|inc)$/i.test(file)) throw new Error(`Expected a .sma or .inc file: ${file}`);
    const bytes = await readFile(file);
    const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
    const result = formatPawn(text);
    if (result.skippedReason) {
      console.error(`${file}: skipped: ${result.skippedReason}`);
      process.exitCode = 2;
      continue;
    }
    if (check && result.changed) {
      console.error(`${file}: formatting required`);
      process.exitCode = 1;
    }
    if (write && result.changed) {
      await writeFile(file, result.text, 'utf8');
      console.log(`Formatted ${file}`);
    }
  }
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 2;
});
