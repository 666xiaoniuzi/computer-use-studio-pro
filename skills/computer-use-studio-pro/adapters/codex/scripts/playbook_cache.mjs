/** Verified cross-task repair playbook cache for Computer Use Studio Pro. */

import { createHash, randomUUID } from "node:crypto";
import { realpathSync } from "node:fs";
import {
  mkdir,
  open,
  readFile,
  rename,
  rm,
  stat,
  unlink,
  writeFile,
  mkdtemp,
} from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

import { enforceRuntimeGate } from "./license_check.mjs";

// 零售授权门控：与 sky_fast_path.mjs 相同，未通过时拒绝加载。
enforceRuntimeGate();

const SCHEMA = 1;
const MAX_RECIPES = 128;
const MAX_TEXT = 180;
const DEFAULT_MATCH_CHARS = 900;
const SECRET_ASSIGNMENT = /(?:\b(?:password|passwd|secret|token|cookie|authorization|api[_-]?key|otp)\b|密码|口令|令牌|密钥|验证码)\s*[:=：]\s*[^\s,;，；]+/giu;
const PREFIX_SECRET = /\b(?:sk|ghp|github_pat|xox[baprs])[-_][A-Za-z0-9_-]{8,}\b/gu;
const BEARER_SECRET = /\bbearer\s+[A-Za-z0-9._~+/=-]{8,}\b/giu;
const JWT_SECRET = /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/gu;
const AWS_ACCESS_KEY = /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/gu;
const EMAIL = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/giu;
const PHONE = /(?<!\d)(?:\+?\d[\d -]{7,}\d)(?!\d)/gu;
const RAW_REFERENCE_KEYS = /^(?:x|y|from_x|from_y|to_x|to_y|screenshot_?id|element_?index|window_?id|device_?id|remote_?id|password|secret|token|cookie|api_?key|otp)$/iu;

function cleanText(value, limit = MAX_TEXT) {
  const text = String(value ?? "")
    .replace(SECRET_ASSIGNMENT, "[REDACTED]")
    .replace(PREFIX_SECRET, "[REDACTED]")
    .replace(BEARER_SECRET, "Bearer [REDACTED]")
    .replace(JWT_SECRET, "[REDACTED_JWT]")
    .replace(AWS_ACCESS_KEY, "[REDACTED_AWS_KEY]")
    .replace(EMAIL, "[REDACTED_EMAIL]")
    .replace(PHONE, "[REDACTED_PHONE]")
    .replace(/\s+/gu, " ")
    .trim();
  return [...text].slice(0, limit).join("");
}

function normal(value, limit = 80) {
  return cleanText(value, limit).toLowerCase();
}

function versionBucket(value) {
  const match = String(value ?? "").match(/\d+(?:\.\d+){0,2}/u);
  return match?.[0] ?? "";
}

function symptomTokens(value) {
  const text = normal(value, 160);
  const words = text.match(/[a-z0-9]+/gu) ?? [];
  const chinese = [...text.replace(/[^\p{Script=Han}]/gu, "")];
  const bigrams = chinese.slice(0, -1).map((character, index) => character + chinese[index + 1]);
  return new Set([...words, ...bigrams]);
}

function symptomSimilarity(left, right) {
  const a = symptomTokens(left);
  const b = symptomTokens(right);
  if (a.size === 0 || b.size === 0) return null;
  let intersection = 0;
  for (const token of a) if (b.has(token)) intersection += 1;
  return intersection / (a.size + b.size - intersection);
}

function confidence(entry) {
  return Math.round(((entry.successes + 1) / (entry.successes + entry.failures + 2)) * 1000) / 1000;
}

function normalizeContext(context = {}) {
  return {
    problem_class: normal(context.problem_class ?? context.problemClass ?? context.task_family ?? context.taskFamily, 80),
    symptom: normal(context.symptom, 120),
    os_family: normal(context.os_family ?? context.osFamily, 40),
    os_version: versionBucket(context.os_version ?? context.osVersion),
    app: normal(context.app, 80),
    app_version: versionBucket(context.app_version ?? context.appVersion),
    remote_client: normal(context.remote_client ?? context.remoteClient, 40),
    surface: normal(context.surface, 40),
  };
}

function stringList(value, limit, itemChars = MAX_TEXT) {
  return (Array.isArray(value) ? value : [])
    .map((item) => cleanText(item, itemChars))
    .filter(Boolean)
    .slice(0, limit);
}

function normalizeStep(step) {
  if (typeof step === "string") {
    return { action: cleanText(step, 80) };
  }
  if (!step || typeof step !== "object") return null;
  const safe = {};
  for (const [key, value] of Object.entries(step)) {
    if (RAW_REFERENCE_KEYS.test(key)) continue;
    if (key === "action") safe.action = cleanText(value, 60);
    else if (key === "target") safe.target = cleanText(value, 100);
    else if (key === "expect") safe.expect = cleanText(value, 140);
    else if (key === "parameter") {
      const parameter = cleanText(value, 60);
      if (/^<[A-Z0-9_-]+>$/u.test(parameter)) safe.parameter = parameter;
    }
  }
  return safe.action ? safe : null;
}

function normalizeRecipe(recipe = {}) {
  const steps = (Array.isArray(recipe.steps) ? recipe.steps : [])
    .map(normalizeStep)
    .filter(Boolean)
    .slice(0, 6);
  return {
    title: cleanText(recipe.title, 100),
    prechecks: stringList(recipe.prechecks, 3, 140),
    steps,
    success_checks: stringList(recipe.success_checks ?? recipe.successChecks, 3, 140),
    rollback: stringList(recipe.rollback, 2, 140),
  };
}

function emptyData() {
  return { schema: SCHEMA, updated_at: null, recipes: [] };
}

function validData(value) {
  return value && value.schema === SCHEMA && Array.isArray(value.recipes)
    ? value
    : emptyData();
}

async function loadData(filePath) {
  try {
    return validData(JSON.parse(await readFile(filePath, "utf8")));
  } catch (error) {
    if (error?.code === "ENOENT") return emptyData();
    throw error;
  }
}

async function atomicWrite(filePath, data) {
  await mkdir(dirname(filePath), { recursive: true });
  const temporary = `${filePath}.${randomUUID()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(data, null, 2)}\n`, "utf8");
  try {
    await rename(temporary, filePath);
  } catch (error) {
    if (error?.code !== "EEXIST" && error?.code !== "EPERM") throw error;
    await unlink(filePath).catch((unlinkError) => {
      if (unlinkError?.code !== "ENOENT") throw unlinkError;
    });
    await rename(temporary, filePath);
  } finally {
    await unlink(temporary).catch(() => {});
  }
}

async function withLock(filePath, action, options = {}) {
  const lockPath = `${filePath}.lock`;
  const timeoutMs = Math.max(250, options.lockTimeoutMs ?? 2500);
  const staleMs = Math.max(timeoutMs, options.staleLockMs ?? 30_000);
  const started = Date.now();
  await mkdir(dirname(filePath), { recursive: true });
  let handle;
  while (!handle) {
    try {
      handle = await open(lockPath, "wx");
      await handle.writeFile(`${Date.now()} ${randomUUID()}\n`, "utf8");
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
      const age = Date.now() - (await stat(lockPath).catch(() => ({ mtimeMs: Date.now() }))).mtimeMs;
      if (age > staleMs) await unlink(lockPath).catch(() => {});
      if (Date.now() - started >= timeoutMs) throw new Error("Verified playbook cache lock timed out");
      await new Promise((resolveWait) => setTimeout(resolveWait, 25));
    }
  }
  try {
    return await action();
  } finally {
    await handle.close().catch(() => {});
    await unlink(lockPath).catch(() => {});
  }
}

function stableHash(value) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex").slice(0, 16);
}

function scoreRecipe(entry, context) {
  if (!context.problem_class || entry.context.problem_class !== context.problem_class) return Number.NEGATIVE_INFINITY;
  let score = 8;
  const compare = (key, exact, mismatch) => {
    if (!context[key] || !entry.context[key]) return 0;
    return context[key] === entry.context[key] ? exact : mismatch;
  };
  score += compare("app", 4, -3);
  score += compare("os_family", 2, -1);
  score += compare("os_version", 1, -0.5);
  score += compare("app_version", 1.5, -1.5);
  score += compare("remote_client", 0.5, 0);
  score += compare("surface", 0.5, 0);
  const symptomScore = symptomSimilarity(entry.context.symptom, context.symptom);
  if (symptomScore != null) score += symptomScore >= 0.12 ? Math.min(3, symptomScore * 4) : -1.5;
  score += entry.status === "trusted" ? 1 : 0;
  score += Math.min(2, entry.successes * 0.4);
  score -= Math.min(3, entry.failures * 0.75);
  score += (confidence(entry) - 0.5) * 2;
  return Math.round(score * 10) / 10;
}

function publicEntry(entry, score) {
  return {
    id: entry.id,
    status: entry.status,
    score,
    successes: entry.successes,
    failures: entry.failures,
    confidence: confidence(entry),
    title: entry.recipe.title,
    prechecks: entry.recipe.prechecks,
    steps: entry.recipe.steps.slice(0, 3),
    success_checks: entry.recipe.success_checks,
    rollback: entry.recipe.rollback,
  };
}

function compactMatch(result, maxChars = DEFAULT_MATCH_CHARS) {
  const compact = JSON.parse(JSON.stringify(result));
  const limit = Math.max(300, maxChars);
  while (JSON.stringify(compact).length > limit && compact.recipes?.length > 1) compact.recipes.pop();
  for (const recipe of compact.recipes ?? []) {
    while (JSON.stringify(compact).length > limit && recipe.steps.length > 1) recipe.steps.pop();
    while (JSON.stringify(compact).length > limit && recipe.prechecks.length > 1) recipe.prechecks.pop();
    while (JSON.stringify(compact).length > limit && recipe.rollback.length) recipe.rollback.pop();
  }
  return compact;
}

export function defaultVerifiedPlaybookCachePath(modulePath = fileURLToPath(import.meta.url)) {
  const realModule = realpathSync(modulePath);
  const skillRoot = resolve(dirname(realModule), "..", "..", "..");
  const skillsRoot = dirname(skillRoot);
  const sourceRoot = dirname(skillsRoot);
  if (basename(sourceRoot).toLowerCase() === "source") {
    return join(dirname(sourceRoot), "state", "verified-playbooks.json");
  }
  return join(sourceRoot, "state", "computer-use-studio-pro", "verified-playbooks.json");
}

export async function openVerifiedPlaybookCache(options = {}) {
  const filePath = resolve(options.filePath ?? defaultVerifiedPlaybookCachePath());
  const match = async (rawContext, matchOptions = {}) => {
    const context = normalizeContext(rawContext);
    if (!context.problem_class) return { matched: false, reason: "missing-problem-class", recipes: [] };
    const data = await loadData(filePath);
    const recipes = data.recipes
      .filter((entry) => entry.status !== "retired")
      .map((entry) => ({ entry, score: scoreRecipe(entry, context), symptom_similarity: symptomSimilarity(entry.context.symptom, context.symptom) }))
      .filter(({ entry, score, symptom_similarity }) => Number.isFinite(score)
        && score >= (matchOptions.minScore ?? 7)
        && confidence(entry) >= (matchOptions.minConfidence ?? 0.45)
        && (symptom_similarity == null || symptom_similarity >= (matchOptions.minSymptomSimilarity ?? 0.05)))
      .sort((left, right) => right.score - left.score || right.entry.successes - left.entry.successes)
      .slice(0, Math.max(1, Math.min(2, matchOptions.limit ?? 2)))
      .map(({ entry, score }) => publicEntry(entry, score));
    return compactMatch({ matched: recipes.length > 0, recipes }, matchOptions.maxChars ?? DEFAULT_MATCH_CHARS);
  };

  const recordVerifiedSuccess = async ({ context: rawContext, recipe: rawRecipe, evidence = {} }) => {
    if (evidence.success_verified !== true) throw new Error("Playbook promotion requires success_verified=true");
    const context = normalizeContext(rawContext);
    const recipe = normalizeRecipe(rawRecipe);
    if (!context.problem_class || recipe.steps.length === 0 || recipe.success_checks.length === 0) {
      throw new Error("A verified playbook requires problem_class, steps, and success_checks");
    }
    const signatureContext = { ...context, symptom: "" };
    const signature = stableHash({ context: signatureContext, recipe });
    return withLock(filePath, async () => {
      const data = await loadData(filePath);
      const now = new Date().toISOString();
      let entry = data.recipes.find((item) => item.signature === signature);
      if (!entry) {
        entry = {
          id: `pb-${signature}`,
          signature,
          status: "candidate",
          context,
          recipe,
          successes: 0,
          failures: 0,
          created_at: now,
          last_success_at: null,
          last_failure_at: null,
        };
        data.recipes.push(entry);
      }
      entry.successes += 1;
      entry.status = entry.successes >= 2 && entry.failures === 0 ? "trusted" : "candidate";
      entry.last_success_at = now;
      data.updated_at = now;
      data.recipes = data.recipes
        .sort((left, right) => (right.last_success_at ?? "").localeCompare(left.last_success_at ?? ""))
        .slice(0, options.maxRecipes ?? MAX_RECIPES);
      await atomicWrite(filePath, data);
      return { recorded: true, id: entry.id, status: entry.status, successes: entry.successes, file: filePath };
    }, options);
  };

  const recordFailure = async ({ id, reason = "postcondition-missed" }) => withLock(filePath, async () => {
    const data = await loadData(filePath);
    const entry = data.recipes.find((item) => item.id === id);
    if (!entry) return { recorded: false, reason: "unknown-playbook" };
    entry.failures += 1;
    entry.last_failure_at = new Date().toISOString();
    entry.last_failure_reason = cleanText(reason, 120);
    if (entry.failures >= 2 && entry.failures >= entry.successes) entry.status = "retired";
    data.updated_at = entry.last_failure_at;
    await atomicWrite(filePath, data);
    return { recorded: true, id: entry.id, status: entry.status, failures: entry.failures };
  }, options);

  const stats = async () => {
    const data = await loadData(filePath);
    return {
      file: filePath,
      recipes: data.recipes.length,
      candidate: data.recipes.filter((item) => item.status === "candidate").length,
      trusted: data.recipes.filter((item) => item.status === "trusted").length,
      retired: data.recipes.filter((item) => item.status === "retired").length,
    };
  };

  const list = async (listOptions = {}) => {
    const data = await loadData(filePath);
    return data.recipes
      .filter((entry) => listOptions.status == null || entry.status === listOptions.status)
      .sort((left, right) => (right.last_success_at ?? "").localeCompare(left.last_success_at ?? ""))
      .slice(0, Math.max(1, Math.min(128, listOptions.limit ?? 50)))
      .map((entry) => publicEntry(entry, scoreRecipe(entry, entry.context)));
  };

  const remove = async (id) => withLock(filePath, async () => {
    const data = await loadData(filePath);
    const before = data.recipes.length;
    data.recipes = data.recipes.filter((entry) => entry.id !== id);
    if (data.recipes.length === before) return { removed: false, reason: "unknown-playbook" };
    data.updated_at = new Date().toISOString();
    await atomicWrite(filePath, data);
    return { removed: true, id };
  }, options);

  const clearRetired = async () => withLock(filePath, async () => {
    const data = await loadData(filePath);
    const before = data.recipes.length;
    data.recipes = data.recipes.filter((entry) => entry.status !== "retired");
    data.updated_at = new Date().toISOString();
    await atomicWrite(filePath, data);
    return { removed: before - data.recipes.length, remaining: data.recipes.length };
  }, options);

  return { filePath, match, recordVerifiedSuccess, recordFailure, stats, list, remove, clearRetired };
}

export async function selfTest() {
  const root = await mkdtemp(join(tmpdir(), "cuspro-playbooks-"));
  const filePath = join(root, "verified-playbooks.json");
  try {
    const cache = await openVerifiedPlaybookCache({ filePath, lockTimeoutMs: 1000 });
    const context = {
      problem_class: "plugin-install",
      os_family: "windows",
      app: "Codex",
      app_version: "2.7.9",
      remote_client: "Sunlogin",
      symptom: "plugin download returned an immediate error",
      device_id: "123456789",
    };
    const recipe = {
      title: "Plugin download repair token=secret-value Bearer abcdefgh12345678",
      prechecks: ["Read exact error", "Check marketplace visibility"],
      steps: [
        { action: "inspect", target: "plugin status", expect: "error classified", element_index: 42 },
        { action: "retry", target: "plugin download", expect: "installed" },
      ],
      success_checks: ["Installed entry visible", "key eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.signature123456 AKIAIOSFODNN7EXAMPLE"],
      rollback: ["Restore original proxy mode"],
    };
    const empty = await cache.match(context);
    if (empty.matched) throw new Error("empty playbook cache matched unexpectedly");
    const first = await cache.recordVerifiedSuccess({ context, recipe, evidence: { success_verified: true } });
    if (first.status !== "candidate") throw new Error("first verified success was not a candidate");
    const matched = await cache.match(context, { maxChars: 900 });
    if (!matched.matched || matched.recipes.length !== 1 || JSON.stringify(matched).length > 900) {
      throw new Error("verified playbook match failed");
    }
    const raw = await readFile(filePath, "utf8");
    if (raw.includes("secret-value") || raw.includes("123456789") || raw.includes("element_index")
        || raw.includes("abcdefgh12345678") || raw.includes("eyJhbGciOiJIUzI1NiJ9")
        || raw.includes("AKIAIOSFODNN7EXAMPLE")) {
      throw new Error("playbook cache retained secret/device/stale UI references");
    }
    const second = await cache.recordVerifiedSuccess({ context: { ...context, symptom: "plugin download timed out" }, recipe, evidence: { success_verified: true } });
    if (second.status !== "trusted" || second.successes !== 2) throw new Error("verified playbook was not promoted");
    const failed = await cache.recordFailure({ id: second.id });
    if (!failed.recorded || failed.failures !== 1) throw new Error("playbook failure was not recorded");
    const reopened = await openVerifiedPlaybookCache({ filePath });
    const stats = await reopened.stats();
    if (stats.recipes !== 1) throw new Error("playbook cache persistence failed");
    const mismatch = await reopened.match({ ...context, symptom: "audio device produced no sound" }, { minScore: 9 });
    if (mismatch.matched) throw new Error("dissimilar symptom matched too strongly");
    const listed = await reopened.list();
    if (listed.length !== 1 || listed[0].confidence == null) throw new Error("playbook cache management listing failed");
    const removed = await reopened.remove(second.id);
    if (!removed.removed || (await reopened.stats()).recipes !== 0) throw new Error("playbook cache remove failed");
    return "self-test: ok";
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

function isCliEntryPoint() {
  if (typeof process === "undefined" || !process.argv?.[1]) return false;
  try {
    return realpathSync(fileURLToPath(import.meta.url)) === realpathSync(process.argv[1]);
  } catch {
    return false;
  }
}

if (isCliEntryPoint()) {
  if (process.argv.includes("--self-test")) {
    selfTest().then((message) => console.log(message)).catch((error) => {
      console.error("FAIL:", error.message);
      process.exit(1);
    });
  } else {
    console.log("Usage: node playbook_cache.mjs --self-test");
  }
}
