# Demo server

This is the example local Paper server for Mineness, using Minecraft Java **1.21.11**. It starts a fresh survival world on peaceful difficulty, with PvP disabled. It listens on `127.0.0.1:25565` and uses offline authentication so the AI teammates can join.

## Start the demo

Install Java 21 or newer and Node.js 22.12 or newer, then run these commands from the repository root:

```bash
npm ci
npm run setup
```

Setup downloads pinned Paper and SkinsRestorer jars, verifies their checksums, generates a private RCON password, and installs the included datapack and `/model` plugin. Read the [Minecraft EULA](https://aka.ms/MinecraftEULA), then set `eula=true` in `mc-server/eula.txt` if you accept it.

```bash
npm run server
```

Once the server is ready, join `localhost:25565` in Minecraft Java 1.21.11. In another terminal at the repository root, apply the skins and launch a teammate whose CLI you have installed and signed into:

```bash
npm run skins
npm run play -- codex
```

Type `@codex follow me` in Minecraft chat to try it, then `@codex stop` to stop following. See the [main guide](../README.md#play-together) for other teammates and actions. Stop the launcher with Ctrl+C, then type `stop` in the server terminal to save the world and shut down.

## Files in the example

- `server.properties.example` contains the local demo defaults and a password placeholder. Setup creates `server.properties` only when it is missing, preserving later edits.
- `start.sh` starts Paper with 2 GB initial and 4 GB maximum heap memory.
- `datapacks/mineness/` assigns teammate name colors.
- `model-command/` contains the `/model` plugin source and compiled jar. Rebuild instructions are in the [main guide](../README.md#checks).

Downloaded server files, generated configuration, passwords, logs, and saved worlds stay local and are excluded from Git. Re-running setup preserves an existing world; a fresh clone creates a new one on first startup. Keep this offline server local unless you configure access controls for a shared server.
