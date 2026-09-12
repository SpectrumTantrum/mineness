# Mineness

Claude, Codex, Grok, and Cursor as Minecraft teammates. Each coding-agent CLI controls its own Mineflayer player through a local MCP connection. They wait for your requests, announce what they will do, perform survival actions, and report what happened.

![The four teammate skins](skins/skins-mockup.png)

## Run locally

Requires Java 21 or newer, Node.js 22.12 or newer, and Minecraft Java Edition **1.21.11**. Install the coding-agent CLIs you want to use and sign in with their normal subscription login. No model API key is required by Mineness.

```bash
git clone --recurse-submodules https://github.com/SpectrumTantrum/mineness.git
cd mineness
npm ci
npm run setup
```

Setup downloads pinned Paper and SkinsRestorer jars and verifies their SHA-256 checksums. Read the [Minecraft EULA](https://aka.ms/MinecraftEULA), then set `eula=true` in `mc-server/eula.txt` if you accept it.

Start the server in one terminal:

```bash
npm run server
```

In another terminal, apply the skins once, then start your teammates:

```bash
npm run skins
npm run play -- claude codex grok cursor
```

You can select one provider, for example `npm run play -- codex`. `npm run play` defaults to all four. Missing or expired CLI logins must be resolved with `claude auth login`, `codex login`, `grok login`, or `cursor-agent login`.

Grok requires one initial workspace trust decision. Prepare its configuration, open the isolated game workspace, accept its trust prompt, then quit Grok and start the launcher:

```bash
npm run play -- grok --prepare
grok --cwd "$PWD/.runtime/grok"
npm run play -- grok
```

Join **localhost:25565** in Minecraft Java 1.21.11. The server uses offline authentication so the bots can join; it binds to localhost. Leave it local unless you intentionally configure access controls for a shared server.

## Play together

Type requests in Minecraft chat:

```text
@claude chop 4 oak logs and bring them to me
@codex follow me
@grok craft a crafting table and place it next to you
@cursor build a small wall with the blocks you have
@all what are you carrying?
stop
```

Full nametags such as `@Claude_Bot` also work. `@all` is for conversation and status; address a named teammate for physical work. A plain `stop` immediately stops every body. `@codex stop` stops just Codex. They wait for another request afterward.

Keep requests within survival abilities. A bot needs materials to build, ingredients to craft, and a suitable tool for blocks that require one. It can navigate, chop nearby trees, gather blocks, craft, place up to 32 blocks per call, deliver items, and follow a visible player. Each physical action has a 45-second limit, and the model can chain actions for a larger request. Dense terrain or inaccessible targets can still require a different approach.

Skin setup uses a temporary connection for each body. **Apply skins before starting the agents.** SkinsRestorer's live refresh respawns a player and can disrupt Mineflayer inventory and movement state. On subsequent launches, the server supplies the saved skin without refreshing it.

## How it works

```text
Minecraft chat → named teammate's inbox → its coding-agent CLI
                       ↑                         ↓
                 Minecraft body ← Mineness MCP tools
```

Each CLI starts one `src/server.js --username NAME_Bot` process. A lock prevents a second local session from taking the same body. The ten MCP tools are `wait_for_mention`, `say`, `look_around`, `goto`, `chop_tree`, `gather_blocks`, `craft_item`, `place_blocks`, `give_items_to_player`, and `follow_player`.

The shared operating prompt is in `prompts/shared-operating-prompt.md`. The launcher builds provider-specific configurations in ignored `.runtime/` directories and disables unrelated tool access. Minecraft chat cannot run slash commands through `say`. Bot messages do not wake other bots. The raw stop listener runs in the body process, so stopping does not wait for a model response.

CLI output goes to `.runtime/claude.log`, `.runtime/codex.log`, `.runtime/grok.log`, and `.runtime/cursor.log`. Completed tool calls are recorded in `calls.jsonl`, including duration, result, and failures. These logs, account settings, server passwords, player data, and worlds are excluded from Git.

Press Ctrl+C in the launcher terminal to disconnect its teammates. Their Minecraft inventories remain in the world. Type `stop` in the server terminal to save and stop Paper. `python3 scripts/rcon.py list` is available for local administration and reads the generated RCON password from the local server configuration.

## Checks

```bash
npm test
npm run test:game
node scripts/test-agents.mjs claude codex grok cursor
```

`npm test` checks routing, inbox behavior, cancellation, deadlines, and duplicate-body protection. `test:game` requires the local server; it creates a temporary test platform only after verifying that the space is empty, exercises real mining, crafting, placement, navigation, recipient pickup, following, and stopping, then removes the platform.

`test-agents.mjs` requires the selected CLI teammates to be running. It sends requests through a clearly named test player and verifies actual delivery to that player's inventory. It temporarily moves the selected bots to an empty test platform and restores their positions afterward. Run these integration checks when other players are not using that area.

## Sources and attribution

The starting Mineflayer/MCP connection code came from [yuniko-software/minecraft-mcp-server](https://github.com/yuniko-software/minecraft-mcp-server), under Apache-2.0. The running implementation uses the dependencies pinned in `package-lock.json`; the old reference checkout is not required. See `LICENSE` and `NOTICE`.

CLI configuration follows the official [Claude Code CLI reference](https://code.claude.com/docs/en/cli-reference), [Codex configuration reference](https://developers.openai.com/codex/config-reference/), [Grok headless documentation](https://docs.x.ai/build/cli/headless-scripting), and [Cursor CLI permissions](https://cursor.com/docs/cli/reference/permissions). Skins use [SkinsRestorer](https://skinsrestorer.net/docs/installation/quick-start) and the separate [Mineness skins repository](https://github.com/SpectrumTantrum/mineness-skins).

Mineness is an independent project. Product names and logos identify the represented teammates; they do not imply endorsement.
