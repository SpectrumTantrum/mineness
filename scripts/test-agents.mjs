#!/usr/bin/env node
// Requires the selected real CLI sessions to be running. The observer sends
// game chat; success requires those sessions to mine and deliver real items.
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { execFileSync } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { createBot } from '../src/bot.js';
import { Vec3 } from 'vec3';
const root = fileURLToPath(new URL('../', import.meta.url));
const selected = process.argv.slice(2);
if (!selected.length || selected.some(n => !['claude', 'codex', 'grok', 'cursor'].includes(n))) throw new Error('Usage: node scripts/test-agents.mjs claude codex grok cursor');
const rcon = command => execFileSync('python3', [root + 'scripts/rcon.py', command], { encoding: 'utf8' }).trim();
const bot = createBot({host:'127.0.0.1',port:25565,username:'Mineness_Demo'}, () => {});
bot.on('messagestr', (message, position) => { if (position !== 'game_info') console.log('CHAT', message); });
const countLogs = () => bot.inventory.items().filter(i => i.name === 'oak_log').reduce((n, i) => n + i.count, 0);
const positions = new Map();
let origin;
let arena = false;
const p = (x, y, z) => origin.offset(x, y, z);
const coords = v => `${v.x} ${v.y} ${v.z}`;
try {
  await once(bot,'spawn'); await bot.waitForChunksToLoad();
  positions.set(bot.username, bot.entity.position.clone());
  origin = bot.entity.position.floored().offset(4, 0, 4);
  origin.y = Math.min(300, Math.max(200, origin.y + 30));
  for(let x=0;x<14;x++)for(let y=0;y<7;y++)for(let z=0;z<14;z++) assert.equal(bot.blockAt(p(x,y,z))?.name,'air',`Test space must be empty at ${p(x,y,z)}`);
  for(const name of selected){const username=name[0].toUpperCase()+name.slice(1)+'_Bot';assert.ok(bot.players[username]?.entity,`${username} must be running and nearby`);positions.set(username,bot.players[username].entity.position.clone());}
  arena=true;
  console.log(rcon(`fill ${coords(p(0,0,0))} ${coords(p(13,0,13))} stone`));
  rcon(`tp ${bot.username} ${coords(p(2.5,1,2.5))}`);
  for(const name of selected){
    const username=name[0].toUpperCase()+name.slice(1)+'_Bot';
    rcon(`tp ${username} ${coords(p(4.5,1,2.5))}`);
    rcon(`fill ${coords(p(6,1,2))} ${coords(p(6,2,2))} oak_log`);
    await delay(800);
    const before=countLogs();
    console.log('REQUEST',username);
    bot.chat(`@${name} Chop 2 oak logs from the nearby tree, bring both logs to me, then wait.`);
    const deadline=Date.now()+180000;
    while(countLogs()<before+2 && Date.now()<deadline) await delay(250);
    assert.ok(countLogs()>=before+2,`${username} did not deliver 2 logs within 3 minutes`);
    for (const y of [1,2]) assert.equal(bot.blockAt(p(6,y,2))?.name, 'air', `${username} must mine both requested logs`);
    console.log('PASS',username,'delivered two mined logs to the observer');
    // Let the model report its result and return to waiting before restoring it.
    await delay(5000);
    rcon(`tp ${username} ${coords(positions.get(username))}`);
    positions.delete(username);
  }
  console.log('PASS: real subscription CLI teammates completed game-chat requests');
} finally {
  for(const [username,position] of positions) rcon(`tp ${username} ${coords(position)}`);
  if(arena) rcon(`fill ${coords(p(0,0,0))} ${coords(p(13,6,13))} air`);
  bot.quit();
}
