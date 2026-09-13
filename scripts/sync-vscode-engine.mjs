import { readFile, writeFile } from 'node:fs/promises';

// Dependabot updates @types/vscode independently of engines.vscode. Derive the
// minimum editor version from the installed API before testing or packaging.
const root = new URL('../', import.meta.url);
const { version } = JSON.parse(
  await readFile(new URL('node_modules/@types/vscode/package.json', root), 'utf8'),
);
// DefinitelyTyped increments patches independently of VS Code releases. Like
// vsce, match the API's major/minor without requiring an editor patch to exist.
const [major, minor] = version.split('.');
const requiredVersion = `^${major}.${minor}.0`;

for (const filename of ['package.json', 'package-lock.json']) {
  const file = new URL(filename, root);
  let source;
  try {
    source = await readFile(file, 'utf8');
  } catch (error) {
    if (filename === 'package-lock.json' && error.code === 'ENOENT') continue;
    throw error;
  }
  const metadata = JSON.parse(source);
  const manifest = filename === 'package.json' ? metadata : metadata.packages[''];
  if (manifest.engines.vscode === requiredVersion) continue;
  manifest.engines.vscode = requiredVersion;
  const newline = source.includes('\r\n') ? '\r\n' : '\n';
  await writeFile(file, `${JSON.stringify(metadata, null, 2)}\n`.replaceAll('\n', newline));
  console.log(`${filename}: engines.vscode = ${requiredVersion}`);
}
