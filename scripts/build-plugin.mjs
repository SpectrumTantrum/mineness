import { spawnSync } from 'node:child_process';
import { mkdirSync, readdirSync, copyFileSync } from 'node:fs';
import { delimiter, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const source = join(root, 'mc-server/model-command');
const libraries = join(root, 'mc-server/libraries');
const jars = readdirSync(libraries, { recursive: true, withFileTypes: true })
  .filter(entry => entry.isFile() && entry.name.endsWith('.jar')).map(entry => join(entry.parentPath, entry.name)).sort();
if (!jars.some(path => path.includes('/paper-api/'))) throw new Error('Start Paper once to extract its libraries, then rerun npm run build:plugin.');
const classes = join(root, '.runtime/plugin-classes');
mkdirSync(classes, { recursive: true });
const run = (command, args) => {
  const result = spawnSync(command, args, { stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} failed (${result.status})`);
};
run('javac', ['--release', '21', '-cp', jars.join(delimiter), '-d', classes, join(source, 'ModelCommand.java')]);
const artifact = join(source, 'MinenessCommands.jar');
run('jar', ['--create', '--file', artifact, '--date=2026-01-01T00:00:00Z', '-C', classes, '.', '-C', source, 'plugin.yml']);
copyFileSync(artifact, join(root, 'mc-server/plugins/MinenessCommands.jar'));
console.log('Built and installed MinenessCommands.jar. Restart Paper to load it.');
