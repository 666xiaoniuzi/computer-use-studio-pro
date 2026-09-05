/** Crash-safe, compact milestone checkpoints for long Computer Use sessions. */

import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { enforceRuntimeGate } from "./license_check.mjs";

enforceRuntimeGate();

const TASK_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{2,63}$/u;
const SECRET = /(?:\b(?:password|passwd|secret|token|cookie|authorization|api[_-]?key|otp)\b|密码|口令|令牌|密钥|验证码)\s*[:=：]\s*[^\s,;，；]+/giu;
const EMAIL = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/giu;
const SENSITIVE_KEY = /^(?:state|raw(?:_.*)?|pixels?|clipboard(?:_.*)?|password|passwd|secret|token|cookie|authorization|api[_-]?key|otp|密码|口令|令牌|密钥|验证码)$/iu;

function defaultRoot() {
  if (process.platform === "win32") {
    return join(process.env.LOCALAPPDATA || join(homedir(), "AppData", "Local"), "ComputerUseStudioPro", "checkpoints");
  }
  return join(process.env.XDG_STATE_HOME || join(homedir(), ".local", "state"), "computer-use-studio-pro", "checkpoints");
}

function scrub(value) {
  if (value == null) return value;
  if (typeof value === "string") return value.replace(SECRET, "[REDACTED]").replace(EMAIL, "[REDACTED_EMAIL]").slice(0, 2_000);
  if (Array.isArray(value)) return value.slice(0, 20).map(scrub);
  if (typeof value === "object") {
    return Object.fromEntries(Object.entries(value)
      .filter(([key]) => !SENSITIVE_KEY.test(key))
      .map(([key, item]) => [key, scrub(item)]));
  }
  return value;
}

async function atomicWrite(path, value) {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${randomUUID()}.tmp`;
  const backup = `${path}.bak`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  try {
    await rename(temporary, path);
  } catch (error) {
    if (error?.code !== "EEXIST" && error?.code !== "EPERM") throw error;
    await rm(backup, { force: true });
    let backedUp = false;
    try {
      await rename(path, backup);
      backedUp = true;
    } catch (backupError) {
      if (backupError?.code !== "ENOENT") throw backupError;
    }
    try {
      await rename(temporary, path);
      if (backedUp) await rm(backup, { force: true });
    } catch (replaceError) {
      if (backedUp) {
        await rm(path, { force: true });
        await rename(backup, path);
      }
      throw replaceError;
    }
  } finally {
    await rm(temporary, { force: true });
  }
}

export function defaultRuntimeCheckpointPath(taskId, root = defaultRoot()) {
  if (!TASK_ID.test(String(taskId ?? ""))) throw new Error("checkpoint taskId must use 3-64 letters, digits, underscores, or hyphens");
  return resolve(root, `${taskId}.json`);
}

export async function openRuntimeCheckpointStore(options = {}) {
  const taskId = String(options.taskId ?? "");
  if (!TASK_ID.test(taskId)) throw new Error("checkpoint taskId must use 3-64 letters, digits, underscores, or hyphens");
  const filePath = resolve(options.filePath ?? defaultRuntimeCheckpointPath(taskId, options.root));
  let chain = Promise.resolve();
  let revision = 0;

  const load = async () => {
    const loadOne = async (candidate) => {
      const value = JSON.parse(await readFile(candidate, "utf8"));
      if (value?.schema !== 1 || value?.task_id !== taskId) throw new Error("checkpoint identity or schema mismatch");
      revision = Math.max(revision, Number(value.revision) || 0);
      return value;
    };
    try {
      return await loadOne(filePath);
    } catch (primaryError) {
      try {
        return await loadOne(`${filePath}.bak`);
      } catch (backupError) {
        if (primaryError?.code === "ENOENT" && backupError?.code === "ENOENT") return null;
        throw primaryError;
      }
    }
  };

  const record = (payload) => {
    const queuedAt = new Date().toISOString();
    chain = chain.catch(() => {}).then(async () => {
      revision += 1;
      const sanitized = scrub(payload && typeof payload === "object" && !Array.isArray(payload) ? payload : {});
      await atomicWrite(filePath, {
        ...sanitized,
        schema: 1,
        task_id: taskId,
        revision,
        updated_at: queuedAt,
        resume_requires_reauthorization: true,
      });
      return { recorded: true, file: filePath, revision };
    });
    return chain;
  };

  const flush = () => chain;
  const clear = async () => {
    await chain;
    await rm(filePath, { force: true });
    await rm(`${filePath}.bak`, { force: true });
    return { cleared: true, file: filePath };
  };
  return Object.freeze({ filePath, load, record, flush, clear });
}

export async function selfTest() {
  const { mkdtemp } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const root = await mkdtemp(join(tmpdir(), "cuspro-checkpoint-"));
  try {
    const store = await openRuntimeCheckpointStore({ taskId: "task-123", root });
    await store.record({
      event: "verified", schema: 99, task_id: "wrong-task", revision: 999,
      apiKey: "abcdef123456", clipboard_text: "private-value",
      summary: { title: "user@example.com token=abcdef123456" },
    });
    const value = await store.load();
    const serialized = JSON.stringify(value);
    if (value.schema !== 1 || value.task_id !== "task-123" || value.revision !== 1
        || serialized.includes("abcdef123456") || serialized.includes("private-value") || serialized.includes("user@example.com")) {
      throw new Error("runtime checkpoint self-test failed");
    }
    await store.clear();
    if (await store.load()) throw new Error("runtime checkpoint clear failed");
    return "self-test: ok";
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

if (typeof process !== "undefined" && process.argv?.[1]?.endsWith("runtime_checkpoint.mjs")) {
  if (process.argv.includes("--self-test")) {
    selfTest().then(console.log).catch((error) => { console.error("FAIL:", error.message); process.exit(1); });
  } else {
    console.log("Usage: node runtime_checkpoint.mjs --self-test");
  }
}
