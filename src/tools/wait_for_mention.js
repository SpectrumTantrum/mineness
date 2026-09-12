import { z } from "zod";
import { toolResult } from "../bot.js";
import { DEFAULT_TIMEOUT_SECONDS, MAX_TIMEOUT_SECONDS } from "../inbox.js";

export const WAIT_FOR_MENTION_DESCRIPTION = `Block until a human player addresses you in Minecraft chat, then return what they said.

THIS IS YOUR MAIN LOOP. You are a player in a live Minecraft world. Your job is: wait for a mention, do what was asked, say something back, then call this tool again IMMEDIATELY. Never end your turn without calling this tool — if you stop calling it, you go silent and the player is talking to a statue. If this returns timed_out=true, nothing is wrong. Call it again at once. Do not ask clarifying questions unless you genuinely cannot act.

If this returns timed_out=true, nothing is wrong. Call it again at once.

Do not ask the human clarifying questions unless you genuinely cannot act. Prefer acting on a reasonable interpretation and reporting what you did. "Chop a tree" means the nearest tree; don't ask which one.`;

export function registerWaitForMention(mcp, inbox, actions, bot) {
  mcp.tool(
    "wait_for_mention",
    WAIT_FOR_MENTION_DESCRIPTION,
    {
      timeout_seconds: z
        .number()
        .int()
        .min(1)
        .max(MAX_TIMEOUT_SECONDS)
        .default(DEFAULT_TIMEOUT_SECONDS)
        .describe(
          "Return timed_out=true after this long so you can call again. Maximum 45 seconds.",
        ),
    },
    async ({ timeout_seconds }) => {
      const payload = await inbox.wait(timeout_seconds ?? DEFAULT_TIMEOUT_SECONDS);
      if (!payload.timed_out && !payload.stopped) {
        actions.resume(payload.isAll);
        const index = ["Claude_Bot", "Codex_Bot", "Grok_Bot", "Cursor_Bot"].indexOf(bot.username);
        bot.nextSpeechAt = payload.isAll ? Date.now() + Math.max(0, index) * 900 : 0;
      }
      return toolResult(payload);
    },
  );
}
