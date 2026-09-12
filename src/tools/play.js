import { z } from "zod";
import { Vec3 } from "vec3";
import pathfinderPkg from "mineflayer-pathfinder";
import { setTimeout as delay } from "node:timers/promises";
import { inventoryCounts, resolvePlayer, walkTo } from "../actions.js";
import { toolResult } from "../bot.js";

const { goals } = pathfinderPkg;
const itemName = z.string().trim().regex(/^[a-z][a-z0-9_]*$/, "Use a Minecraft item name such as oak_log.");
const count = z.number().int().min(1).max(64);
const coordinate = z.number().int().min(-29_999_984).max(29_999_984);
const faces = [new Vec3(0, -1, 0), new Vec3(1, 0, 0), new Vec3(-1, 0, 0), new Vec3(0, 0, 1), new Vec3(0, 0, -1), new Vec3(0, 1, 0)];
const replaceable = new Set(['air', 'cave_air', 'void_air', 'leaf_litter', 'short_grass', 'tall_grass', 'fern', 'large_fern']);

async function collect(bot, blocks, signal) {
  if (!blocks.length) throw new Error("No matching blocks nearby. Move to a different area and try again.");
  const before = inventoryCounts(bot);
  let mined = 0;
  const movement = bot.pathfinder.movements;
  const allowed = new Set(blocks.map((b) => b.position.toString()));
  const protectOtherBlocks = (b) => allowed.has(b.position.toString()) || b.name.endsWith("_leaves") ? 0 : 100;
  const couldDig = movement.canDig;
  movement.canDig = true;
  movement.exclusionAreasBreak.push(protectOtherBlocks);
  // Collect one block at a time so cancellation is checked between targets.
  try {
    for (const block of blocks) {
      signal.throwIfAborted();
      if (bot.blockAt(block.position)?.type !== block.type) continue;
      if (!bot.canDigBlock(block)) await walkTo(bot, block.position, 3, signal);
      signal.throwIfAborted();
      await bot.tool.equipForBlock(block, { requireHarvest: true, getFromChest: false });
      signal.throwIfAborted();
      if (!bot.pathfinder.movements.safeToBreak(block)) throw new Error(`Cannot safely mine ${block.name} at ${block.position}.`);
      await bot.dig(block);
      signal.throwIfAborted();
      if (bot.blockAt(block.position)?.type !== block.type) mined++;
    }
    // Clear the selected logs before walking underneath them for their drops.
    await delay(600, undefined, { signal });
    for (const drop of Object.values(bot.entities).filter(e => e.name === "item" && blocks.some(b => e.position.distanceTo(b.position) < 3))) {
      if (!drop.isValid) continue;
      signal.throwIfAborted();
      // Enter the item's block and follow it while it falls; stopping one
      // block away can leave the drop just outside the pickup hitbox.
      try { await bot.pathfinder.goto(new goals.GoalFollow(drop, 0)); }
      finally { bot.pathfinder.setGoal(null); }
      await delay(400, undefined, { signal });
    }
  } finally {
    movement.canDig = couldDig;
    movement.exclusionAreasBreak = movement.exclusionAreasBreak.filter((f) => f !== protectOtherBlocks);
  }
  const inventory = inventoryCounts(bot);
  const gained = Object.fromEntries(Object.entries(inventory).map(([name, n]) => [name, n - (before[name] ?? 0)]).filter(([, n]) => n > 0));
  return { success: mined > 0 && Object.keys(gained).length > 0, mined, gained, inventory,
    summary: `Mined ${mined} blocks; collected ${Object.entries(gained).map(([name, n]) => `${n} ${name}`).join(", ") || "no drops"}.` };
}

export function registerPlay(mcp, bot, actions) {
  mcp.tool("chop_tree", "Chop logs from the nearest tree and collect the drops. Handles walking, tool selection, digging, and pickup. Announce your plan with say first, then call this directly. count is the maximum logs, not trees. Reports actual inventory; stops after 45 seconds.", {
    count: count.default(4), species: itemName.optional().describe("Optional wood species, for example oak or birch."),
  }, async ({ count, species }) => toolResult(await actions.run("chop_tree", async (signal) => {
    const logs = bot.findBlocks({ maxDistance: 32, count: 128,
      matching: (b) => b.name.endsWith("_log") && (!species || b.name === `${species.replace(/_log$/, "")}_log`)
    }).map(p => bot.blockAt(p));
    // Prefer a trunk rooted in solid ground over a nearer leftover canopy log.
    const tree = logs.find(b => {
      const below = bot.blockAt(b.position.offset(0, -1, 0));
      return below?.boundingBox === 'block' && !below.name.endsWith('_log') && !below.name.endsWith('_leaves');
    }) ?? logs[0];
    if (!tree) throw new Error("No tree logs within 32 blocks. Walk toward a forest and try again.");
    return collect(bot, bot.collectBlock.findFromVein(tree, count, 12), signal);
  })));

  mcp.tool("gather_blocks", "Mine and collect up to count nearby blocks of one exact type, using the best tool in your inventory. For trees, prefer chop_tree. Missing tools or inaccessible blocks return a failure and any partial gains. 45-second limit.", {
    block: itemName, count: count.default(8),
  }, async ({ block, count }) => toolResult(await actions.run("gather_blocks", async (signal) => {
    const type = bot.registry.blocksByName[block];
    if (!type || type.hardness < 0 || ["air", "cave_air", "void_air", "water", "lava"].includes(block)) throw new Error(`Cannot gather ${block}. Use a mineable block name from look_around.`);
    const positions = bot.findBlocks({ matching: type.id, maxDistance: 32, count });
    return collect(bot, positions.map((p) => bot.blockAt(p)).filter(Boolean), signal);
  })));

  mcp.tool("follow_player", "Start following a visible player, then return immediately so you can listen for their next request. Following ends on stop, a new game action, or when the player leaves view.", {
    player: z.string().trim().min(1), distance: z.number().min(2).max(8).default(3),
  }, async ({ player, distance }) => {
    try { return toolResult(actions.follow(player, distance)); }
    catch (error) { return toolResult({ success: false, summary: error.message }); }
  });

  mcp.tool("give_items_to_player", "Walk to a visible player and drop up to count of an exact inventory item at their feet. Defaults to as many as you have, up to 64. Reports the amount actually dropped, not a promise that the recipient picked it up. 45-second limit.", {
    player: z.string().trim().min(1), item: itemName, count: count.default(64),
  }, async ({ player, item, count }) => toolResult(await actions.run("give_items_to_player", async (signal) => {
    const target = resolvePlayer(bot, player);
    const stack = bot.inventory.items().find((i) => i.name === item);
    if (!stack) throw new Error(`I have no ${item}. Check look_around for my inventory.`);
    await walkTo(bot, target.entity.position, 1, signal);
    const live = resolvePlayer(bot, target.username).entity;
    if (bot.entity.position.distanceTo(live.position) > 3.5) throw new Error("The player moved away. Ask them to stand still and retry.");
    await bot.lookAt(live.position.offset(0, 0.2, 0), true);
    // lookAt updates local rotation first; let the server receive it before tossing.
    await bot.waitForTicks(2);
    signal.throwIfAborted();
    const before = inventoryCounts(bot)[item] ?? 0;
    for (let n = 0; n < Math.min(count, before); n++) {
      signal.throwIfAborted();
      if (bot.heldItem?.name !== item) {
        const next = bot.inventory.items().find((i) => i.name === item);
        if (!next) break;
        await bot.equip(next, "hand");
        await bot.waitForTicks(2);
      }
      signal.throwIfAborted();
      // Q-drop aims at the player. Inventory-window tossing scatters randomly.
      const held = bot.heldItem;
      const remaining = Object.assign(Object.create(Object.getPrototypeOf(held)), held, { count: held.count - 1 });
      // Vanilla predicts Q-drops locally; the server only resyncs rejected drops.
      bot._setSlot(held.slot, remaining.count ? remaining : null);
      bot._client.write("block_dig", { status: 4, location: new Vec3(0, 0, 0), face: 0, sequence: 0 });
      if (n % 10 === 9) await bot.waitForTicks(1);
    }
    // Step out of pickup range before the dropped items become collectible.
    const away = bot.entity.position.minus(live.position);
    away.y = 0;
    if (away.norm() < 0.1) away.x = 1;
    await walkTo(bot, bot.entity.position.plus(away.normalize().scaled(3)), 1, signal);
    await delay(1300, undefined, { signal });
    const dropped = before - (inventoryCounts(bot)[item] ?? 0);
    return { success: dropped > 0, dropped, item, player: target.username, summary: `Dropped ${dropped} ${item} at ${target.username}'s feet.` };
  })));

  mcp.tool("craft_item", "Craft at least count items from your inventory. Uses a nearby crafting table only when needed. Count means output items, not recipe repetitions. On missing ingredients, returns recipe ingredients and whether a table is needed. Gather those materials, craft a table if needed, then use place_blocks to set it down. 45-second limit.", {
    item: itemName, count: count.default(1),
  }, async ({ item, count }) => toolResult(await actions.run("craft_item", async (signal) => {
    const type = bot.registry.itemsByName[item];
    if (!type) throw new Error(`Unknown item ${item}. Use its exact Minecraft item name.`);
    let table = null;
    let recipe = bot.recipesFor(type.id, null, count, null)[0];
    if (!recipe) {
      table = bot.findBlock({ matching: bot.registry.blocksByName.crafting_table.id, maxDistance: 32 });
      if (table) recipe = bot.recipesFor(type.id, null, count, table)[0];
    }
    if (!recipe) {
      const recipes = bot.recipesAll(type.id, null, true).slice(0, 3).map((r) => ({
        output: r.result.count, needs_table: r.requiresTable,
        ingredients: r.delta.filter((i) => i.count < 0).map((i) => ({ name: bot.registry.items[i.id]?.name, count: -i.count })),
      }));
      return { success: false, recipes, inventory: inventoryCounts(bot), summary: `Cannot craft ${count} ${item} yet. Gather the recipe ingredients${table ? "" : " and place a crafting table if the recipe needs one"}.` };
    }
    if (recipe.requiresTable) await walkTo(bot, table.position, 2, signal);
    else table = null;
    const before = inventoryCounts(bot)[item] ?? 0;
    // Mineflayer predicts crafting clicks before Paper confirms them. Flush
    // each ingredient click so a stale recipe result cannot consume the wrong item.
    const clickWindow = bot.clickWindow;
    bot.clickWindow = async (...args) => {
      signal.throwIfAborted();
      await clickWindow(...args);
      await bot.waitForTicks(2);
      signal.throwIfAborted();
      await bot._syncWindow(bot.currentWindow ?? bot.inventory);
    };
    try {
      for (let n = 0; n < Math.ceil(count / recipe.result.count); n++) {
        signal.throwIfAborted();
        await bot.craft(recipe, 1, table);
        await bot.waitForTicks(2);
        signal.throwIfAborted();
        await bot._syncWindow(bot.inventory);
      }
    } finally { bot.clickWindow = clickWindow; }
    const crafted = (inventoryCounts(bot)[item] ?? 0) - before;
    return { success: crafted >= count, crafted, item, inventory: inventoryCounts(bot), summary: `Crafted ${crafted} ${item}.` };
  })));

  mcp.tool("place_blocks", "Build with blocks already in your inventory at up to 32 exact positions. Inspect those coordinates with look_around first. Order positions from the ground upward; every block needs an adjacent solid support and a reachable face. For a high wall or roof, build temporary steps outside it first. Replaces grass and leaf litter, but never solid blocks or leaves. Already-matching blocks are skipped, so retrying a partially completed batch is safe. Reports placements and the failed position; stops after 45 seconds.", {
    block: itemName,
    positions: z.array(z.object({ x: coordinate, y: z.number().int().min(-64).max(319), z: coordinate })).min(1).max(32),
  }, async ({ block, positions }) => toolResult(await actions.run("place_blocks", async (signal) => {
    const placed = [];
    const type = bot.registry.blocksByName[block];
    if (!type) throw new Error(`Unknown block ${block}.`);
    for (const p of positions) {
      try {
        signal.throwIfAborted();
        const target = new Vec3(p.x, p.y, p.z);
        if (bot.entity.position.distanceTo(target) > 32) throw new Error("Build within 32 blocks. Use goto to reach another area first.");
        const existing = bot.blockAt(target);
        if (!existing) throw new Error("That location is not loaded. Move closer first.");
        if (existing.type === type.id) continue;
        if (!replaceable.has(existing.name)) throw new Error(`${existing.name} already occupies ${target}. Placed ${placed.length} blocks so far. Inspect the site with look_around before retrying.`);
        if (!bot.inventory.items().some((i) => i.name === block)) throw new Error(`No ${block} left. Placed ${placed.length} blocks so far.`);
        if (!existing.name.endsWith('air')) {
          if (!bot.canDigBlock(existing)) await walkTo(bot, target, 3, signal);
          signal.throwIfAborted();
          await bot.dig(existing);
        }
        const offset = faces.find((v) => bot.blockAt(target.plus(v))?.boundingBox === "block");
        if (!offset) throw new Error(`No solid support next to ${target}. Build from the ground upward.`);
        const support = bot.blockAt(target.plus(offset));
        await bot.pathfinder.goto(new goals.GoalPlaceBlock(target, bot.world, { range: 4 }));
        await bot.waitForTicks(2);
        await bot._syncWindow(bot.inventory);
        signal.throwIfAborted();
        // Use the current stack until empty, and select any replacement only
        // after movement and server inventory updates have finished.
        if (bot.heldItem?.name !== block) {
          const item = bot.inventory.items().find((i) => i.name === block);
          if (!item) throw new Error(`No ${block} left.`);
          await bot.equip(item, "hand");
          await bot.waitForTicks(2);
          await bot._syncWindow(bot.inventory);
        }
        signal.throwIfAborted();
        await bot.placeBlock(support, offset.scaled(-1));
        if (bot.blockAt(target)?.type !== type.id) throw new Error(`Server did not confirm ${block} at ${target}.`);
        placed.push(p);
      } catch (error) {
        signal.throwIfAborted();
        return { success: false, placed, block, failed_position: p,
          summary: `${error.message} Completed ${placed.length} placements. Inspect the failed position; if its face is too high, build temporary steps first.` };
      }
    }
    return { placed, block, summary: `Placed ${placed.length} ${block} blocks.` };
  })));
}
