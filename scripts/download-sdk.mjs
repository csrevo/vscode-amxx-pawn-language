import { mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
// Explicit developer action only: no downloads run inside the extension.
const version = '1.10.0-git5481';
const url = `https://www.amxmodx.org/amxxdrop/1.10/amxmodx-${version}-base-windows.zip`;
await mkdir('.tools', { recursive: true });
const response = await fetch(url);
if (!response.ok) throw new Error(`SDK download failed: ${response.status}`);
const bytes = Buffer.from(await response.arrayBuffer());
const sha256 = createHash('sha256').update(bytes).digest('hex');
if (sha256 !== '5ece16f1c0060de0591cdc7ea3643c71598b3754938c7d39e3b7923dafbc57af')
  throw new Error(
    'The pinned SDK archive checksum changed. Review the download before updating the pin.',
  );
const output = resolve(`.tools/amxmodx-${version}-base-windows.zip`);
await writeFile(output, bytes);
await writeFile(
  '.tools/sdk-download.json',
  JSON.stringify({ url, sha256, downloadedAt: new Date().toISOString() }, null, 2),
);
console.log(output);
