import * as vscode from 'vscode';
import assert from 'node:assert/strict';
import * as path from 'node:path';
import { readFile, stat } from 'node:fs/promises';

const options = { tabSize: 4, insertSpaces: true };

async function edits(
  document: vscode.TextDocument,
  range?: vscode.Range,
): Promise<vscode.TextEdit[]> {
  return (
    (await vscode.commands.executeCommand<vscode.TextEdit[]>(
      range ? 'vscode.executeFormatRangeProvider' : 'vscode.executeFormatDocumentProvider',
      document.uri,
      ...(range ? [range, options] : [options]),
    )) ?? []
  );
}

async function apply(document: vscode.TextDocument, changes: vscode.TextEdit[]): Promise<void> {
  const edit = new vscode.WorkspaceEdit();
  edit.set(document.uri, changes);
  assert.equal(await vscode.workspace.applyEdit(edit), true);
}

function preview(document: vscode.TextDocument, changes: vscode.TextEdit[]): string {
  let text = document.getText();
  for (const change of [...changes].sort(
    (a, b) => document.offsetAt(b.range.start) - document.offsetAt(a.range.start),
  )) {
    text =
      text.slice(0, document.offsetAt(change.range.start)) +
      change.newText +
      text.slice(document.offsetAt(change.range.end));
  }
  return text;
}

export async function run(): Promise<void> {
  const extension = vscode.extensions.getExtension('revo.revo-pawn');
  assert.ok(extension, 'The extension manifest must load.');
  await extension.activate();
  assert.equal(extension.isActive, true);
  const folder = vscode.workspace.workspaceFolders?.[0]!.uri.fsPath;
  assert.ok(folder);
  const source = await vscode.workspace.openTextDocument(path.join(folder, 'main.sma'));
  assert.equal(source.languageId, 'amxxpawn');
  await vscode.window.showTextDocument(source);
  const formatting = await edits(source);
  assert.ok(formatting.length > 0);
  assert.ok(preview(source, formatting).includes('    new value = sample_add(1, 2);'));

  if (process.env.REVO_TEST_MODE === 'restricted') {
    assert.equal(vscode.workspace.isTrusted, false, 'Test profile must be in Restricted Mode.');
    assert.equal(
      await vscode.commands.executeCommand('revo_pawn.compile'),
      false,
      'Compilation must be denied in Restricted Mode.',
    );
    console.log('REVO PASS: activation and formatting in Restricted Mode; compilation blocked.');
    return;
  }
  assert.equal(vscode.workspace.isTrusted, true);
  const completion = await vscode.commands.executeCommand<vscode.CompletionList>(
    'vscode.executeCompletionItemProvider',
    source.uri,
    new vscode.Position(2, 48),
  );
  assert.ok(
    completion?.items.some((item) => item.label === 'sample_add'),
    'Native completion must resolve from include paths.',
  );
  assert.ok(
    completion?.items.some((item) => item.label === 'cycle_function'),
    'Cyclic transitive includes must resolve without recursion loops.',
  );
  const callOffset = source.getText().indexOf('sample_add');
  const callPosition = source.positionAt(callOffset + 2);
  const definitions = await vscode.commands.executeCommand<vscode.Location[]>(
    'vscode.executeDefinitionProvider',
    source.uri,
    callPosition,
  );
  assert.ok(definitions?.[0]?.uri.fsPath.endsWith('sample.inc'));
  const hovers = await vscode.commands.executeCommand<vscode.Hover[]>(
    'vscode.executeHoverProvider',
    source.uri,
    callPosition,
  );
  assert.ok(hovers?.length);
  const signature = await vscode.commands.executeCommand<vscode.SignatureHelp>(
    'vscode.executeSignatureHelpProvider',
    source.uri,
    source.positionAt(callOffset + 'sample_add(1,'.length),
  );
  assert.equal(signature?.activeParameter, 1);
  assert.equal(signature?.signatures[0]?.parameters.length, 2);
  const symbols = await vscode.commands.executeCommand<vscode.DocumentSymbol[]>(
    'vscode.executeDocumentSymbolProvider',
    source.uri,
  );
  assert.ok(symbols?.some((item) => item.name === 'plugin_init'));
  const links = await vscode.commands.executeCommand<vscode.DocumentLink[]>(
    'vscode.executeLinkProvider',
    source.uri,
  );
  assert.ok(links?.some((item) => item.target?.fsPath.endsWith('sample.inc')));

  await apply(source, formatting);
  assert.deepEqual(await edits(source), [], 'The second formatting call must return zero edits.');
  const include = await vscode.workspace.openTextDocument(path.join(folder, 'include/sample.inc'));
  const includeEdit = new vscode.WorkspaceEdit();
  includeEdit.insert(
    include.uri,
    include.positionAt(include.getText().length),
    '\nnative unsaved_native();\n',
  );
  assert.equal(await vscode.workspace.applyEdit(includeEdit), true);
  const updated = await vscode.commands.executeCommand<vscode.CompletionList>(
    'vscode.executeCompletionItemProvider',
    source.uri,
    new vscode.Position(4, 4),
  );
  assert.ok(
    updated?.items.some((item) => item.label === 'unsaved_native'),
    'Unsaved include changes must invalidate cached data.',
  );

  const selection = await vscode.workspace.openTextDocument({
    language: 'amxxpawn',
    content: 'public f()\n{\nnew a=1;foo(a);\nnew b=2;\n}\n',
  });
  const changes = await edits(selection, new vscode.Range(2, 0, 3, 0));
  assert.ok(changes.length > 0);
  assert.ok(changes.every((change) => change.range.start.line >= 2 && change.range.end.line <= 3));
  await apply(selection, changes);
  assert.equal(selection.getText(), 'public f()\n{\n    new a = 1;\n    foo(a);\nnew b=2;\n}\n');

  const compile = await vscode.workspace.openTextDocument(path.join(folder, 'compile.sma'));
  await vscode.window.showTextDocument(compile);
  assert.equal(await vscode.commands.executeCommand('revo_pawn.compile'), true);
  const target = path.join(folder, 'compiled/compile.amxx');
  assert.ok((await stat(target)).size > 0);
  const goodBinary = await readFile(target);
  const broken = new vscode.WorkspaceEdit();
  broken.replace(
    compile.uri,
    new vscode.Range(compile.positionAt(0), compile.positionAt(compile.getText().length)),
    '#include <amxmodx>\npublic plugin_init(){missing_symbol();}\n',
  );
  assert.equal(await vscode.workspace.applyEdit(broken), true);
  assert.equal(await vscode.commands.executeCommand('revo_pawn.compile'), false);
  assert.deepEqual(
    await readFile(target),
    goodBinary,
    'A failed compile must preserve the last working binary.',
  );
  assert.ok(
    vscode.languages
      .getDiagnostics(compile.uri)
      .some(
        (item) => item.source === 'amxxpc' && item.severity === vscode.DiagnosticSeverity.Error,
      ),
  );
  const fix = new vscode.WorkspaceEdit();
  fix.insert(compile.uri, new vscode.Position(0, 0), '// edited\n');
  assert.equal(await vscode.workspace.applyEdit(fix), true);
  assert.equal(
    vscode.languages.getDiagnostics(compile.uri).length,
    0,
    'Stale compiler diagnostics must clear on edit.',
  );
  console.log(
    'REVO PASS: formatting, selection, idempotence, completions, cyclic/unsaved includes, definitions, hover, signatures, outline, links, compilation, diagnostics and preservation of prior build.',
  );
}
