#!/usr/bin/env node
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { createBot } from '../src/bot.js';
import { createActions, inventoryCounts } from '../src/actions.js';
import { registerPlay } from '../src/tools/play.js';
import { registerLookAround } from '../src/tools/look_around.js';
import { lockBody } from '../src/session.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const unlock = lockBody(root + '.runtime/Craft_Check.pid');
process.on('exit', unlock);
const rcon = command => execFileSync('python3', [root + 'scripts/rcon.py', command], { encoding: 'utf8' }).trim();
const bot = createBot({host:'127.0.0.1', port:25565, username:'Craft_Check'}, () => {});
const actions = createActions(bot);
const handlers = {};
registerPlay({tool:(name, _description, _schema, handler) => { handlers[name] = handler; }}, bot, actions);
registerLookAround({tool:(name, _description, _schema, handler) => { handlers[name] = handler; }}, bot, actions);
const call = async (name, args) => {
  const result = JSON.parse((await handlers[name](args)).content[0].text);
  console.log(name, JSON.stringify(result));
  return result;
};
let origin, start, arena = false;
const p = (x,y,z) => origin.offset(x,y,z);
const xyz = v => `${v.x} ${v.y} ${v.z}`;
try {
  await once(bot, 'spawn');
  await bot.waitForChunksToLoad();
  start = bot.entity.position.clone();
  origin = start.floored().offset(0,0,4);
  origin.y = 200;
  for(let x=0;x<14;x++) for(let y=0;y<9;y++) for(let z=0;z<14;z++) assert.equal(bot.blockAt(p(x,y,z))?.name,'air');
  arena = true;
  rcon(`fill ${xyz(p(0,0,0))} ${xyz(p(13,0,13))} grass_block`);
  rcon(`tp Craft_Check ${xyz(p(2.5,1,2.5))}`);
  for(let trial=0;trial<3;trial++) {
    rcon('clear Craft_Check');
    rcon('give Craft_Check oak_log 12');
    await bot.waitForTicks(5);
    assert.equal(inventoryCounts(bot).oak_log, 12);
    const result = await call('craft_item',{item:'oak_planks', count:48});
    await bot._syncWindow(bot.inventory);
    assert.equal(result.crafted, 48, 'craft_item must report 48 planks from 12 logs');
    assert.deepEqual(inventoryCounts(bot), {oak_planks:48}, 'Server-confirmed inventory must contain exactly 48 planks');
  }
  rcon(`setblock ${xyz(p(5,1,5))} leaf_litter`);
  await bot.waitForTicks(3);
  const view = await call('look_around', {radius:16,inspect:[p(5,0,5),p(5,1,5),p(5,2,5)]});
  assert.deepEqual(view.inspected_blocks.map(b=>b.name), ['grass_block','leaf_litter','air']);
  const house = [];
  for (let y=1;y<=4;y++) for(let x=5;x<=7;x++) for(let z=5;z<=7;z++) {
    if (y===1 || y===4 || ((x===5||x===7||z===5||z===7) && !(x===6&&z===5))) house.push(p(x,y,z));
  }
  assert.equal(house.length,32);
  assert.equal((await call('place_blocks',{block:'oak_planks',positions:house.filter(p=>p.y<origin.y+4)})).success,true);
  // Survival building needs steps to reach the top of a two-block wall.
  assert.equal((await call('place_blocks',{block:'oak_planks',positions:[p(3,1,6),p(4,1,6),p(4,2,6)]})).success,true);
  assert.equal((await call('place_blocks',{block:'oak_planks',positions:house})).success,true);
  for(const position of house) assert.equal(bot.blockAt(position)?.name,'oak_planks');
  assert.equal(bot.blockAt(p(6,2,5))?.name,'air','Doorway must remain open');
  assert.equal((await call('craft_item',{item:'crafting_table',count:1})).crafted,1);
  assert.equal((await call('place_blocks',{block:'crafting_table',positions:[p(11,1,11)]})).success,true);
  assert.equal((await call('craft_item',{item:'stick',count:4})).crafted,4);
  assert.equal((await call('craft_item',{item:'wooden_axe',count:1})).crafted,1);
  rcon(`setblock ${xyz(p(2,6,2))} oak_log`);
  rcon(`fill ${xyz(p(10,1,2))} ${xyz(p(10,4,2))} oak_log`);
  rcon(`fill ${xyz(p(9,3,1))} ${xyz(p(11,5,3))} oak_leaves[persistent=true] replace air`);
  rcon(`tp Craft_Check ${xyz(p(2.5,1,2.5))}`);
  await bot.waitForTicks(3);
  const chopped = await call('chop_tree',{count:4,species:'oak'});
  assert.equal(chopped.success,true);
  assert.equal(chopped.gained.oak_log,4,'Choose the reachable tree instead of an isolated canopy log');
  console.log('PASS: bulk and table crafting, exact terrain inspection, house floor/walls/roof over leaf litter, and a tree under leaves');
} finally {
  actions.stop();
  if(arena) {
    rcon(`tp Craft_Check ${xyz(start)}`);
    rcon(`fill ${xyz(p(0,0,0))} ${xyz(p(13,8,13))} air`);
  }
  rcon('clear Craft_Check');
  bot.quit();
}
