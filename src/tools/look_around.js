import { z } from "zod";
import { toolResult, fmtPos } from "../bot.js";

export const DEFAULT_RADIUS = 32;
export const MAX_RADIUS = 64;

export const LOOK_AROUND_DESCRIPTION = `Look around you in the Minecraft world and return ONE short prose summary plus compact structured state.

Use this to see who is nearby, what biome you are in, the time of day, your health/food, a brief inventory, nearby players, hostile mobs, and notable blocks (ores, logs, chests, crafting stations). It is NOT a dump of every block. Do not ask the human what they see — look for yourself.`;

const NOTABLE_EXACT = new Set([
  "chest",
  "trapped_chest",
  "barrel",
  "ender_chest",
  "crafting_table",
  "furnace",
  "blast_furnace",
  "smoker",
  "enchanting_table",
  "anvil",
  "water",
  "lava",
  "obsidian",
  "spawner",
  "iron_block",
  "gold_block",
  "diamond_block",
  "coal_block",
  "wheat",
  "carrots",
  "potatoes",
  "beetroots",
  "pumpkin",
  "melon",
]);

const HOSTILE_NAMES = new Set([
  "zombie",
  "skeleton",
  "creeper",
  "spider",
  "cave_spider",
  "enderman",
  "witch",
  "drowned",
  "husk",
  "stray",
  "phantom",
  "slime",
  "magma_cube",
  "blaze",
  "ghast",
  "piglin",
  "piglin_brute",
  "hoglin",
  "zoglin",
  "warden",
  "ravager",
  "vindicator",
  "evoker",
  "pillager",
  "guardian",
  "elder_guardian",
  "shulker",
  "silverfish",
  "endermite",
  "wither_skeleton",
  "wither",
  "breeze",
  "bogged",
  "creaking",
]);

function clampRadius(radius) {
  const n = Number(radius);
  if (!Number.isFinite(n)) return DEFAULT_RADIUS;
  return Math.min(Math.max(Math.trunc(n), 1), MAX_RADIUS);
}

function floorPos(p) {
  return { x: Math.floor(p.x), y: Math.floor(p.y), z: Math.floor(p.z) };
}

function distTo(bot, p) {
  return Math.round(bot.entity.position.distanceTo(p) * 10) / 10;
}

function timeLabel(timeOfDay) {
  const t = Number(timeOfDay) || 0;
  if (t < 1000 || t >= 23000) return "sunrise";
  if (t < 6000) return "morning";
  if (t < 9000) return "noon";
  if (t < 12000) return "afternoon";
  if (t < 13000) return "sunset";
  if (t < 18000) return "evening";
  return "midnight";
}

function isNotableBlock(name) {
  if (!name) return false;
  if (NOTABLE_EXACT.has(name)) return true;
  if (name.endsWith("_log") || name.endsWith("_ore")) return true;
  if (name.endsWith("_bed")) return true;
  return false;
}

function isHostile(entity, registry) {
  const name = entity.name || "";
  if (HOSTILE_NAMES.has(name)) return true;
  const meta = registry?.entitiesByName?.[name];
  return meta?.type === "hostile";
}

function inventoryBrief(bot) {
  const counts = {};
  for (const item of bot.inventory.items()) {
    counts[item.name] = (counts[item.name] || 0) + item.count;
  }
  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 16)
    .map(([name, count]) => ({ name, count }));
}

function nearbyPlayers(bot, radius) {
  const out = [];
  for (const [name, p] of Object.entries(bot.players ?? {})) {
    if (name === bot.username) continue;
    if (!p.entity?.position) continue;
    const distance = distTo(bot, p.entity.position);
    if (distance > radius) continue;
    out.push({ name, distance, position: floorPos(p.entity.position) });
  }
  out.sort((a, b) => a.distance - b.distance);
  return out;
}

function nearbyHostiles(bot, radius) {
  const out = [];
  for (const entity of Object.values(bot.entities ?? {})) {
    if (!entity || entity === bot.entity) continue;
    if (entity.type === "player") continue;
    if (!entity.position) continue;
    if (!isHostile(entity, bot.registry)) continue;
    const distance = distTo(bot, entity.position);
    if (distance > radius) continue;
    out.push({
      name: entity.name || entity.displayName || "mob",
      distance,
      position: floorPos(entity.position),
    });
  }
  out.sort((a, b) => a.distance - b.distance);
  return out.slice(0, 12);
}

function notableBlocks(bot, radius) {
  let hits = [];
  try {
    hits = bot.findBlocks({
      point: bot.entity.position,
      maxDistance: radius,
      count: 48,
      matching: (block) => isNotableBlock(block?.name),
    });
  } catch {
    hits = [];
  }
  const byName = {};
  for (const pos of hits) {
    const block = bot.blockAt(pos);
    const name = block?.name;
    if (!name) continue;
    const distance = distTo(bot, pos);
    const cur = byName[name];
    if (!cur) {
      byName[name] = { name, count: 1, nearest: { ...floorPos(pos), distance } };
    } else {
      cur.count += 1;
      if (distance < cur.nearest.distance) {
        cur.nearest = { ...floorPos(pos), distance };
      }
    }
  }
  return Object.values(byName).sort((a, b) => a.nearest.distance - b.nearest.distance);
}

function biomeName(bot) {
  try {
    const block = bot.blockAt(bot.entity.position, true);
    if (block?.biome?.name) return block.biome.name;
    if (bot.registry.biomes[block?.biome]?.name) return bot.registry.biomes[block.biome].name;
    const below = bot.blockAt(bot.entity.position.offset(0, -1, 0), true);
    if (below?.biome?.name) return below.biome.name;
  } catch {
    /* ignore */
  }
  return "unknown";
}

function prose(state) {
  const inv =
    state.inventory.length === 0
      ? "empty pockets"
      : state.inventory
          .slice(0, 6)
          .map((i) => `${i.count} ${i.name}`)
          .join(", ");
  const who =
    state.players.length === 0
      ? "No other players in range"
      : `Players: ${state.players.map((p) => `${p.name} ${p.distance}m`).join(", ")}`;
  const mobs =
    state.hostile_mobs.length === 0
      ? "no hostiles"
      : `hostiles: ${state.hostile_mobs.map((m) => `${m.name} ${m.distance}m`).join(", ")}`;
  const blocks =
    state.notable_blocks.length === 0
      ? "nothing notable underfoot"
      : `notable: ${state.notable_blocks
          .slice(0, 6)
          .map((b) => `${b.name} x${b.count}`)
          .join(", ")}`;
  return `At ${state.position.x}, ${state.position.y}, ${state.position.z} in ${state.biome} (${state.time.label}). Health ${state.health}/20, food ${state.food}/20. ${who}; ${mobs}. ${blocks}. Inventory: ${inv}.`;
}

export function registerLookAround(mcp, bot, actions) {
  mcp.tool(
    "look_around",
    LOOK_AROUND_DESCRIPTION,
    {
      radius: z
        .number()
        .int()
        .min(1)
        .max(MAX_RADIUS)
        .default(DEFAULT_RADIUS)
        .describe("How far to look, in blocks. Default 32, max 64."),
    },
    async ({ radius }) => {
      const r = clampRadius(radius ?? DEFAULT_RADIUS);
      if (!bot.entity || !bot.minenessReady) {
        return toolResult({
          success: false,
          summary: "Cannot look around: bot has not spawned yet. Retry in a second.",
        });
      }
      const position = floorPos(bot.entity.position);
      const timeOfDay = bot.time?.timeOfDay ?? 0;
      const state = {
        success: true,
        activity: actions.state(),
        radius: r,
        position,
        biome: biomeName(bot),
        time: { time_of_day: timeOfDay, label: timeLabel(timeOfDay) },
        health: bot.health ?? 0,
        food: bot.food ?? 0,
        players: nearbyPlayers(bot, r),
        hostile_mobs: nearbyHostiles(bot, r),
        notable_blocks: notableBlocks(bot, r),
        inventory: inventoryBrief(bot),
      };
      state.summary = prose(state);
      return toolResult(state);
    },
  );
}
