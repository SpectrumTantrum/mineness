import { appendFileSync, mkdirSync, openSync, closeSync, readFileSync, writeFileSync, unlinkSync, renameSync } from "node:fs";
import { dirname } from "node:path";

export function lockBody(path) {
  mkdirSync(dirname(path), { recursive: true });
  try {
    const pid = Number(readFileSync(path, "utf8"));
    if (!Number.isInteger(pid) || pid <= 0) throw new Error(`Invalid body lock at ${path}; inspect it before removing it.`);
    try {
      process.kill(pid, 0);
    } catch (error) {
      if (error.code !== "ESRCH") throw error;
      unlinkSync(path);
    }
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  let fd;
  try { fd = openSync(path, "wx"); }
  catch (error) {
    if (error.code === "EEXIST") throw new Error("This Minecraft body is already running. Stop its existing agent before starting another.");
    throw error;
  }
  writeFileSync(fd, String(process.pid));
  closeSync(fd);
  return () => {
    try {
      if (readFileSync(path, "utf8") === String(process.pid)) unlinkSync(path);
    } catch (error) { if (error.code !== "ENOENT") throw error; }
  };
}

export function atomicJson(path, value) {
  const temporary = `${path}.${process.pid}.tmp`;
  writeFileSync(temporary, JSON.stringify(value), { mode: 0o600 });
  renameSync(temporary, path);
}

export function logToolCalls(mcp, username, path, onCall = () => {}) {
  const register = mcp.tool.bind(mcp);
  mcp.tool = (name, description, schema, handler) => register(name, description, schema, async (args, extra) => {
    onCall();
    const started = Date.now();
    let result;
    let error;
    try {
      result = await handler(args, extra);
      return result;
    } catch (err) {
      error = err.message;
      throw err;
    } finally {
      let payload;
      try { payload = JSON.parse(result?.content?.[0]?.text ?? "{}"); } catch { payload = {}; }
      appendFileSync(path, JSON.stringify({ ts: new Date(started).toISOString(), bot: username,
        tool: name, args, latency_ms: Date.now() - started,
        ok: !error && !result?.isError && payload.success !== false,
        error: error ?? (payload.success === false ? payload.summary : null),
        result_summary: payload.summary ?? (payload.timed_out ? "Waiting for a request" : "") }) + "\n");
    }
  });
}
