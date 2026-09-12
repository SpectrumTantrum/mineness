/** Server-side mention filter. Unit-testable with strings; no Minecraft. */

export const BOT_USERNAMES = new Set([
  "Claude_Bot",
  "Codex_Bot",
  "Grok_Bot",
  "Cursor_Bot",
]);

export const COOLDOWN_MS = 2000;
export const MENTION = /^\s*@([a-z][a-z0-9_]*)\b[,:]?\s*/i;

const SHORT_ALIAS = {
  claude_bot: "claude",
  grok_bot: "grok",
  codex_bot: "codex",
  cursor_bot: "cursor",
};

const lastSpoke = new Map(); // username -> ts
let globalTokens = [];

export function shortName(username) {
  return String(username).split("_")[0].toLowerCase();
}

export function route(input, now = Date.now()) {
  const username = input.username ?? "";
  const plainMessage = input.plainMessage ?? "";
  const me = input.me;
  const myShort = shortName(me);

  // R1 ignore-own-username
  if (username === me || BOT_USERNAMES.has(username)) return null;

  const m = MENTION.exec(plainMessage);
  if (!m) return null; // unaddressed => silence
  const raw = m[1].toLowerCase();
  const target = raw === me.toLowerCase() ? myShort : (SHORT_ALIAS[raw] ?? raw);
  const isAll = target === "all" || target === "everyone";
  if (!isAll && target !== myShort) return null;

  // R4 per-bot cooldown: DROP excess, never queue.
  // No prior hit → no cooldown. Do not coerce missing to 0 (synthetic `now` in tests).
  const prev = lastSpoke.get(me);
  if (prev !== undefined && now - prev < COOLDOWN_MS) return null;

  // R5 global token bucket: 1 msg/bot/1.5s, 3/sec overall (best-effort in-process)
  globalTokens = globalTokens.filter((t) => now - t < 1000);
  if (globalTokens.length >= 3) return null;

  lastSpoke.set(me, now);
  globalTokens.push(now);

  return {
    from: username,
    fromBot: false,
    hops: 0,
    target,
    isAll,
    text: plainMessage.slice(m[0].length),
    ts: now,
  };
}

/** Reset cooldown/bucket state between tests. */
export function resetRoutingState() {
  lastSpoke.clear();
  globalTokens = [];
}
