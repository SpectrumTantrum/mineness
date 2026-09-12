import pathfinderPkg from "mineflayer-pathfinder";
import { Vec3 } from "vec3";

export const ACTION_CAP_MS = 45_000;
const { goals } = pathfinderPkg;

export function inventoryCounts(bot) {
  const counts = {};
  for (const item of bot.inventory.items()) counts[item.name] = (counts[item.name] ?? 0) + item.count;
  return counts;
}

export function resolvePlayer(bot, name) {
  const want = String(name).trim().toLowerCase();
  const players = Object.entries(bot.players ?? {}).filter(([, p]) => p.entity);
  const exact = players.find(([n]) => n.toLowerCase() === want);
  const aliases = players.filter(([n]) => n.split("_")[0].toLowerCase() === want);
  const found = exact ?? (aliases.length === 1 ? aliases[0] : null);
  if (!found || found[0] === bot.username) throw new Error(`No other visible player named ${name}. Use look_around to see who is nearby.`);
  return { username: found[0], entity: found[1].entity };
}

export async function walkTo(bot, position, distance, signal) {
  signal.throwIfAborted();
  const p = new Vec3(position.x, position.y, position.z);
  const goal = new goals.GoalNear(p.x, p.y, p.z, distance);
  try { await bot.pathfinder.goto(goal); }
  finally { bot.pathfinder.setGoal(null); }
  signal.throwIfAborted();
  // Pathfinder can resolve with an empty path even when the goal is unreachable.
  if (!goal.isEnd(bot.entity.position.floored())) throw new Error(`Could not reach ${p.floored()}. Try a closer or accessible destination.`);
  return Math.round(bot.entity.position.distanceTo(p) * 10) / 10;
}

export function createActions(bot, capMs = ACTION_CAP_MS) {
  let current = null;
  let paused = false;
  let broadcast = false;
  let following = null;

  // collectBlock may start another walk or dig after its previous await. Guard
  // those entry points as well as our own loops when an action is cancelled.
  for (const [object, method] of [[bot.pathfinder, "goto"], [bot, "dig"]]) {
    if (!object?.[method]) continue;
    const original = object[method].bind(object);
    object[method] = async (...args) => {
      current?.controller.signal.throwIfAborted();
      return original(...args);
    };
  }

  function haltMotion() {
    following = null;
    bot.pathfinder?.stop();
    bot.pathfinder?.setGoal(null);
    bot.stopDigging?.();
    bot.clearControlStates?.();
    bot.deactivateItem?.();
  }

  function stop(reason = "Stopped by a player. Wait for a new request.") {
    paused = true;
    current?.controller.abort(new Error(reason));
    haltMotion();
  }

  function unavailable() {
    if (!bot.entity || bot.minenessReady === false) return "Not spawned in Minecraft yet. Wait and retry.";
    if (current) return `Still finishing ${current.name}. Wait for that action to finish.`;
    if (paused) return "Stopped. Call wait_for_mention for a new request before acting again.";
    if (broadcast) return "@all is for chat and status. Ask a named teammate to perform a game action.";
    return null;
  }

  async function run(name, work) {
    const problem = unavailable();
    if (problem) return { success: false, summary: problem };
    haltMotion();
    const job = { name, controller: new AbortController() };
    current = job;
    const { signal } = job.controller;
    const before = inventoryCounts(bot);
    const started = Date.now();
    const timer = setTimeout(() => {
      job.timedOut = true;
      job.controller.abort(new Error("Action exceeded 45 seconds. Check your surroundings before retrying."));
      haltMotion();
    }, capMs);
    const aborted = new Promise((_, reject) => signal.addEventListener("abort", () => reject(signal.reason), { once: true }));
    // Keep a cancelled body busy until the library operation settles, so a late
    // continuation cannot interfere with the next action.
    const pending = Promise.resolve().then(() => work(signal)).finally(() => {
      if (current === job) current = null;
    });
    try {
      return { success: true, ...await Promise.race([pending, aborted]), elapsed_ms: Date.now() - started };
    } catch (error) {
      haltMotion();
      const after = inventoryCounts(bot);
      const gained = Object.fromEntries(Object.entries(after).map(([item, count]) => [item, count - (before[item] ?? 0)]).filter(([, n]) => n > 0));
      return { success: false, stopped: signal.aborted && !job.timedOut,
        timed_out: Boolean(job.timedOut), gained, inventory: after,
        elapsed_ms: Date.now() - started, summary: error.message || String(error) };
    } finally {
      clearTimeout(timer);
    }
  }

  function follow(player, distance) {
    const problem = unavailable();
    if (problem) return { success: false, summary: problem };
    const target = resolvePlayer(bot, player);
    haltMotion();
    following = target.username;
    bot.pathfinder.setGoal(new goals.GoalFollow(target.entity, distance), true);
    return { success: true, following, summary: `Following ${following}. Say stop to make me stay here.` };
  }

  bot.on("entityGone", (entity) => {
    if (following && entity.username === following) haltMotion();
  });
  bot.on("death", () => stop("I died. Wait for me to respawn, then give me a new request."));
  bot.on("end", () => stop("Disconnected from Minecraft."));
  return { run, stop, follow, resume: (isAll = false) => { paused = false; broadcast = isAll; },
    state: () => ({ action: current?.name ?? null, following, paused }) };
}
