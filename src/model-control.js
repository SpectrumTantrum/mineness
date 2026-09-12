import { spawn } from 'node:child_process';
import { openSync, closeSync, readFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { atomicJson } from './session.js';

export const PROVIDERS = ['claude', 'codex', 'grok', 'cursor'];
const efforts = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'];

export function modelSelection(provider, model, effort) {
  if (!PROVIDERS.includes(provider)) throw new Error('Unknown teammate. Use @claude, @codex, @grok, or @cursor.');
  model = model == null || model === 'default' ? (provider === 'cursor' ? 'cursor-grok-4.6-high' : null) : model;
  effort = effort || null;
  if (model !== null && (typeof model !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,127}$/.test(model))) throw new Error('Use a CLI model ID, without spaces or shell syntax.');
  if (effort !== null && !efforts.includes(effort)) throw new Error('Effort must be none, minimal, low, medium, high, xhigh, or max.');
  if (provider === 'claude' && ['none', 'minimal'].includes(effort)) throw new Error('Claude effort starts at low.');
  if (provider === 'cursor') {
    if (/^(cursor-)?grok-4\.[56]$/.test(model)) model = model.replace(/^grok-/, 'cursor-grok-') + '-high';
    if (effort) {
      if (/-((extra-)?high|low|medium|xhigh|max|minimal|none)(-fast)?$/.test(model)) {
        model = model.replace(/-((extra-)?high|low|medium|xhigh|max|minimal|none)(-fast)?$/, `-${effort}$3`);
      } else throw new Error('For this Cursor model, use its full model ID including effort.');
      effort = null;
    }
  }
  return { model, effort };
}

export function modelArgs(provider, selection) {
  const args = selection.model ? ['--model', selection.model] : [];
  if (selection.effort) {
    if (provider === 'codex') args.push('-c', `model_reasoning_effort=${JSON.stringify(selection.effort)}`);
    else args.push(provider === 'grok' ? '--reasoning-effort' : '--effort', selection.effort);
  }
  return args;
}

function readJson(path) {
  try { return JSON.parse(readFileSync(path, 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}

// One supervisor per teammate. Files keep the Paper command local and work
// whether the teammates were launched together or in separate terminals.
export function superviseModel({ provider, command, args, cwd, logFile, readyTimeoutMs = 90000, pollMs = 500 }) {
  const configFile = join(cwd, 'model.json');
  const requestFile = join(cwd, 'model-request.json');
  const readyFile = join(cwd, 'model-ready.json');
  const stateFile = join(cwd, 'model-state.json');
  const saved = readJson(configFile);
  let selection = modelSelection(provider, saved?.model, saved?.effort);
  let child = null;
  let busy = true;
  let stopped = false;
  let state = { status: 'starting', requestId: null, result: null, message: 'Connecting to the model.' };
  const publish = () => atomicJson(stateFile, { ...state, ...selection, heartbeatAt: Date.now(), pid: child?.pid ?? null });

  async function stopChild() {
    const previous = child;
    if (!previous) return;
    if (!previous.pid) { child = null; return; }
    try { process.kill(-previous.pid, 'SIGTERM'); } catch (error) { if (error.code !== 'ESRCH') throw error; }
    const deadline = Date.now() + 3000;
    while (previous.exitCode === null && previous.signalCode === null && Date.now() < deadline) await delay(50);
    if (previous.exitCode === null && previous.signalCode === null) {
      try { process.kill(-previous.pid, 'SIGKILL'); } catch (error) { if (error.code !== 'ESRCH') throw error; }
      while (previous.exitCode === null && previous.signalCode === null) await delay(50);
    }
    if (child === previous) child = null;
  }

  async function startChild(next) {
    if (stopped) throw new Error('Launcher stopped.');
    const runId = randomUUID();
    atomicJson(join(cwd, 'model-launch.json'), { runId });
    const flags = modelArgs(provider, next);
    const argv = provider === 'codex' ? [args[0], ...flags, ...args.slice(1)] : [...flags, ...args];
    const fd = openSync(logFile, 'a');
    try {
      child = spawn(command, argv, { cwd, detached: true, stdio: ['ignore', fd, fd],
        env: { ...process.env, CLAUDE_CODE_ENABLE_TELEMETRY: '0' } });
    } finally { closeSync(fd); }
    const started = child;
    let spawnError;
    started.on('error', error => { spawnError = error; });
    started.on('exit', (code, signal) => {
      if (child === started && !busy && !stopped) {
        state.status = 'offline';
        state.message = `CLI ended (${signal || code}). Check ${provider}.log or select a model to reconnect.`;
        publish();
      }
    });
    const deadline = Date.now() + readyTimeoutMs;
    while (!stopped && Date.now() < deadline) {
      if (spawnError) throw spawnError;
      if (started.exitCode !== null || started.signalCode !== null) throw new Error(`CLI rejected the session (${started.signalCode || started.exitCode}). See .runtime/${provider}.log.`);
      if (readJson(readyFile)?.runId === runId) return;
      await delay(Math.min(pollMs, 250));
    }
    throw new Error(stopped ? 'Launcher stopped.' : 'The model did not connect within 90 seconds.');
  }

  async function handleRequest() {
    if (busy || stopped) return;
    let request;
    try { request = readJson(requestFile); }
    catch (error) { console.error(`${provider}: invalid model request: ${error.message}`); unlinkSync(requestFile); return; }
    if (!request) return;
    busy = true;
    state.requestId = request.id;
    state.result = null;
    let next;
    try { next = modelSelection(provider, request.model, request.effort); }
    catch (error) {
      state.result = 'failed'; state.message = error.message;
      unlinkSync(requestFile); busy = false; publish(); return;
    }
    const previous = selection;
    state.status = 'switching'; state.message = 'Reconnecting with the requested model.';
    publish();
    unlinkSync(requestFile);
    try {
      await stopChild();
      await startChild(next);
      if (stopped) return;
      atomicJson(configFile, next);
      selection = next;
      state = { status: 'running', requestId: request.id, result: 'applied', message: `Using ${next.model || 'the CLI default'}${next.effort ? `, effort ${next.effort}` : ''}.` };
    } catch (error) {
      if (stopped) return;
      state.message = error.message;
      await stopChild();
      try {
        await startChild(previous);
        state.status = 'running'; state.message += ' Previous model restored.';
      } catch (restoreError) { state.status = 'offline'; state.message += ` Restore failed: ${restoreError.message}`; }
      state.result = 'failed';
    } finally { busy = false; publish(); }
  }

  publish();
  const timer = setInterval(() => { publish(); handleRequest().catch(error => { console.error(`${provider}: ${error.message}`); }); }, pollMs);
  startChild(selection).then(() => {
    state.status = 'running'; state.message = 'Ready for Minecraft requests.';
  }).catch(async error => {
    await stopChild(); state.status = 'offline'; state.message = error.message;
    console.error(`${provider}: ${error.message}`);
  }).finally(() => { busy = false; publish(); });

  return { stop: async () => { stopped = true; clearInterval(timer); await stopChild(); state.status = 'offline'; state.message = 'Launcher stopped.'; publish(); } };
}
