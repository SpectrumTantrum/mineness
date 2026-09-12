#!/usr/bin/env node
/**
 * Mineness MCP server — one stdio process per bot (--username).
 * Fork plumbing from yuniko-software/minecraft-mcp-server (Apache-2.0).
 * Tools and routing are original.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import yargs from "yargs";
import { hideBin } from "yargs/helpers";
import { createBot } from "./bot.js";
import { createInbox } from "./inbox.js";
import { route } from "./routing.js";
import { BOT_USERNAMES, MENTION, shortName } from "./routing.js";
import { createActions } from "./actions.js";
import { lockBody, logToolCalls } from "./session.js";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { registerSay } from "./tools/say.js";
import { registerWaitForMention } from "./tools/wait_for_mention.js";
import { registerLookAround } from "./tools/look_around.js";
import { registerGoto } from "./tools/goto.js";
import { registerPlay } from "./tools/play.js";

const config = yargs(hideBin(process.argv))
  .option("host", { type: "string", default: "127.0.0.1" })
  .option("port", { type: "number", default: 25565 })
  .option("username", { type: "string", demandOption: true })
  .check(({ username, port }) => {
    if (!/^[A-Za-z0-9_]{3,16}$/.test(username)) throw new Error("Username must be 3-16 letters, numbers, or underscores.");
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("Invalid Minecraft port.");
    return true;
  })
  .help()
  .parseSync();

const log = (level, msg) => {
  console.error(`[mineness] [${config.username}] [${level}] ${msg}`);
};

const root = fileURLToPath(new URL("../", import.meta.url));
const unlock = lockBody(join(root, ".runtime", `${config.username}.pid`));
process.on("exit", unlock);
const bot = createBot(config, log);
const actions = createActions(bot);
const inbox = createInbox();

function usernameFromUuid(uuid) {
  if (uuid == null || uuid === "") return null;
  const id = String(uuid).replaceAll("-", "").toLowerCase();
  for (const [name, p] of Object.entries(bot.players ?? {})) {
    if (String(p.uuid ?? "").replaceAll("-", "").toLowerCase() === id) return name;
  }
  return null;
}

function parseChat(msg, sender) {
  const text = String(msg ?? "");
  const angle = /^<([^>]+)>\s*(.*)$/.exec(text);
  const bracket = /^\[([^\]]+)\]\s*(.*)$/.exec(text);
  const fromUuid = usernameFromUuid(sender);
  if (angle) return { username: fromUuid ?? angle[1], body: angle[2] };
  if (bracket) return { username: fromUuid ?? bracket[1], body: bracket[2] };
  return {
    username: fromUuid ?? (sender ? String(sender) : "Server"),
    body: text,
  };
}

function onMention(username, message) {
  // Chat-triggered gameplay accepts human requests only. This also prevents
  // two model-driven teammates from keeping each other awake indefinitely.
  if (BOT_USERNAMES.has(username) || username === config.username) return;
  const mention = MENTION.exec(message);
  const addressed = mention && [shortName(config.username), config.username.toLowerCase(), "all", "everyone"].includes(mention[1].toLowerCase());
  if (/^stop[.!]?$/i.test((addressed ? message.slice(mention[0].length) : message).trim()) && (!mention || addressed)) {
    actions.stop();
    inbox.clear();
    inbox.push({ from: username, text: "Stopped. Wait for a new request before doing anything else.", stopped: true });
    log("info", `stop requested by ${username}`);
    return;
  }
  const routed = route({ me: config.username, username, plainMessage: message });
  if (!routed) return;
  const other = bot.players?.[username]?.entity?.position;
  const mePos = bot.entity?.position;
  if (other && mePos) {
    routed.speaker_position = { x: other.x, y: other.y, z: other.z };
    routed.distance = mePos.distanceTo(other);
  }
  log("info", `inbox <= ${username}: ${routed.text}`);
  inbox.push(routed);
}

// 1.19+ player chat + system /say. Never gate on verified.
bot.on("messagestr", (msg, position, _json, sender, verified) => {
  if (position === "game_info") return;
  const { username, body } = parseChat(msg, sender);
  onMention(username, body);
});

const mcp = new McpServer({ name: "mineness", version: "0.1.0" });
logToolCalls(mcp, config.username, join(root, "calls.jsonl"));
registerSay(mcp, bot);
registerWaitForMention(mcp, inbox, actions, bot);
registerLookAround(mcp, bot, actions);
registerGoto(mcp, bot, actions);
registerPlay(mcp, bot, actions);

let closing = false;
function shutdown(code = 0) {
  if (closing) return;
  closing = true;
  actions.stop("Agent session ended.");
  try {
    inbox.cancelAll();
  } catch {
    /* ignore */
  }
  try {
    bot.quit();
  } catch {
    /* ignore */
  }
  process.exit(code);
}
process.stdin.on("end", () => shutdown());
process.on("SIGINT", () => shutdown());
process.on("SIGTERM", () => shutdown());
bot.on("end", () => shutdown(1));

const transport = new StdioServerTransport();
await mcp.connect(transport);
log("info", "MCP stdio connected");
