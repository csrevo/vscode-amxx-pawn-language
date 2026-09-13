import { runTests, downloadAndUnzipVSCode } from '@vscode/test-electron';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { spawn } from 'node:child_process';

const root = resolve('.');
const developmentPath = process.argv[3] ? resolve(process.argv[3]) : root;
const executable =
  process.env.VSCODE_EXECUTABLE_PATH ??
  process.argv[2] ??
  (await downloadAndUnzipVSCode(process.env.VSCODE_VERSION ?? 'stable'));
const workspace = resolve('.vscode-test/fixture');
await mkdir(join(workspace, 'include'), { recursive: true });
await writeFile(
  join(workspace, 'include', 'sample.inc'),
  '/** Adds two values.\n * @param left First.\n * @param right Second.\n */\nnative sample_add(left, right);\n#include "cycle.inc"\n',
);
await writeFile(
  join(workspace, 'include', 'cycle.inc'),
  '#include "sample.inc"\nnative cycle_function();\n',
);
await writeFile(
  join(workspace, 'main.sma'),
  '#include <sample>\nnew global_value;\npublic plugin_init(){new value=sample_add(1,2);}\n',
);
await writeFile(
  join(workspace, 'compile.sma'),
  '#include <amxmodx>\npublic plugin_init(){register_plugin("Test","1.0","Revo");}\n',
);
await writeFile(
  join(workspace, 'errors.sma'),
  '#include <amxmodx>\npublic plugin_init(){missing_symbol();}\n',
);
for (const mode of ['trusted', 'restricted']) {
  const userData = resolve(`.vscode-test/profile-${mode}`);
  await mkdir(join(userData, 'User'), { recursive: true });
  await writeFile(
    join(userData, 'User', 'settings.json'),
    JSON.stringify(
      {
        'security.workspace.trust.startupPrompt': 'never',
        'extensions.autoUpdate': false,
        'extensions.autoCheckUpdates': false,
        'workbench.startupEditor': 'none',
        'window.restoreWindows': 'none',
        'files.hotExit': 'off',
        'revo_pawn.language.includePaths': [join(workspace, 'include')],
        'revo_pawn.compiler.path': resolve(
          process.env.AMXX_SDK ?? '.tools/amxx-sdk/addons/amxmodx/scripting',
          process.platform === 'win32' ? 'amxxpc.exe' : 'amxxpc',
        ),
        'revo_pawn.compiler.outputDirectory': join(workspace, 'compiled'),
        'revo_pawn.compiler.showOutput': false,
        '[amxxpawn]': { 'editor.defaultFormatter': 'revo.revo-pawn' },
      },
      null,
      2,
    ),
  );
  const launchArgs = [
    workspace,
    '--disable-extensions',
    '--disable-gpu',
    '--skip-welcome',
    '--skip-release-notes',
    '--user-data-dir',
    userData,
    '--extensions-dir',
    resolve('.vscode-test/isolated-extensions'),
  ];
  if (mode === 'trusted')
    await runTests({
      vscodeExecutablePath: executable,
      version: process.env.VSCODE_VERSION ?? 'stable',
      extensionDevelopmentPath: developmentPath,
      extensionTestsPath: resolve('.test-build/tests/integration/suite.js'),
      launchArgs,
      extensionTestsEnv: { REVO_TEST_MODE: mode },
    });
  else {
    // test-electron intentionally adds --disable-workspace-trust. Launch the same
    // official extension-test entry point directly to exercise Restricted Mode.
    await new Promise((resolve, reject) => {
      const child = spawn(
        executable,
        [
          ...launchArgs,
          '--no-sandbox',
          '--disable-updates',
          '--disable-telemetry',
          `--extensionDevelopmentPath=${developmentPath}`,
          `--extensionTestsPath=${resolvePathForTests()}`,
        ],
        {
          windowsHide: true,
          shell: false,
          env: { ...process.env, REVO_TEST_MODE: mode },
          stdio: 'inherit',
        },
      );
      const timer = setTimeout(() => {
        child.kill();
        reject(new Error('Restricted Mode tests timed out.'));
      }, 60000);
      child.once('error', (error) => {
        clearTimeout(timer);
        reject(error);
      });
      child.once('exit', (code) => {
        clearTimeout(timer);
        if (code === 0) resolve();
        else reject(new Error(`Restricted Mode tests exited ${code}.`));
      });
    });
  }
}

function resolvePathForTests() {
  return resolve('.test-build/tests/integration/suite.js');
}
