import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { randomUUID } from 'node:crypto';
import { modelSelection, modelArgs, superviseModel } from '../src/model-control.js';
import { atomicJson } from '../src/session.js';

assert.deepEqual(modelSelection('cursor', 'grok-4.6', 'high'), { model: 'cursor-grok-4.6-high', effort: null });
assert.equal(modelSelection('cursor', 'cursor-grok-4.6-high-fast', 'medium').model, 'cursor-grok-4.6-medium-fast');
assert.equal(modelSelection('cursor', 'default').model, 'cursor-grok-4.6-high');
assert.deepEqual(modelArgs('codex', modelSelection('codex', 'gpt-5.6-sol', 'high')), ['--model', 'gpt-5.6-sol', '-c', 'model_reasoning_effort="high"']);
assert.deepEqual(modelArgs('claude', modelSelection('claude', 'sonnet', 'high')), ['--model', 'sonnet', '--effort', 'high']);
assert.deepEqual(modelArgs('grok', modelSelection('grok', 'grok-4.6', 'high')), ['--model', 'grok-4.6', '--reasoning-effort', 'high']);
assert.throws(() => modelSelection('cursor', '--force'), /model ID/);
assert.throws(() => modelSelection('cursor', 'model;command'), /model ID/);
assert.throws(() => modelSelection('codex', 'gpt-5.6-sol', 'ultra'), /Effort/);

const directory = mkdtempSync(join(tmpdir(), 'mineness-model-'));
const command = join(directory, 'fake-cli');
writeFileSync(command, `#!/usr/bin/env node
const fs = require('node:fs');
const model = process.argv[process.argv.indexOf('--model') + 1];
if (model === 'reject') process.exit(2);
const launch = JSON.parse(fs.readFileSync('model-launch.json', 'utf8'));
fs.writeFileSync('model-ready.json', JSON.stringify(launch));
setInterval(() => {}, 1000);
`, { mode: 0o700 });
const status = () => JSON.parse(readFileSync(join(directory, 'model-state.json'), 'utf8'));
const until = async check => {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) { if (check()) return; await delay(20); }
  throw new Error('Model supervisor did not reach the expected state: ' + JSON.stringify(status()));
};
const request = (model, effort) => {
  const id = randomUUID();
  atomicJson(join(directory, 'model-request.json'), { id, model, effort });
  return id;
};
const start = () => superviseModel({ provider: 'cursor', command, args: [], cwd: directory, logFile: join(directory, 'cli.log'), readyTimeoutMs: 1000, pollMs: 20 });
let session = start();
try {
  await until(() => status().status === 'running');
  const firstPid = status().pid;
  const change = request('grok-4.6', 'medium');
  await until(() => status().requestId === change && status().result === 'applied');
  assert.equal(status().model, 'cursor-grok-4.6-medium');
  assert.notEqual(status().pid, firstPid);
  assert.throws(() => process.kill(firstPid, 0), { code: 'ESRCH' });

  const secondPid = status().pid;
  const invalid = request('bad;command');
  await until(() => status().requestId === invalid && status().result === 'failed');
  assert.equal(status().pid, secondPid, 'Invalid syntax must not disconnect the current model');

  const rejected = request('reject');
  await until(() => status().requestId === rejected && status().result === 'failed');
  assert.equal(status().status, 'running');
  assert.equal(status().model, 'cursor-grok-4.6-medium');
  assert.match(status().message, /Previous model restored/);
  assert.equal(JSON.parse(readFileSync(join(directory, 'model.json'))).model, 'cursor-grok-4.6-medium');

  await session.stop();
  session = start();
  await until(() => status().status === 'running');
  assert.equal(status().model, 'cursor-grok-4.6-medium', 'Saved selection must survive launcher restarts');
} finally {
  await session.stop();
  rmSync(directory, { recursive: true, force: true });
}
console.log('model-control.test.js PASS');
