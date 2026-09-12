#!/usr/bin/env node
// Apply skins in a short setup connection, then reconnect for actual play.
// SkinsRestorer's live refresh respawns the player and disrupts Mineflayer state.
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { createBot } from '../src/bot.js';
import { lockBody } from '../src/session.js';
const root = fileURLToPath(new URL('../', import.meta.url));
const names = process.argv.slice(2);
const selected = names.length ? names : ['claude', 'codex', 'grok', 'cursor'];
if (selected.some(n => !['claude','codex','grok','cursor'].includes(n))) throw new Error('Usage: npm run skins -- [claude codex grok cursor]');
for (const name of selected) {
  const username = name[0].toUpperCase() + name.slice(1) + '_Bot';
  const unlock = lockBody(root + '.runtime/' + username + '.pid');
  process.on('exit', unlock);
  const bot = createBot({host:process.env.MC_HOST || '127.0.0.1',port:Number(process.env.MC_PORT || 25565),username}, (level, message) => console.error(level, message));
  let changed = false;
  let requested = false;
  let problem;
  const timer = setTimeout(() => { problem = new Error('Skin setup timed out. Check that SkinsRestorer is installed and its skin service is reachable.'); bot.quit(); }, 120000);
  bot._client.on('player_info', packet => {
    if (requested && packet.action.add_player && packet.data.some(p => p.player?.name === username && p.player.properties?.some(p => p.name === 'textures'))) changed = true;
  });
  try {
    await Promise.race([once(bot, 'spawn'), once(bot, 'end').then(() => { throw problem || new Error(`${username} disconnected during skin setup.`); })]);
    const before = bot.player?.skinData?.url;
    requested = true;
    bot.chat(`/skin url https://raw.githubusercontent.com/SpectrumTantrum/mineness-skins/main/${name}.png`);
    while (!changed && !problem) await delay(250);
    if (problem) throw problem;
    await delay(2000);
    console.log(`${username}: ${bot.player?.skinData?.url || before}`);
  } finally { clearTimeout(timer); bot.quit(); unlock(); }
}
