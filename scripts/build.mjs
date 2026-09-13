import { build, context } from 'esbuild';
import { mkdir } from 'node:fs/promises';

await mkdir('artifacts', { recursive: true });
const production = process.argv.includes('--production');
const options = {
  entryPoints: ['src/extension.ts', 'src/worker.ts', 'src/cli.ts'],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node20',
  external: ['vscode'],
  outdir: 'dist',
  sourcemap: !production,
  minify: production,
  legalComments: 'eof',
  logLevel: 'info',
};
if (process.argv.includes('--watch')) {
  const ctx = await context(options);
  await ctx.watch();
  console.log('Watching Revo Pawn sources.');
} else {
  await build(options);
}
