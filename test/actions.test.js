import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { setTimeout as delay } from "node:timers/promises";
import { Vec3 } from "vec3";
import { createActions, resolvePlayer, walkTo } from "../src/actions.js";
import { lockBody } from "../src/session.js";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

function body() {
  const bot = new EventEmitter();
  Object.assign(bot, { username: "Claude_Bot", entity: { position: new Vec3(0, 70, 0) },
    inventory: { items: () => [{ name: "oak_log", count: 3 }] },
    pathfinder: { goto: async () => { bot.walks++; }, stop() {}, setGoal() {} },
    digs: 0, walks: 0, dig: async () => { bot.digs++; },
    stopDigging() {}, clearControlStates() {}, deactivateItem() {},
    players: { Torres: { entity: { position: new Vec3(2, 70, 0) } } },
  });
  return bot;
}

// A literal stop must reject retries and prevent delayed plugin continuations.
const bot = body();
const actions = createActions(bot, 100);
const running = actions.run("chop_tree", async () => {
  await delay(30);
  await bot.pathfinder.goto({});
  await bot.dig({});
});
assert.equal((await actions.run("another", async () => {})).success, false);
actions.stop();
assert.equal((await running).stopped, true);
await delay(40);
assert.equal(bot.walks, 0);
assert.equal(bot.digs, 0);
assert.equal((await actions.run("retry", async () => {})).success, false);
actions.resume();
assert.equal((await actions.run("new request", async () => ({ summary: "done" }))).success, true);
actions.resume(true);
assert.match((await actions.run("broadcast mining", async () => {})).summary, /@all/);

// The deadline returns even if a dependency has not finished cancelling yet.
const timedBot = body();
const timedActions = createActions(timedBot, 10);
const timeout = await timedActions.run("stuck", async () => { await delay(40); });
assert.equal(timeout.timed_out, true);
assert.equal(timeout.success, false);
assert.equal((await timedActions.run("overlap", async () => {})).success, false);
await delay(45);
assert.equal(timedActions.state().action, null);

// An empty path must not be reported as a successful arrival.
await assert.rejects(walkTo(body(), new Vec3(10, 70, 0), 2, new AbortController().signal), /Could not reach/);
assert.equal(resolvePlayer(bot, "torres").username, "Torres");
assert.throws(() => resolvePlayer(bot, "missing"), /No other visible player/);

// A second MCP process must fail before it can steal the Minecraft username.
const dir = mkdtempSync(join(tmpdir(), "mineness-lock-"));
try {
  const path = join(dir, "Claude_Bot.pid");
  const unlock = lockBody(path);
  assert.throws(() => lockBody(path), /already running/);
  unlock();
  lockBody(path)();
} finally { rmSync(dir, { recursive: true, force: true }); }
console.log("actions.test.js PASS");
