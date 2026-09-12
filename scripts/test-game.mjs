#!/usr/bin/env node
// Integration check against a running local server. Creates and removes a small
// arena above the forest, only after verifying every occupied position is air.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { createBot } from '../src/bot.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const rcon = command => execFileSync('python3', [root + 'scripts/rcon.py', command], { encoding: 'utf8' }).trim();
const helper = createBot({ host: '127.0.0.1', port: 25565, username: 'Test_Player' }, () => {});
const client = new Client({ name: 'mineness-integration', version: '1' });
const transport = new StdioClientTransport({ command: process.execPath, args: [root + 'src/server.js', '--username', 'Mineness_Test'], stderr: 'pipe' });
transport.stderr.on('data', b => process.stderr.write(b));
let arena = false;
let origin, helperStart, bodyStart;
const p = (x,y,z) => origin.offset(x,y,z);
const coords = v => `${v.x} ${v.y} ${v.z}`;
const call = async (name, args = {}) => {
  const response = await client.callTool({ name, arguments: args }, undefined, { timeout: 60000 });
  const result = JSON.parse(response.content[0].text);
  console.log(name, JSON.stringify(result));
  return result;
};
const until = async check => { for (let i = 0; i < 100; i++) { if (check()) return; await delay(100); } throw new Error('Expected server state did not arrive'); };
try {
  await once(helper, 'spawn');
  await helper.waitForChunksToLoad();
  await client.connect(transport);
  for (let i = 0; i < 20; i++) { if ((await call('look_around', { radius: 1 })).success) break; await delay(500); }
  helperStart = helper.entity.position.clone();
  bodyStart = helper.players.Mineness_Test.entity.position.clone();
  origin = helperStart.floored().offset(4, 0, 4);
  origin.y = Math.min(300, Math.max(200, origin.y + 30));
  for (let x = 0; x < 12; x++) for (let y = 0; y < 8; y++) for (let z = 0; z < 12; z++) {
    assert.equal(helper.blockAt(p(x,y,z))?.name, 'air', `Arena must be empty: ${p(x,y,z)}`);
  }
  arena = true;
  rcon(`fill ${coords(p(0,0,0))} ${coords(p(11,0,11))} stone`);
  rcon(`tp Test_Player ${coords(p(2.5,1,2.5))}`);
  rcon(`tp Mineness_Test ${coords(p(4.5,1,2.5))}`);
  await delay(1000);
  for (let n = 0; n < 5; n++) {
    rcon(`fill ${coords(p(5,1,2))} ${coords(p(5,2,2))} oak_log`);
    await until(() => helper.blockAt(p(5,1,2))?.name === 'oak_log');
    const result = await call('chop_tree', { count: 2 });
    assert.equal(result.success, true);
    assert.equal(result.gained.oak_log, 2, 'Both stacked logs must enter inventory');
  }
  assert.equal((await call('craft_item', { item: 'oak_planks', count: 4 })).crafted, 4);
  assert.equal((await call('place_blocks', { block: 'oak_planks', positions: [p(7,1,2)] })).success, true);
  await until(() => helper.blockAt(p(7,1,2))?.name === 'oak_planks');
  assert.equal((await call('gather_blocks', { block: 'oak_planks', count: 1 })).success, true);
  assert.equal((await call('goto', { ...p(8,1,7), tolerance: 1 })).success, true);
  for (const destination of [p(2.5,1,2.5), p(8.5,1,2.5), p(5.5,1,8.5)]) {
    rcon(`tp Test_Player ${coords(destination)}`);
    await delay(300);
    const before = helper.inventory.items().filter(i => i.name === 'oak_log').reduce((n, i) => n + i.count, 0);
    assert.equal((await call('give_items_to_player', { player: 'Test_Player', item: 'oak_log', count: 2 })).dropped, 2);
    await until(() => helper.inventory.items().filter(i => i.name === 'oak_log').reduce((n, i) => n + i.count, 0) >= before + 2);
  }
  assert.equal((await call('follow_player', { player: 'Test_Player', distance: 2 })).success, true);
  rcon(`tp Test_Player ${coords(p(9.5,1,9.5))}`);
  await until(() => helper.entity.position.distanceTo(p(9.5,1,9.5)) < 1);
  await until(() => helper.players.Mineness_Test?.entity?.position.distanceTo(helper.entity.position) < 4);
  helper.chat('stop');
  await delay(300);
  assert.equal((await call('look_around', { radius: 1 })).activity.following, null);
  assert.equal((await call('wait_for_mention', { timeout_seconds: 1 })).stopped, true);
  helper.chat('@Mineness_Test continue the test');
  assert.equal((await call('wait_for_mention', { timeout_seconds: 3 })).timed_out, false);
  rcon(`setblock ${coords(p(8,1,10))} oak_log`);
  await delay(300);
  const work = call('chop_tree', { count: 1 });
  await delay(600);
  const stopAt = Date.now();
  helper.chat('stop');
  const stopped = await work;
  assert.equal(stopped.stopped, true);
  assert.ok(Date.now() - stopAt < 2000, 'Raw chat stop must bypass model latency');
  console.log('PASS: five stacked-log collections, craft, place, gather, walk, three confirmed handoffs, follow, immediate stop');
} finally {
  // Move only test identities back to spawn before removing the arena.
  if (arena) {
    rcon(`tp Test_Player ${coords(helperStart)}`);
    rcon(`tp Mineness_Test ${coords(bodyStart)}`);
    rcon(`fill ${coords(p(0,0,0))} ${coords(p(11,7,11))} air`);
  }
  helper.quit();
  await client.close();
}
