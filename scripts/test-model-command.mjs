#!/usr/bin/env node
// Requires Paper and all four launchers. Changes only Cursor's model, then
// restores its original selection. No blocks, inventories, or positions change.
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { createBot } from '../src/bot.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const state = name => JSON.parse(readFileSync(`${root}.runtime/${name}/model-state.json`, 'utf8'));
const until = async check => {
  const deadline = Date.now() + 120000;
  while (Date.now() < deadline) { if (check()) return; await delay(100); }
  throw new Error('Timed out waiting for the model command');
};
await until(() => ['claude', 'codex', 'grok', 'cursor'].every(name => state(name).status === 'running'));
const original = state('cursor');
const otherPids = ['claude', 'codex', 'grok'].map(name => state(name).pid);
const bot = createBot({ host: '127.0.0.1', port: 25565, username: 'Model_Check' }, () => {});
const messages = [];
bot.on('messagestr', text => { messages.push(text); if (text.includes('[Mineness]')) console.log(text); });
const send = async (command, expected) => {
  const start = messages.length;
  bot.chat(command);
  await until(() => messages.slice(start).some(text => text.includes(expected)));
};
const change = async (model, effort) => {
  const before = state('cursor').requestId;
  const start = messages.length;
  await send(`/model @cursor ${model}${effort ? ' ' + effort : ''}`, 'Switching @cursor');
  await until(() => state('cursor').requestId !== before && state('cursor').result !== null);
  const result = state('cursor');
  assert.equal(result.result, 'applied', result.message);
  await until(() => messages.slice(start).some(text => text.includes('@cursor: ' + result.message)));
  return result;
};
let changed = false;
try {
  await once(bot, 'spawn');
  await send('/model @cursor', '@cursor:');
  await send('/model @missing anything', 'Unknown teammate');
  await send('/model @cursor bad;command', 'without spaces or shell syntax');
  await send('/model @cursor grok-4.6 ultra', 'Effort must be');
  assert.equal(state('cursor').pid, original.pid);
  changed = true;
  const targetEffort = original.model === 'cursor-grok-4.6-medium' ? 'high' : 'medium';
  const updated = await change('grok-4.6', targetEffort);
  assert.equal(updated.model, `cursor-grok-4.6-${targetEffort}`);
  assert.notEqual(updated.pid, original.pid);
  assert.deepEqual(['claude', 'codex', 'grok'].map(name => state(name).pid), otherPids);
  const restored = await change(original.model || 'default', original.effort);
  assert.equal(restored.model, original.model);
  changed = false;
  await send('/model @Cursor_Bot', original.model);
  console.log('PASS: player slash command, validation, model switch, only one bot reconnects, original model restored');
} finally {
  if (changed) await change(original.model || 'default', original.effort);
  bot.quit();
}
