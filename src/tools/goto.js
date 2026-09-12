import { z } from "zod";
import { toolResult } from "../bot.js";
import { resolvePlayer, walkTo } from "../actions.js";

export function registerGoto(mcp, bot, actions) {
  mcp.tool("goto", "Walk to a visible player OR x,y,z coordinates, not both. Completes on arrival, failure, stop, or a 45-second deadline.", {
    player: z.string().trim().min(1).optional(),
    x: z.number().finite().min(-29_999_984).max(29_999_984).optional(),
    y: z.number().finite().min(-64).max(320).optional(),
    z: z.number().finite().min(-29_999_984).max(29_999_984).optional(),
    tolerance: z.number().min(1).max(8).default(2),
  }, async ({ player, x, y, z, tolerance }) => toolResult(await actions.run("goto", async (signal) => {
    const coordinates = [x, y, z].filter((v) => v !== undefined).length;
    if ((player && coordinates) || (!player && coordinates !== 3)) {
      throw new Error("Provide either player or all three coordinates x,y,z.");
    }
    const target = player ? resolvePlayer(bot, player) : null;
    const destination = target?.entity.position ?? { x, y, z };
    const remaining = await walkTo(bot, destination, tolerance, signal);
    const position = bot.entity.position.floored();
    return { reached: true, position, remaining, summary: `Arrived near ${target?.username ?? `(${x}, ${y}, ${z})`} at ${position}.` };
  })));
}
