import { z } from "zod";
import { toolResult, truncateChat } from "../bot.js";
import { setTimeout as delay } from "node:timers/promises";

export const SAY_DESCRIPTION = `Send a message in Minecraft chat as yourself. Everyone in the world sees it.

HARD LIMIT: 240 characters. Minecraft Java throws EncoderException over 256 — it does not truncate, it crashes the packet. Write ONE short sentence. This is a game chat box, not a terminal — no markdown, no bullet lists, no code blocks. Nobody reads a wall of text in Minecraft.

Good: "On it — chopping that birch now."
Good: "Got 5 logs. Want me to bring them over?"
Bad:  "I have successfully completed the requested task. Summary: ..."
Bad:  "Here are the options:\\n1. ...\\n2. ..."

Talk like a player, not an assistant. Short. Casual.`;

export function registerSay(mcp, bot) {
  mcp.tool(
    "say",
    SAY_DESCRIPTION,
    {
      message: z
        .string()
        .max(240)
        .regex(/^[^\x00-\x1f\x7f]*$/, "Use a single chat line.")
        .refine((text) => !text.trimStart().startsWith("/"), "Server commands are not chat.")
        .describe("Chat line. HARD LIMIT 240 characters. No markdown."),
    },
    async ({ message }) => {
      const { text, truncated } = truncateChat(message);
      if (!bot.entity) {
        return toolResult({
          success: false,
          sent: false,
          text,
          truncated,
          summary: "Cannot chat: bot has not spawned yet. Retry in a second.",
        });
      }
      await delay(Math.max(0, (bot.nextSpeechAt ?? 0) - Date.now()));
      bot.nextSpeechAt = Date.now() + 1500;
      bot.chat(text);
      return toolResult({
        success: true,
        sent: true,
        text,
        truncated,
        summary: truncated ? `Said (truncated): ${text}` : `Said: ${text}`,
      });
    },
  );
}
