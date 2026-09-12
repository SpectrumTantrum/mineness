import mineflayer from "mineflayer";
import pathfinderPkg from "mineflayer-pathfinder";
import collectBlockPkg from "mineflayer-collectblock";

const { pathfinder, Movements } = pathfinderPkg;

export const MC_VERSION = "1.21.11";

export function createBot(config, log) {
  const bot = mineflayer.createBot({
    host: config.host,
    port: config.port,
    username: config.username,
    auth: "offline",
    version: MC_VERSION,
    disableChatSigning: true,
    plugins: { pathfinder, collectBlock: collectBlockPkg.plugin },
  });
  bot.minenessReady = false;

  bot.on("login", () => log("info", `logged in as ${bot.username}`));
  bot.on("spawn", () => {
    bot.minenessReady = true;
    log("info", `spawned at ${fmtPos(bot)}`);
    try {
      // 1.21.11 rejects movement at exact block-edge alignment. Leave a tiny
      // client-side gap: https://github.com/PrismarineJS/mineflayer-pathfinder/pull/364
      bot.physics.playerHalfWidth = 0.30001;
      bot.physics.playerHeight = 1.80001;
      const movements = new Movements(bot);
      movements.canDig = false;
      movements.allow1by1towers = false;
      bot.pathfinder.setMovements(movements);
      // Keep our protection rules. The plugin's default overrides them.
      bot.collectBlock.movements = null;
    } catch (err) {
      log("error", `pathfinder movements: ${err.message || err}`);
    }
  });
  bot.on("death", () => { bot.minenessReady = false; });
  bot.on("kicked", (reason) => log("error", `kicked: ${stringify(reason)}`));
  bot.on("error", (err) => log("error", `error: ${err.message || err}`));
  bot.on("end", (reason) => {
    bot.minenessReady = false;
    log("info", `disconnected: ${reason}`);
  });
  return bot;
}

export function fmtPos(bot) {
  const p = bot.entity?.position;
  if (!p) return "(unknown)";
  return `(${Math.floor(p.x)}, ${Math.floor(p.y)}, ${Math.floor(p.z)})`;
}

export function toolResult(obj) {
  return { content: [{ type: "text", text: JSON.stringify(obj) }] };
}

export function truncateChat(message) {
  const text = String(message ?? "").slice(0, 240);
  return { text, truncated: String(message ?? "").length > 240 };
}

function stringify(v) {
  if (typeof v === "string") return v;
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}
