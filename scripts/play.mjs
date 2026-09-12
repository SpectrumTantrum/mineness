#!/usr/bin/env node
import { spawn, spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, existsSync, openSync, closeSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { lockBody } from '../src/session.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const providers = { claude: ['claude', 'Claude_Bot'], codex: ['codex', 'Codex_Bot'], grok: ['grok', 'Grok_Bot'], cursor: ['cursor-agent', 'Cursor_Bot'] };
const names = process.argv.slice(2).filter(x => !x.startsWith('--'));
const selected = !names.length || names.includes('all') ? Object.keys(providers) : names;
if (selected.some(n => !providers[n])) throw new Error('Usage: npm run play -- [all|claude|codex|grok|cursor] [--prepare]');
const prepareOnly = process.argv.includes('--prepare');
const runtime = join(root, '.runtime');
mkdirSync(runtime, { recursive: true });
const template = readFileSync(join(root, 'prompts/shared-operating-prompt.md'), 'utf8');
const children = new Set();
let stopping = false;
function stop() {
  if (stopping) return;
  stopping = true;
  for (const child of children) { try { process.kill(-child.pid, 'SIGTERM'); } catch {} }
  setTimeout(() => { for (const child of children) { try { process.kill(-child.pid, 'SIGKILL'); } catch {} } }, 3000).unref();
}
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
const json = JSON.stringify;
for (const name of selected) {
  let unlock = () => {};
  try {
    unlock = prepareOnly ? () => {} : lockBody(join(runtime, `${name}-launcher.pid`));
    process.on('exit', unlock);
    const [command, username] = providers[name];
    const cwd = join(runtime, name);
    mkdirSync(cwd, { recursive: true });
    if (['grok', 'cursor'].includes(name) && !existsSync(join(cwd, '.git'))) {
      const init = spawnSync('git', ['init', '-q', cwd]);
      if (init.status !== 0) throw new Error(`Cannot initialize the isolated ${name} game workspace.`);
    }
    const prompt = template.replaceAll('<NAME>', username);
    const promptFile = join(cwd, 'PROMPT.md');
    writeFileSync(promptFile, prompt);
    const server = { command: process.execPath, args: [join(root, 'src/server.js'), '--username', username, '--host', process.env.MC_HOST || '127.0.0.1', '--port', process.env.MC_PORT || '25565'] };
    const config = join(cwd, 'mcp.json');
    writeFileSync(config, json({ mcpServers: { mineness: { ...server, timeout: 180000 } } }, null, 2));
    let args;
    if (name === 'claude') {
      args = ['-p', '--verbose', '--output-format', 'stream-json', '--no-session-persistence', '--tools', '', '--allowedTools', 'mcp__mineness__*', '--permission-mode', 'dontAsk', '--strict-mcp-config', '--mcp-config', config, '--setting-sources', '', '--disable-slash-commands', '--no-chrome', '--system-prompt', prompt, 'Enter Minecraft. Call wait_for_mention now and keep listening between requests.'];
    } else if (name === 'codex') {
      const overrides = { 'model_instructions_file': promptFile, 'web_search': 'disabled', 'agents.enabled': false, 'mcp_servers.mineness.command': server.command, 'mcp_servers.mineness.args': server.args, 'mcp_servers.mineness.tool_timeout_sec': 180, 'mcp_servers.mineness.default_tools_approval_mode': 'approve' };
      args = ['exec', '--ignore-user-config', '--ignore-rules', '--ephemeral', '--sandbox', 'read-only', '--skip-git-repo-check', '--json', '-C', cwd];
      for (const feature of ['shell_tool', 'unified_exec', 'apps', 'multi_agent', 'plugins']) args.push('--disable', feature);
      for (const [key, value] of Object.entries(overrides)) args.push('-c', `${key}=${json(value)}`);
      args.push('Enter Minecraft. Call wait_for_mention now and keep listening between requests.');
    } else if (name === 'grok') {
      mkdirSync(join(cwd, '.grok'), { recursive: true });
      // Disable inherited servers by name, without changing the user's global config.
      const inspect = spawnSync(command, ['--cwd', root, 'inspect', '--json'], { encoding: 'utf8' });
      if (inspect.status !== 0) throw new Error(`grok inspect failed: ${inspect.stderr}`);
      const discovered = JSON.parse(inspect.stdout);
      const disabled = (discovered.mcpServers || []).filter(s => s.name !== 'mineness');
      writeFileSync(join(cwd, '.grok/config.toml'), `[mcp_servers.mineness]\ncommand = ${json(server.command)}\nargs = ${json(server.args)}\ntool_timeout_sec = 180\n` + disabled.map(s => `\n[mcp_servers.${json(s.name)}]\ncommand = ${json(process.execPath)}\nenabled = false\n`).join(''));
      // search_tool is classified as Read. The tool allowlist already removes
      // filesystem tools; denying Read here also hides the Minecraft tool schemas.
      args = ['--cwd', cwd, '--tools', 'search_tool,use_tool', '--disable-web-search', '--no-subagents', '--no-memory', '--permission-mode', 'dontAsk', '--allow', 'MCPTool(mineness__*)', '--deny', 'Bash', '--deny', 'Edit', '--deny', 'Grep', '--deny', 'WebFetch', '--deny', 'WebSearch', '--system-prompt-override', prompt, '--prompt-file', promptFile, '--output-format', 'streaming-json'];
      for (const server of disabled) args.push('--deny', `MCPTool(${server.name}__*)`);
      const checked = spawnSync(command, ['--cwd', cwd, 'inspect', '--json'], { encoding: 'utf8' });
      if (checked.status !== 0) throw new Error(`Cannot validate Grok configuration: ${checked.stderr}`);
      const resolved = JSON.parse(checked.stdout);
      if (!prepareOnly && !resolved.projectTrusted) throw new Error(`Open grok --cwd ${cwd}, trust this Minecraft workspace, quit, then run this launcher again.`);
      if (resolved.mcpServers.some(s => s.name !== 'mineness')) throw new Error('Grok still inherits other MCP servers. Refusing to start the game session.');
    } else {
      mkdirSync(join(cwd, '.cursor'), { recursive: true });
      let inherited = {};
      const globalConfig = join(homedir(), '.cursor/mcp.json');
      if (existsSync(globalConfig)) inherited = JSON.parse(readFileSync(globalConfig, 'utf8')).mcpServers || {};
      writeFileSync(join(cwd, '.cursor/mcp.json'), json({ mcpServers: { ...Object.fromEntries(Object.keys(inherited).map(n => [n, { ...inherited[n], disabled: true }])), mineness: server } }, null, 2));
      writeFileSync(join(cwd, '.cursor/cli.json'), json({ permissions: { allow: ['Mcp(mineness:*)'], deny: ['Shell(*)', 'Read(**)', 'Write(**)', 'WebFetch(*)'] } }, null, 2));
      if (!prepareOnly) {
        const enabled = spawnSync(command, ['--workspace', cwd, 'mcp', 'enable', 'mineness'], { cwd, encoding: 'utf8' });
        if (enabled.status !== 0) throw new Error(`Cursor MCP approval failed: ${enabled.stderr || enabled.stdout}`);
      }
      args = ['-p', '--model', 'cursor-grok-4.6-high', '--output-format', 'stream-json', '--workspace', cwd, '--trust', '--sandbox', 'enabled', prompt];
    }
    if (prepareOnly) { console.log(`Prepared ${name} in ${cwd}`); continue; }
    const logFile = join(runtime, `${name}.log`);
    const fd = openSync(logFile, 'a');
    const child = spawn(command, args, { cwd, detached: true, stdio: ['ignore', fd, fd], env: { ...process.env, CLAUDE_CODE_ENABLE_TELEMETRY: '0' } });
    closeSync(fd);
    children.add(child);
    console.log(`${username}: starting ${command}; log ${logFile}`);
    child.on('error', e => { unlock(); children.delete(child); console.error(`${name}: ${e.message}. Install the CLI and log in first.`); process.exitCode = 1; });
    child.on('exit', (code, signal) => {
      unlock();
      children.delete(child);
      if (!stopping) { console.error(`${username}: session ended (${signal || code}). Inspect ${logFile}, then restart it.`); if (code) process.exitCode = 1; }
    });
  } catch (error) {
    unlock();
    console.error(`${name}: ${error.message}`);
    process.exitCode = 1;
  }
}
