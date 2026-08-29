/** Low-latency helpers over the approved @oai/sky Computer Use object. */

import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { realpathSync } from "node:fs";

const ACTIONS = new Set([
  "click",
  "press_key",
  "type_text",
  "scroll",
  "set_value",
  "drag",
  "perform_secondary_action",
]);

const TRANSACTION_RISKS = new Set(["low", "reversible"]);
const KEYBOARD_BURST_METHODS = new Set(["press_key", "type_text"]);
const KEYBOARD_BURST_KEYS = new Set([
  "control_l+a", "control+a", "ctrl+a",
  "backspace", "delete",
]);
const MAX_KEYBOARD_BURST_TEXT_CHARS = 4096;
const EDITABLE_FOCUS = /(?:\b(?:edit|textbox|text[ -]?field|textarea|text[ -]?area|search(?:box|[ -]?field)?|input|combo[ -]?box|axtextfield|axtextarea|axsearchfield)\b|编辑|文本框|文本区域|搜索框|输入框|组合框)/iu;

const ASSIGNMENT_SECRET = /(?:\b(password|passwd|secret|token|cookie|authorization|api[_-]?key|otp|one[- ]?time code)\b|(密码|口令|令牌|密钥|验证码))\s*[:=：]\s*(?:"[^"]*"|'[^']*'|[^\s,;，；]+)/gi;
const BEARER_SECRET = /\bbearer\s+[A-Za-z0-9._~+/=-]{8,}\b/gi;
const PREFIX_SECRET = /\b(?:sk|ghp|github_pat|xox[baprs])[-_][A-Za-z0-9_-]{8,}\b/gi;
const JWT_SECRET = /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g;
const AWS_ACCESS_KEY = /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g;
const EMAIL = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const PHONE = /(?<!\d)(?:\+?\d[\d -]{7,}\d)(?!\d)/g;

function redactText(value) {
  return String(value ?? "")
    .replace(ASSIGNMENT_SECRET, (_, english, chinese) => `${english ?? chinese}=[REDACTED]`)
    .replace(BEARER_SECRET, "Bearer [REDACTED]")
    .replace(PREFIX_SECRET, "[REDACTED]")
    .replace(JWT_SECRET, "[REDACTED_JWT]")
    .replace(AWS_ACCESS_KEY, "[REDACTED_AWS_KEY]")
    .replace(EMAIL, "[REDACTED_EMAIL]")
    .replace(PHONE, "[REDACTED_PHONE]");
}

function capped(value, limit) {
  const text = String(value ?? "");
  return text.length <= limit ? text : `${text.slice(0, Math.max(0, limit - 1))}…`;
}

function topScreenshot(state) {
  return [...(state?.screenshots ?? [])].sort((a, b) => (a?.zIndex ?? 0) - (b?.zIndex ?? 0)).at(-1);
}

function selectedTreeLines(tree, needles, limit, maxLines = 20) {
  const lines = String(tree ?? "").split(/\r?\n/).filter(Boolean);
  const wanted = (needles ?? []).map(String).filter(Boolean);
  const selected = wanted.length
    ? lines.filter((line) => wanted.some((needle) => line.includes(needle)))
    : lines.slice(0, maxLines);
  return capped(selected.map(redactText).join("\n"), limit);
}

function compactText(value, limit) {
  return capped(redactText(value), limit);
}

export function compactState(state, options = {}) {
  if (typeof options === "number") options = { maxChars: options };
  const maxChars = Math.max(240, options.maxChars ?? 900);
  const titleChars = options.titleChars ?? Math.min(160, Math.max(80, Math.floor(maxChars * 0.16)));
  const focusChars = options.focusChars ?? Math.min(180, Math.max(80, Math.floor(maxChars * 0.18)));
  const selectedChars = options.selectedChars ?? Math.min(160, Math.max(60, Math.floor(maxChars * 0.14)));
  const documentChars = options.documentChars ?? Math.max(100, Math.floor(maxChars * 0.36));
  const treeChars = options.treeChars ?? Math.max(120, Math.floor(maxChars * 0.46));
  const screenshotLimit = Math.max(0, Math.min(2, options.screenshotLimit ?? 1));
  const accessibility = state?.accessibility ?? {};
  const orderedScreenshots = [...(state?.screenshots ?? [])]
    .sort((a, b) => (a?.zIndex ?? 0) - (b?.zIndex ?? 0));
  const screenshots = (screenshotLimit === 0 ? [] : orderedScreenshots.slice(-screenshotLimit))
    .map((item) => ({
      id: item?.id,
      z: item?.zIndex,
      width: item?.width,
      height: item?.height,
      originX: item?.originX,
      originY: item?.originY,
    }));
  return {
    window: state?.window
      ? { id: state.window.id, app: state.window.app, title: compactText(state.window.title, titleChars) }
      : null,
    focused_element: compactText(accessibility.focused_element, focusChars),
    selected_text: compactText(accessibility.selected_text, selectedChars),
    document_text: compactText(accessibility.document_text, documentChars),
    tree: selectedTreeLines(accessibility.tree, options.needles, treeChars, options.maxTreeLines ?? 20),
    screenshots,
  };
}

function definedEntries(value) {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined && item !== null));
}

const GENERIC_ARTIFACT_NAMES = /^(?:新建(?:的)?\s*(?:(?:docx|word)\s*)?(?:文档|文件)?|未命名(?:文档|文件)?|untitled|document\s*\d*|new\s+document|test)$/iu;
const WINDOWS_RESERVED_NAMES = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])$/iu;

/** Derive a stable user-facing filename before opening Save As. */
export function deriveArtifactFileName(input, options = {}) {
  const source = typeof input === "string" ? { task: input } : (input ?? {});
  const candidates = [source.title, source.documentTitle, source.goal, source.task]
    .map((value) => String(value ?? "").trim())
    .filter(Boolean);
  let base = candidates.find((value) => !GENERIC_ARTIFACT_NAMES.test(value.replace(/\.[^.]+$/u, "").trim()))
    ?? String(options.fallback ?? "任务结果");
  base = base
    .split(/\r?\n/u)[0]
    .replace(/^\s*(?:#+\s*|任务\s*[:：]\s*)/u, "")
    .replace(/\.[A-Za-z0-9]{1,10}$/u, "")
    .replace(/[<>:"/\\|?*\u0000-\u001F]/gu, " ")
    .replace(/\s+/gu, " ")
    .replace(/[. ]+$/gu, "")
    .trim();
  if (!base || GENERIC_ARTIFACT_NAMES.test(base)) base = String(options.fallback ?? "任务结果");
  const maxBaseChars = Math.max(8, options.maxBaseChars ?? 48);
  base = [...base].slice(0, maxBaseChars).join("").replace(/[. ]+$/gu, "");
  if (WINDOWS_RESERVED_NAMES.test(base)) base = `_${base}`;
  let extension = String(options.extension ?? source.extension ?? "").trim();
  if (extension && !extension.startsWith(".")) extension = `.${extension}`;
  extension = extension.replace(/[^.A-Za-z0-9]/gu, "").slice(0, 12);
  return `${base}${extension}`;
}

function normalizedHostUsage(hostUsage) {
  const usage = hostUsage?.usage ?? hostUsage;
  if (!usage || typeof usage !== "object") return null;
  const pick = (...names) => {
    for (const name of names) {
      const value = Number(usage[name]);
      if (Number.isFinite(value) && value >= 0) return Math.round(value);
    }
    return undefined;
  };
  const inputTokens = pick("input_tokens", "prompt_tokens");
  const outputTokens = pick("output_tokens", "completion_tokens");
  const cachedInputTokens = pick("cached_input_tokens", "cached_tokens");
  const explicitTotal = pick("total_tokens");
  const totalTokens = explicitTotal ?? (
    inputTokens !== undefined || outputTokens !== undefined
      ? (inputTokens ?? 0) + (outputTokens ?? 0)
      : undefined
  );
  if (totalTokens === undefined) return null;
  return definedEntries({ input_tokens: inputTokens, output_tokens: outputTokens, cached_input_tokens: cachedInputTokens, total_tokens: totalTokens });
}

/** Aggregate already-emitted compact views without adding a tool/model roundtrip. */
export function createTaskUsageMeter(options = {}) {
  const charsPerToken = Math.max(1, Number(options.charsPerToken ?? 3));
  const counters = { views: 0, compact_chars: 0, tool_calls: 0, screenshots: 0, actions: 0 };
  return {
    view(result, viewOptions = {}) {
      const view = tokenView(result, viewOptions);
      counters.views += 1;
      counters.compact_chars += JSON.stringify(view).length;
      counters.tool_calls += Number(view?.metrics?.sky_calls ?? 0);
      counters.actions += Number(view?.metrics?.actions ?? 0);
      counters.screenshots += Array.isArray(view?.summary?.screenshots) ? view.summary.screenshots.length : 0;
      return view;
    },
    report(hostUsage = null) {
      const exact = normalizedHostUsage(hostUsage);
      if (exact) return { source: "host-exact", ...exact, ...counters };
      return {
        source: "estimated-compact-view",
        estimated_compact_view_tokens: Math.ceil(counters.compact_chars / charsPerToken),
        estimate_basis: `${counters.compact_chars} serialized compact characters / ${charsPerToken}`,
        ...counters,
      };
    },
    reset() {
      Object.assign(counters, { views: 0, compact_chars: 0, tool_calls: 0, screenshots: 0, actions: 0 });
    },
  };
}

/**
 * Return a small, redacted result envelope while the caller retains raw state
 * in the persistent kernel. Make this the final node_repl expression to avoid
 * emitting the full observation/result object to the model.
 */
export function tokenView(result, options = {}) {
  if (result == null) return { ok: false, outcome: "empty" };
  const state = result?.state ?? (
    result?.window && (result?.accessibility || result?.screenshots) ? result : null
  );
  const summary = state
    ? compactState(state, options)
    : (result?.summary ?? null);
  const metrics = result?.metrics ? definedEntries({
    actions: result.metrics.actions,
    observations: result.metrics.observations,
    sky_calls: result.metrics.sky_calls,
    duration_ms: result.metrics.duration_ms,
    compact_chars: result.metrics.compact_chars,
    screenshot_regions: result.metrics.screenshot_regions,
    saved_observations: result.metrics.saved_observations,
  }) : null;
  const changes = result?.changes == null
    ? null
    : compactText(typeof result.changes === "string" ? result.changes : JSON.stringify(result.changes), options.changeChars ?? 360);
  return definedEntries({
    ok: result?.ok,
    outcome: result?.outcome,
    session_status: result?.session_status,
    authorization_status: result?.authorization_status,
    control_owner: result?.control_owner,
    operation_scope: result?.operation_scope,
    success_verified: result?.success_verified,
    completed: result?.completed,
    failed_step: result?.failed_step,
    attempts: result?.attempts,
    pivot_required: result?.pivot_required,
    reused: result?.reused,
    promoted_screenshot: result?.promoted_screenshot,
    input_lease: result?.input_lease,
    reason: result?.reason ? compactText(result.reason, options.reasonChars ?? 240) : null,
    changes,
    summary,
    metrics,
  });
}

function stateText(state) {
  const accessibility = state?.accessibility ?? {};
  return [
    state?.window?.title,
    accessibility.focused_element,
    accessibility.selected_text,
    accessibility.document_text,
    accessibility.tree,
  ].filter(Boolean).join("\n");
}

function normalizeDeviceId(value) {
  return String(value ?? "").replace(/[^A-Za-z0-9]/g, "").toLowerCase();
}

function deviceIdHash(value) {
  const normalized = normalizeDeviceId(value);
  return normalized ? createHash("sha256").update(normalized).digest("hex").slice(0, 12) : null;
}

function stateContainsDeviceId(state, expectedDeviceId) {
  const normalized = normalizeDeviceId(expectedDeviceId);
  if (!normalized) return false;
  const flexible = [...normalized]
    .map((character) => character.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join("[^A-Za-z0-9]*");
  return new RegExp(`(?:^|[^A-Za-z0-9])${flexible}(?=$|[^A-Za-z0-9])`, "i").test(stateText(state));
}

function defaultObservedDeviceIds(state) {
  const pattern = /(?:device(?:\s*id)?|remote\s*id|设备(?:\s*(?:id|编号))?|识别码|伙伴识别码)\s*[:：#]?\s*([0-9](?:[0-9 -]{3,20}[0-9]))/giu;
  return [...stateText(state).matchAll(pattern)]
    .map((match) => normalizeDeviceId(match[1]))
    .filter(Boolean);
}

const REMOTE_CLIENT_PROFILES = Object.freeze({
  todesk: Object.freeze({
    aliases: ["todesk", "to-desk"],
    devicePattern: /(?:todesk\s*(?:id|设备码)|设备(?:代码|id|编号)|远程(?:设备)?id)\s*[:：#]?\s*([0-9](?:[0-9 -]{3,20}[0-9]))/giu,
    reconnecting: /(?:正在重连|正在重新连接|重连中|reconnect(?:ing)?|restoring\s+(?:the\s+)?connection)/iu,
    disconnected: /(?:连接(?:已)?断开|远程(?:连接|会话)(?:已)?(?:断开|结束)|对方设备(?:已)?离线|连接失败|device\s+offline|session\s+ended|disconnected|connection\s+(?:lost|closed|failed))/iu,
    stopped: /(?:对方(?:已)?(?:停止|终止)远程控制|远程控制(?:已)?(?:停止|终止|结束)|客户(?:已)?急停|remote\s+control\s+(?:was\s+)?stopped|session\s+terminated\s+by\s+(?:the\s+)?remote)/iu,
  }),
  sunlogin: Object.freeze({
    aliases: ["sunlogin", "sunflower", "向日葵"],
    devicePattern: /(?:向日葵\s*(?:识别码|设备码)|本机识别码|伙伴识别码|设备(?:代码|id|编号)|远程(?:设备)?id|sunlogin\s*id)\s*[:：#]?\s*([0-9](?:[0-9 -]{3,20}[0-9]))/giu,
    reconnecting: /(?:正在重连|正在重新连接|重连中|reconnect(?:ing)?|restoring\s+(?:the\s+)?connection)/iu,
    disconnected: /(?:主机(?:已)?离线|被控端(?:已)?离线|远程(?:连接|控制)(?:已)?(?:断开|结束)|连接(?:已)?断开|连接失败|host\s+offline|session\s+ended|disconnected|connection\s+(?:lost|closed|failed))/iu,
    stopped: /(?:对方(?:已)?(?:停止|终止)控制|远程控制(?:已)?(?:停止|终止|结束)|客户(?:已)?急停|remote\s+control\s+(?:was\s+)?stopped|session\s+terminated\s+by\s+(?:the\s+)?remote)/iu,
  }),
});

function resolveRemoteClientProfile(client) {
  const normalized = String(client ?? "").trim().toLowerCase();
  for (const [name, profile] of Object.entries(REMOTE_CLIENT_PROFILES)) {
    if (name === normalized || profile.aliases.some((alias) => alias.toLowerCase() === normalized)) {
      return { name, profile };
    }
  }
  throw new Error(`Unsupported remote client profile: ${client}`);
}

function profileObservedDeviceIds(profile, state) {
  const pattern = new RegExp(profile.devicePattern.source, profile.devicePattern.flags);
  return [...stateText(state).matchAll(pattern)]
    .map((match) => normalizeDeviceId(match[1]))
    .filter(Boolean);
}

/**
 * Build synchronous ToDesk/Sunlogin signals that can be passed directly to a
 * persistent remote session. Parsing stays inside the runtime, so unchanged
 * connection/device observations do not need a model decision.
 */
export function createRemoteClientSignalAdapter(client, options = {}) {
  const { name, profile } = resolveRemoteClientProfile(client);
  const remoteDeviceId = String(options.remoteDeviceId ?? "").trim();
  const expected = normalizeDeviceId(remoteDeviceId);
  if (!expected) throw new Error("createRemoteClientSignalAdapter requires remoteDeviceId");
  let bound = false;
  let baselineIds = new Set();
  let lastSnapshot = null;

  function inspectInternal(state) {
    validateObservation(state);
    const text = stateText(state);
    const observedIds = [...new Set([
      ...defaultObservedDeviceIds(state),
      ...profileObservedDeviceIds(profile, state),
    ])];
    const stopped = profile.stopped.test(text);
    const reconnecting = !stopped && profile.reconnecting.test(text);
    const disconnected = !stopped && !reconnecting && profile.disconnected.test(text);
    const connection = stopped ? "stopped" : reconnecting ? "reconnecting" : disconnected ? "disconnected" : "connected";
    const expectedVisible = observedIds.includes(expected) || stateContainsDeviceId(state, remoteDeviceId);
    const conflictingIds = bound
      ? observedIds.filter((observed) => !baselineIds.has(observed))
      : [];
    lastSnapshot = {
      client: name,
      connection,
      stopped,
      expected_device_visible: expectedVisible,
      conflicting_device: conflictingIds.length > 0,
      observed_device_hashes: observedIds.map(deviceIdHash),
      expected_device_sha256_12: deviceIdHash(remoteDeviceId),
    };
    return { ...lastSnapshot, observedIds, conflictingIds };
  }

  function connectionVerifier(state) {
    return inspectInternal(state).connection === "connected";
  }

  function stopSignalVerifier(state) {
    return inspectInternal(state).stopped;
  }

  function deviceVerifier(state, expectedDeviceId, _fingerprint, context = {}) {
    if (normalizeDeviceId(expectedDeviceId) !== expected) return false;
    const signals = inspectInternal(state);
    if (!bound || context.require_evidence === true) {
      if (!signals.expected_device_visible) return false;
      baselineIds = new Set([...signals.observedIds, expected]);
      bound = true;
      return true;
    }
    return signals.conflictingIds.length === 0;
  }

  function snapshot() {
    return lastSnapshot ? { ...lastSnapshot } : {
      client: name,
      connection: "unobserved",
      stopped: false,
      expected_device_visible: false,
      conflicting_device: false,
      observed_device_hashes: [],
      expected_device_sha256_12: deviceIdHash(remoteDeviceId),
    };
  }

  function inspect(state) {
    inspectInternal(state);
    return snapshot();
  }

  return Object.freeze({
    client: name,
    connectionVerifier,
    deviceVerifier,
    stopSignalVerifier,
    inspect,
    snapshot,
  });
}

function defaultConnectionVerifier(state) {
  const text = stateText(state);
  return !/(?:remote\s+(?:device|session).*(?:disconnected|offline|ended)|connection\s+(?:lost|closed)|remote\s+reconnecting|远程(?:连接|会话).*(?:已断开|已结束)|设备已离线|正在重新连接远程设备)/i.test(text);
}

function defaultDisconnectErrorMatcher(error) {
  return /(?:disconnect|connection\s+(?:lost|closed)|session\s+ended|invalid\s+window|window\s+not\s+found|closed\s+window|已断开|连接(?:已)?断开|会话结束|窗口.*失效)/i.test(String(error?.message ?? error));
}

function expectationResult(state, expect) {
  if (typeof expect === "function") {
    return expect(state) ? { ok: true } : { ok: false, reason: "custom expectation failed" };
  }
  if (!expect) return state?.window ? { ok: true } : { ok: false, reason: "window binding was lost" };
  const text = stateText(state);
  const includes = Array.isArray(expect.includes) ? expect.includes : expect.includes ? [expect.includes] : [];
  const excludes = Array.isArray(expect.excludes) ? expect.excludes : expect.excludes ? [expect.excludes] : [];
  for (const value of includes) if (!text.includes(String(value))) return { ok: false, reason: "expected text is missing" };
  for (const value of excludes) if (text.includes(String(value))) return { ok: false, reason: "forbidden text remains" };
  if (expect.focusedIncludes && !String(state?.accessibility?.focused_element ?? "").includes(expect.focusedIncludes)) {
    return { ok: false, reason: "focused element does not match the expected cue" };
  }
  if (expect.titleIncludes && !String(state?.window?.title ?? "").includes(expect.titleIncludes)) {
    return { ok: false, reason: "window title does not match the expected cue" };
  }
  if (expect.minScreenshots != null && (state?.screenshots?.length ?? 0) < expect.minScreenshots) {
    return { ok: false, reason: `expected at least ${expect.minScreenshots} screenshot regions` };
  }
  return { ok: true };
}

function observationChars(state) {
  const accessibility = state?.accessibility ?? {};
  return [
    accessibility.focused_element,
    accessibility.selected_text,
    accessibility.document_text,
    accessibility.tree,
  ].reduce((total, value) => total + String(value ?? "").length, 0);
}

function readinessSignature(state, options = {}) {
  if (typeof options.signature === "function") return String(options.signature(state));
  const accessibility = state?.accessibility ?? {};
  return JSON.stringify({
    title: compactText(state?.window?.title, 200),
    focus: compactText(accessibility.focused_element, 240),
    document: compactText(accessibility.document_text, options.signatureChars ?? 1000),
    tree: options.signatureTree === false
      ? ""
      : selectedTreeLines(accessibility.tree, options.signatureNeedles ?? options.needles, options.signatureTreeChars ?? 1200),
  });
}

function mergeMetrics(target, extra) {
  for (const [key, value] of Object.entries(extra ?? {})) {
    if (typeof value === "number") target[key] = (target[key] ?? 0) + value;
  }
  return target;
}

function validateObservation(observation) {
  if (!observation?.window) throw new Error("Missing current window observation");
}

function usesCoordinates(action) {
  const args = action?.args ?? {};
  return action?.method === "drag" || action?.method === "scroll" || (action?.method === "click" && "x" in args);
}

function validateAction(observation, action) {
  if (!ACTIONS.has(action?.method)) throw new Error(`Unsupported action: ${action?.method}`);
  const args = action.args ?? {};
  if (usesCoordinates(action)) {
    const screenshots = observation?.screenshots ?? [];
    const currentScreenshot = topScreenshot(observation);
    if (!currentScreenshot?.id && !args.screenshotId) {
      throw new Error("Coordinate action requires a screenshot id from the current observation");
    }
    if (args.screenshotId && !screenshots.some((item) => item?.id === args.screenshotId)) {
      throw new Error("Coordinate action referenced a stale or foreign screenshot id");
    }
  }
  if (["click", "set_value", "perform_secondary_action"].includes(action.method) && "element_index" in args) {
    if (observation.accessibility == null) throw new Error("Element action requires current accessibility data");
  }
  if (action.method === "type_text" && !String(observation.accessibility?.focused_element ?? "").trim()) {
    throw new Error("Text input requires a verified focused element");
  }
}

function actionArgs(observation, action) {
  const args = { ...(action.args ?? {}), window: observation.window };
  if (usesCoordinates(action) && !args.screenshotId) args.screenshotId = topScreenshot(observation).id;
  return args;
}

function nextNeedsScreenshot(step) {
  return usesCoordinates(step ?? {});
}

function normalizedKey(value) {
  return String(value ?? "").replace(/\s+/g, "").toLowerCase();
}

function validateKeyboardBurst(observation, steps, options) {
  validateObservation(observation);
  if (options.transactionClass !== "local-reversible") {
    throw new Error("Keyboard bursts require transactionClass: 'local-reversible'");
  }
  if (!TRANSACTION_RISKS.has(options.risk ?? "reversible")) {
    throw new Error("Keyboard bursts are limited to low-risk or reversible work");
  }
  if (options.stabilityConfirmed !== true) {
    throw new Error("Keyboard bursts require stabilityConfirmed: true for the current focused field");
  }
  if (options.confirmationBoundary !== false) {
    throw new Error("Keyboard bursts require confirmationBoundary: false after scope review");
  }
  if (!Array.isArray(steps) || steps.length < 2 || steps.length > 3) {
    throw new Error("Keyboard bursts require 2-3 actions");
  }
  const focusedElement = String(observation.accessibility?.focused_element ?? "").trim();
  const hasSemanticFocus = EDITABLE_FOCUS.test(focusedElement);
  const hasVisualFocusProof = options.focusVerified === true && Boolean(topScreenshot(observation)?.id);
  if (!hasSemanticFocus && !hasVisualFocusProof) {
    throw new Error("Keyboard bursts require a current semantic focus or focusVerified: true with a current screenshot");
  }
  for (let index = 0; index < steps.length; index += 1) {
    const step = steps[index];
    if (!KEYBOARD_BURST_METHODS.has(step?.method)) {
      throw new Error(`Keyboard burst step ${index} must use press_key or type_text`);
    }
    if (step.method === "press_key" && !KEYBOARD_BURST_KEYS.has(normalizedKey(step.args?.key))) {
      throw new Error(`Keyboard burst step ${index} uses an unsupported key sequence`);
    }
    if (step.method === "type_text") {
      const text = step.args?.text;
      if (typeof text !== "string" || text.length === 0) {
        throw new Error(`Keyboard burst step ${index} requires a non-empty literal text payload`);
      }
      if (text.length > MAX_KEYBOARD_BURST_TEXT_CHARS) {
        throw new Error(`Keyboard burst step ${index} exceeds the ${MAX_KEYBOARD_BURST_TEXT_CHARS}-character limit`);
      }
      if (/[\u0000-\u001f\u007f]/u.test(text)) {
        throw new Error(`Keyboard burst step ${index} contains a control character; use the verified per-action path`);
      }
      if (!hasSemanticFocus && !hasVisualFocusProof) {
        throw new Error(`Keyboard burst step ${index} lacks verified focus`);
      }
    }
  }
  const selectsAll = steps.some((step) => step.method === "press_key" && ["control_l+a", "control+a", "ctrl+a"].includes(normalizedKey(step.args?.key)));
  const removesOrReplaces = steps.some((step) => step.method === "press_key" && ["backspace", "delete"].includes(normalizedKey(step.args?.key)))
    || (selectsAll && steps.some((step) => step.method === "type_text"));
  if (removesOrReplaces && options.mutationAuthorized !== true) {
    throw new Error("A destructive or replacing keyboard burst requires mutationAuthorized: true after the applicable confirmation");
  }
  if (options.finalExpect == null && options.visualVerificationRequired !== true) {
    throw new Error("Keyboard bursts require finalExpect or visualVerificationRequired: true");
  }
}

export function screenshotPoint(observation, x, y, screenshotId) {
  validateObservation(observation);
  const shot = screenshotId
    ? observation.screenshots?.find((item) => item?.id === screenshotId)
    : topScreenshot(observation);
  if (!shot?.id) throw new Error("No current screenshot region is available");
  if (![x, y].every(Number.isFinite) || x < 0 || y < 0 || x >= shot.width || y >= shot.height) {
    throw new Error(`Point (${x}, ${y}) is outside screenshot bounds ${shot.width}x${shot.height}`);
  }
  // Coordinates are local to the screenshot/window binding. Do not add originX/originY.
  return { screenshotId: shot.id, x, y };
}


function screenshotGeometry(state) {
  const regions = [...(state?.screenshots ?? [])]
    .sort((a, b) => (a?.zIndex ?? 0) - (b?.zIndex ?? 0))
    .map((item) => [item?.width, item?.height, item?.originX, item?.originY, item?.zIndex]);
  return regions.length ? JSON.stringify(regions) : "";
}

/**
 * Keep one approved sky object and one target-window lease warm for a task.
 * Remote mode requires an explicit title cue, scope, and success condition so
 * latency optimizations never weaken target selection or verification.
 */
export function createPersistentWindowSession(sky, options = {}) {
  if (!sky || typeof sky.get_window_state !== "function") {
    throw new Error("A callable approved sky runtime is required");
  }
  const mode = options.mode ?? "local";
  if (!["local", "remote-fast-fix"].includes(mode)) throw new Error(`Unsupported session mode: ${mode}`);
  const initialWindow = options.window ?? options.observation?.window ?? null;
  const titleCue = String(options.targetTitleIncludes ?? "").trim();
  const expectedApp = String(options.targetApp ?? initialWindow?.app ?? "").trim();
  const identityCue = String(options.remoteIdentityIncludes ?? "").trim();
  const remoteDeviceId = String(options.remoteDeviceId ?? "").trim();
  const taskScope = String(options.taskScope ?? "").trim();
  const operationScope = String(options.operationScope
    ?? (mode === "remote-fast-fix" ? "entire-bound-device" : "target-window")).trim()
    || (mode === "remote-fast-fix" ? "entire-bound-device" : "target-window");
  const success = options.success;
  const targetVerifier = options.targetVerifier;
  const deviceIdExtractor = options.deviceIdExtractor;
  const deviceVerifier = options.deviceVerifier;
  const connectionVerifier = options.connectionVerifier;
  const authorizationVerifier = options.authorizationVerifier;
  const stopSignalVerifier = options.stopSignalVerifier;
  const playbookCache = options.playbookCache ?? null;
  const rawPlaybookContext = options.playbookContext ?? null;
  const disconnectErrorMatcher = options.disconnectErrorMatcher ?? defaultDisconnectErrorMatcher;
  const clock = options.clock ?? Date.now;
  for (const [name, callback] of Object.entries({
    targetVerifier,
    deviceIdExtractor,
    deviceVerifier,
    connectionVerifier,
    authorizationVerifier,
    stopSignalVerifier,
    disconnectErrorMatcher,
    clock,
  })) {
    if (callback != null && typeof callback !== "function") throw new Error(`${name} must be a function`);
  }
  if (mode === "remote-fast-fix" && (!titleCue || !expectedApp || !remoteDeviceId || !taskScope || success == null)) {
    throw new Error("remote-fast-fix requires targetTitleIncludes, targetApp/window.app, remoteDeviceId, taskScope, and success");
  }
  if (mode === "remote-fast-fix" && options.authorizationGranted !== true && !authorizationVerifier) {
    throw new Error("remote-fast-fix requires authorizationGranted: true or an authorizationVerifier");
  }
  if (playbookCache != null
      && (typeof playbookCache.match !== "function" || typeof playbookCache.recordVerifiedSuccess !== "function")) {
    throw new Error("playbookCache must expose match and recordVerifiedSuccess");
  }
  if (rawPlaybookContext != null && typeof rawPlaybookContext !== "object" && typeof rawPlaybookContext !== "function") {
    throw new Error("playbookContext must be an object or function");
  }
  const maxBurstActions = options.maxBurstActions ?? 3;
  const maxSamePathAttempts = options.maxSamePathAttempts ?? 2;
  const defaultHandoffSettleMs = options.handoffSettleMs ?? 350;
  const screenshotOnSemanticChange = options.screenshotOnSemanticChange ?? mode === "remote-fast-fix";
  const observationLeaseMs = Object.freeze({
    coordinate: options.coordinateLeaseMs ?? (mode === "remote-fast-fix" ? 15_000 : 30_000),
    focus: options.focusLeaseMs ?? (mode === "remote-fast-fix" ? 45_000 : 60_000),
    semantic: options.semanticLeaseMs ?? (mode === "remote-fast-fix" ? 90_000 : 120_000),
  });
  if (!Number.isInteger(maxBurstActions) || maxBurstActions < 1 || maxBurstActions > 3) {
    throw new Error("maxBurstActions must be an integer from 1 to 3");
  }
  if (!Number.isInteger(maxSamePathAttempts) || maxSamePathAttempts < 1) {
    throw new Error("maxSamePathAttempts must be a positive integer");
  }
  if (!Number.isInteger(defaultHandoffSettleMs) || defaultHandoffSettleMs < 0 || defaultHandoffSettleMs > 2_000) {
    throw new Error("handoffSettleMs must be an integer from 0 to 2000");
  }
  for (const [kind, duration] of Object.entries(observationLeaseMs)) {
    if (!(duration === Infinity || (Number.isFinite(duration) && duration >= 0))) {
      throw new Error(`${kind} observation lease must be zero or greater`);
    }
  }

  let window = initialWindow;
  let state = options.observation ?? null;
  let initialized = false;
  let layoutEpoch = 0;
  let semanticEpoch = 0;
  let lastTitle = state?.window?.title ?? null;
  let lastGeometry = screenshotGeometry(state);
  let lastContentSignature = state ? readinessSignature(state, options) : null;
  let pendingVisualRefresh = false;
  let authorizationStatus = mode === "local" ? "not-required" : "pending";
  let sessionStatus = mode === "local" ? "initializing" : "pending-authorization";
  let controlOwner = mode === "local" ? "agent" : "pending";
  let lastControlHandoff = null;
  let pendingHandoffPlan = null;
  let handoffSequence = 0;
  let stopLatched = false;
  let emergencyStopped = false;
  let stopReason = "";
  let successVerified = false;
  let successEpoch = null;
  let lastVerifiedCheckpoint = null;
  let boundLabeledDeviceIds = null;
  let lastObservationAt = null;
  let playbookContext = null;
  let playbookMatch = null;
  let playbookRecording = null;
  const playbookTrace = {
    title: compactText(options.playbookTitle ?? taskScope, 100),
    prechecks: [...(options.playbookPrechecks ?? [])].slice(0, 3),
    steps: [],
    success_checks: [],
    rollback: [...(options.playbookRollback ?? [])].slice(0, 2),
  };
  const attempts = new Map();

  async function resolvePlaybookContext(nextState) {
    if (!playbookCache || mode !== "remote-fast-fix") return null;
    try {
      const context = typeof rawPlaybookContext === "function"
        ? await rawPlaybookContext(nextState, { task_scope: taskScope, operation_scope: operationScope })
        : rawPlaybookContext;
      return context && typeof context === "object" ? context : null;
    } catch (error) {
      playbookMatch = { matched: false, reason: "context-error", detail: compactText(error?.message, 160), recipes: [] };
      return null;
    }
  }

  async function matchVerifiedPlaybook(nextState) {
    if (!playbookCache || mode !== "remote-fast-fix") return null;
    playbookContext = await resolvePlaybookContext(nextState);
    if (!playbookContext) return playbookMatch;
    try {
      playbookMatch = await playbookCache.match(playbookContext, {
        limit: 1,
        maxChars: options.playbookMatchChars ?? 900,
      });
    } catch (error) {
      playbookMatch = { matched: false, reason: "cache-error", detail: compactText(error?.message, 160), recipes: [] };
    }
    return playbookMatch;
  }

  function expectationLabel(expect) {
    if (expect == null) return "postcondition verified";
    if (typeof expect === "string") return compactText(expect, 140);
    if (typeof expect === "object") {
      for (const key of ["includes", "titleIncludes", "focusedIncludes", "notIncludes"]) {
        if (expect[key] != null) return compactText(`${key}: ${expect[key]}`, 140);
      }
    }
    return "postcondition verified";
  }

  function semanticTarget(action, priorState) {
    if (action?.playbookTarget) return compactText(action.playbookTarget, 100);
    const index = action?.args?.element_index;
    if (Number.isInteger(index)) {
      const line = String(priorState?.accessibility?.tree ?? "")
        .split(/\r?\n/u)
        .find((item) => new RegExp(`^\\s*${index}\\s+`, "u").test(item));
      if (line) return compactText(line.replace(/^\s*\d+\s+/u, ""), 100);
    }
    if (["type_text", "press_key", "set_value"].includes(action?.method)) {
      return compactText(priorState?.accessibility?.focused_element ?? "focused editable", 100);
    }
    return "current remote surface";
  }

  function rememberPlaybookStep(action, priorState, expect, kind = null) {
    if (!playbookCache || mode !== "remote-fast-fix" || !action?.method || playbookTrace.steps.length >= 6) return;
    playbookTrace.steps.push({
      action: compactText(kind ?? action.method, 60),
      target: semanticTarget(action, priorState),
      expect: compactText(action.playbookExpect ?? expectationLabel(expect), 140),
      ...(action.playbookParameter ? { parameter: compactText(action.playbookParameter, 60) } : {}),
    });
  }

  async function promoteVerifiedPlaybook() {
    if (!playbookCache || mode !== "remote-fast-fix" || !playbookContext || playbookTrace.steps.length === 0) return null;
    playbookTrace.success_checks = [compactText(options.playbookSuccessLabel ?? "configured terminal success condition verified", 140)];
    try {
      playbookRecording = await playbookCache.recordVerifiedSuccess({
        context: playbookContext,
        recipe: playbookTrace,
        evidence: { success_verified: true },
      });
    } catch (error) {
      playbookRecording = { recorded: false, reason: "cache-error", detail: compactText(error?.message, 160) };
    }
    return playbookRecording;
  }

  async function recordMatchedPlaybookFailure(reason = "cached-postcondition-missed") {
    const id = playbookMatch?.recipes?.[0]?.id;
    if (!id || typeof playbookCache?.recordFailure !== "function") return { recorded: false, reason: "no-matched-playbook" };
    try {
      return await playbookCache.recordFailure({ id, reason: compactText(reason, 120) });
    } catch (error) {
      return { recorded: false, reason: "cache-error", detail: compactText(error?.message, 160) };
    }
  }

  function currentTime() {
    const value = Number(clock());
    if (!Number.isFinite(value)) throw new Error("clock must return a finite timestamp");
    return value;
  }

  function observationAgeMs() {
    return lastObservationAt == null ? Infinity : Math.max(0, currentTime() - lastObservationAt);
  }

  function actionLeaseKind(action) {
    const method = action?.method;
    const args = action?.args ?? {};
    if (["click", "scroll", "drag"].includes(method)
        && (args.screenshotId != null || args.x != null || args.y != null || args.path != null
          || args.from_x != null || args.from_y != null || args.to_x != null || args.to_y != null)) {
      return "coordinate";
    }
    if (["type_text", "press_key"].includes(method)) return "focus";
    if (Number.isInteger(args.element_index) || method === "set_value" || method === "perform_secondary_action") {
      return "semantic";
    }
    return null;
  }

  function assertObservationFresh(actions) {
    const actionList = Array.isArray(actions) ? actions : [actions];
    const kinds = actionList.map(actionLeaseKind).filter(Boolean);
    if (kinds.length === 0) return { kind: "window", age_ms: observationAgeMs(), max_age_ms: Infinity };
    const kind = kinds.reduce((selected, candidate) => (
      observationLeaseMs[candidate] < observationLeaseMs[selected] ? candidate : selected
    ));
    const age = observationAgeMs();
    const maxAge = observationLeaseMs[kind];
    if (age > maxAge) {
      const error = new Error(`Observation lease expired for ${kind} input; refresh and remap before input`);
      error.code = "STALE_OBSERVATION_LEASE";
      error.lease_kind = kind;
      error.age_ms = age;
      error.max_age_ms = maxAge;
      throw error;
    }
    return { kind, age_ms: age, max_age_ms: maxAge };
  }

  function targetFingerprint() {
    return {
      app: expectedApp || null,
      window_id: window?.id ?? null,
      title_includes: titleCue || null,
      remote_identity_configured: Boolean(identityCue),
      device_id_sha256_12: deviceIdHash(remoteDeviceId),
      operation_scope: operationScope,
    };
  }

  function callbackBoolean(name, callback, ...args) {
    const result = callback(...args);
    if (result && typeof result.then === "function") throw new Error(`${name} must return synchronously`);
    return Boolean(result);
  }

  function transition(nextStatus, reason = "", { revoke = false, latch = false, emergency = false } = {}) {
    sessionStatus = nextStatus;
    stopReason = compactText(reason, 240);
    if (revoke && mode === "remote-fast-fix") {
      authorizationStatus = "revoked";
      controlOwner = "none";
      successVerified = false;
      successEpoch = null;
    }
    if (latch) stopLatched = true;
    if (emergency) emergencyStopped = true;
  }

  function failTargetLock(message, reason = "target-lock-changed") {
    if (mode === "remote-fast-fix") transition("stopped", reason, { revoke: true, latch: true });
    throw new Error(message);
  }

  function deviceMatches(nextState, { requireEvidence = false } = {}) {
    if (mode !== "remote-fast-fix") return true;
    if (deviceVerifier) {
      return callbackBoolean("deviceVerifier", deviceVerifier, nextState, remoteDeviceId, targetFingerprint(), {
        require_evidence: requireEvidence,
      });
    }
    if (deviceIdExtractor) {
      const observed = deviceIdExtractor(nextState, targetFingerprint());
      if (observed && typeof observed.then === "function") throw new Error("deviceIdExtractor must return synchronously");
      return normalizeDeviceId(observed) === normalizeDeviceId(remoteDeviceId);
    }
    const expected = normalizeDeviceId(remoteDeviceId);
    const labeledIds = defaultObservedDeviceIds(nextState);
    if (requireEvidence) {
      if (!labeledIds.includes(expected) && !stateContainsDeviceId(nextState, remoteDeviceId)) return false;
      boundLabeledDeviceIds = new Set([...labeledIds, expected]);
      return true;
    }
    if (labeledIds.length > 0 && boundLabeledDeviceIds) {
      return labeledIds.every((observed) => boundLabeledDeviceIds.has(observed));
    }
    if (labeledIds.length > 0) return labeledIds.includes(expected);
    if (stateContainsDeviceId(nextState, remoteDeviceId)) return true;
    return !requireEvidence;
  }

  function connectionIsActive(nextState) {
    return connectionVerifier
      ? callbackBoolean("connectionVerifier", connectionVerifier, nextState, targetFingerprint())
      : defaultConnectionVerifier(nextState);
  }

  function authorizationIsActive(nextState, explicitAuthorization) {
    if (mode !== "remote-fast-fix") return true;
    if (authorizationVerifier) {
      return callbackBoolean("authorizationVerifier", authorizationVerifier, nextState, targetFingerprint(), {
        explicit_authorization: Boolean(explicitAuthorization),
        session_status: sessionStatus,
      });
    }
    return explicitAuthorization === true;
  }

  function checkStopSignal(nextState) {
    if (!stopSignalVerifier) return false;
    return callbackBoolean("stopSignalVerifier", stopSignalVerifier, nextState, targetFingerprint());
  }

  function validateRemoteState(nextState, { activateAuthorization = false, explicitAuthorization = false } = {}) {
    if (mode !== "remote-fast-fix") return;
    if (stopLatched) throw new Error("Remote session is stopped; create a new authorized session");
    if (checkStopSignal(nextState)) {
      transition("stopped", "customer-emergency-stop", { revoke: true, latch: true, emergency: true });
      throw new Error("Customer emergency stop is active");
    }
    if (!connectionIsActive(nextState)) {
      transition("disconnected", "remote-connection-lost", { revoke: true });
      throw new Error("Remote connection is no longer active");
    }
    if (!deviceMatches(nextState, { requireEvidence: activateAuthorization })) {
      failTargetLock("Remote device lock changed", "remote-device-changed");
    }
    if (identityCue && !stateText(nextState).includes(identityCue)) {
      failTargetLock("Remote session identity cue changed", "remote-identity-changed");
    }
    if (activateAuthorization) {
      if (!authorizationIsActive(nextState, explicitAuthorization)) {
        transition("unauthorized", "authorization-missing", { revoke: true });
        throw new Error("Remote session authorization is not active");
      }
      authorizationStatus = "active";
      controlOwner = "agent";
    }
  }

  function acceptState(nextState, stateOptions = {}) {
    validateObservation(nextState);
    if (window && (nextState.window.id !== window.id || nextState.window.app !== window.app)) {
      failTargetLock("Target window lease changed; explicitly rebind and remap before input", "remote-window-changed");
    }
    if (expectedApp && String(nextState.window.app ?? "") !== expectedApp) {
      failTargetLock("Target app changed", "remote-app-changed");
    }
    if (titleCue && !String(nextState.window.title ?? "").includes(titleCue)) {
      failTargetLock("Target title lost its required cue", "remote-title-changed");
    }
    if (targetVerifier && !callbackBoolean("targetVerifier", targetVerifier, nextState, targetFingerprint())) {
      failTargetLock("Custom target verifier rejected the current window state", "target-verifier-rejected");
    }
    validateRemoteState(nextState, stateOptions);

    const nextTitle = nextState.window.title ?? null;
    const nextGeometry = screenshotGeometry(nextState);
    const nextContentSignature = readinessSignature(nextState, options);
    const layoutChanged = (lastTitle != null && nextTitle !== lastTitle)
      || (lastGeometry && nextGeometry && nextGeometry !== lastGeometry);
    const semanticChanged = lastContentSignature != null && nextContentSignature !== lastContentSignature;
    if (layoutChanged) layoutEpoch += 1;
    if (semanticChanged) semanticEpoch += 1;
    if (successVerified && successEpoch
        && (successEpoch.layout !== layoutEpoch || successEpoch.semantic !== semanticEpoch)) {
      successVerified = false;
      successEpoch = null;
    }

    window = nextState.window;
    state = nextState;
    lastObservationAt = currentTime();
    lastTitle = nextTitle;
    if (nextGeometry) lastGeometry = nextGeometry;
    lastContentSignature = nextContentSignature;
    if (mode === "remote-fast-fix") {
      sessionStatus = authorizationStatus === "active" ? "connected" : "connected-unauthorized";
    } else {
      sessionStatus = "connected";
    }
    return { layoutChanged, semanticChanged };
  }

  function assertInputAllowed() {
    if (mode !== "remote-fast-fix") return true;
    if (stopLatched || emergencyStopped) throw new Error("Remote input is stopped");
    if (authorizationStatus !== "active") throw new Error("Remote input authorization is inactive");
    if (sessionStatus !== "connected") throw new Error(`Remote input is frozen while session status is ${sessionStatus}`);
    if (controlOwner !== "agent") throw new Error("Remote input is paused for user control");
    return true;
  }

  function handleRuntimeError(error, phase) {
    if (mode !== "remote-fast-fix" || stopLatched) return;
    if (callbackBoolean("disconnectErrorMatcher", disconnectErrorMatcher, error, phase, targetFingerprint())) {
      transition("disconnected", `connection-lost-during-${phase}`, { revoke: true });
    } else {
      transition("stalled", `runtime-error-during-${phase}`);
    }
  }

  function rememberVerifiedCheckpoint(kind, verifiedState = state) {
    lastVerifiedCheckpoint = {
      kind,
      at: new Date().toISOString(),
      layout_epoch: layoutEpoch,
      semantic_epoch: semanticEpoch,
      summary: compactState(verifiedState, { maxChars: 800 }),
    };
  }

  function withSessionMeta(result, changes = {}, extra = {}) {
    return {
      ...result,
      ...extra,
      operation_scope: operationScope,
      layout_epoch: layoutEpoch,
      semantic_epoch: semanticEpoch,
      layout_changed: Boolean(changes.layoutChanged),
      semantic_changed: Boolean(changes.semanticChanged),
      target_fingerprint: targetFingerprint(),
      authorization_status: authorizationStatus,
      authorization_check_mode: mode === "remote-fast-fix" ? "session-lease" : "not-required",
      session_status: sessionStatus,
      control_owner: controlOwner,
      emergency_stopped: emergencyStopped,
      success_verified: successVerified,
    };
  }

  async function initialObserve(observeOptions = {}) {
    if (initialized) return withSessionMeta({
      state,
      summary: compactState(state, observeOptions),
      reused: true,
      metrics: { actions: 0, observations: 0, sky_calls: 0, duration_ms: 0, observation_chars: 0, compact_chars: 0, screenshot_regions: state?.screenshots?.length ?? 0 },
    });
    if (!window) throw new Error("Initial observation requires a target window");
    try {
      const result = await observeCompact(sky, window, {
        ...options,
        ...observeOptions,
        include_screenshot: true,
        include_text: observeOptions.include_text ?? options.initialIncludeText ?? true,
      });
      const changes = acceptState(result.state, {
        activateAuthorization: mode === "remote-fast-fix",
        explicitAuthorization: options.authorizationGranted === true,
      });
      initialized = true;
      pendingVisualRefresh = false;
      rememberVerifiedCheckpoint("initial-map", result.state);
      await matchVerifiedPlaybook(result.state);
      return withSessionMeta(result, changes, { reused: false, playbook_match: playbookMatch });
    } catch (error) {
      handleRuntimeError(error, "initial-observation");
      throw error;
    }
  }

  async function observe(reason = "routine", observeOptions = {}) {
    if (!initialized) return initialObserve(observeOptions);
    const screenshotReasons = new Set(["layout-change", "semantic-change", "failure", "coordinate", "verification", "recovery"]);
    const includeScreenshot = observeOptions.include_screenshot
      ?? (pendingVisualRefresh || screenshotReasons.has(reason));
    try {
      let result = await observeCompact(sky, window, {
        ...options,
        ...observeOptions,
        include_screenshot: includeScreenshot,
        include_text: observeOptions.include_text ?? true,
      });
      const changes = acceptState(result.state);
      let promotedScreenshot = false;
      if (!includeScreenshot && changes.semanticChanged
          && (observeOptions.screenshotOnSemanticChange ?? screenshotOnSemanticChange)) {
        const promoted = await observeCompact(sky, window, {
          ...options,
          ...observeOptions,
          include_screenshot: true,
          include_text: observeOptions.include_text ?? true,
        });
        const promotedChanges = acceptState(promoted.state);
        mergeMetrics(result.metrics, promoted.metrics);
        result = { ...promoted, metrics: result.metrics };
        changes.layoutChanged ||= promotedChanges.layoutChanged;
        changes.semanticChanged ||= promotedChanges.semanticChanged;
        promotedScreenshot = true;
      }
      if ((result.state?.screenshots?.length ?? 0) > 0) pendingVisualRefresh = false;
      return withSessionMeta(result, changes, { reason, promoted_screenshot: promotedScreenshot });
    } catch (error) {
      handleRuntimeError(error, `observation-${reason}`);
      throw error;
    }
  }

  async function act(action, refresh = {}) {
    if (!initialized) await initialObserve();
    assertInputAllowed(state);
    const inputLease = assertObservationFresh(action);
    try {
      successVerified = false;
      successEpoch = null;
      const priorState = state;
      const nextState = await actAndRefresh(sky, state, action, refresh);
      const changes = acceptState(nextState);
      const verified = refresh.expect != null;
      let visual = null;
      if ((nextState?.screenshots?.length ?? 0) === 0 && changes.semanticChanged
          && (refresh.screenshotOnSemanticChange ?? screenshotOnSemanticChange)) {
        visual = await observe("semantic-change", { needles: refresh.needles });
      }
      if (verified) {
        rememberVerifiedCheckpoint("action", state);
        rememberPlaybookStep(action, priorState, refresh.expect);
      }
      return withSessionMeta({
        ok: true,
        verified,
        outcome: verified ? "verified" : "observed-unverified",
        state,
        summary: compactState(state, refresh),
        visual_summary: visual?.summary ?? null,
      }, changes, { promoted_screenshot: Boolean(visual), input_lease: inputLease });
    } catch (error) {
      const outcomeUnknown = error?.outcome !== "failed";
      handleRuntimeError(error, "action-or-refresh");
      try {
        const diagnostic = await observe("failure", { needles: refresh.needles });
        error.diagnostic = diagnostic.summary;
        error.layout_epoch = diagnostic.layout_epoch;
        error.semantic_epoch = diagnostic.semantic_epoch;
      } catch (diagnosticError) {
        error.diagnostic_error = String(diagnosticError);
      }
      if (outcomeUnknown && mode === "remote-fast-fix" && !stopLatched && authorizationStatus === "active") {
        transition("stalled", "action-outcome-unknown");
      }
      throw error;
    }
  }

  async function transaction(steps, transactionOptions = {}) {
    if (!initialized) await initialObserve();
    if (!Array.isArray(steps) || steps.length === 0 || steps.length > maxBurstActions) {
      throw new Error(`Stable transaction requires 1-${maxBurstActions} actions`);
    }
    assertInputAllowed(state);
    const inputLease = assertObservationFresh(steps);
    successVerified = false;
    successEpoch = null;
    const priorState = state;
    const result = await runVerifiedTransaction(sky, state, steps, {
      ...transactionOptions,
      transactionClass: transactionOptions.transactionClass ?? "local-reversible",
      beforeAction: async (currentState, index, step) => {
        assertInputAllowed(currentState);
        if (transactionOptions.beforeAction) await transactionOptions.beforeAction(currentState, index, step);
      },
      observationGuard: async (currentState, index, step) => {
        validateRemoteState(currentState);
        if (transactionOptions.observationGuard) await transactionOptions.observationGuard(currentState, index, step);
      },
    });
    const changes = result.state?.window ? acceptState(result.state) : {};
    let visual = null;
    if (!result.ok && (result.state?.screenshots?.length ?? 0) === 0
        && transactionOptions.promoteFailureScreenshot !== false) {
      visual = await observe("failure", { needles: transactionOptions.needles });
      result.diagnostic = visual.summary;
    } else if (result.ok && (result.state?.screenshots?.length ?? 0) === 0
        && changes.semanticChanged
        && (transactionOptions.screenshotOnSemanticChange ?? screenshotOnSemanticChange)) {
      visual = await observe("semantic-change", { needles: transactionOptions.needles });
      result.visual_summary = visual.summary;
    }
    if (visual?.metrics && result.metrics) mergeMetrics(result.metrics, visual.metrics);
    if (!result.ok && result.outcome === "unknown" && mode === "remote-fast-fix" && !stopLatched && authorizationStatus === "active") {
      transition("stalled", "transaction-outcome-unknown");
    }
    if (result.ok) {
      rememberVerifiedCheckpoint("transaction", state);
      for (const step of steps) rememberPlaybookStep(step, priorState, step.expect, "verified-transaction-step");
    }
    return withSessionMeta(result, changes, { promoted_screenshot: Boolean(visual), input_lease: inputLease });
  }

  async function keyboardBurst(steps, burstOptions = {}) {
    if (!initialized) await initialObserve();
    if (!Array.isArray(steps) || steps.length > maxBurstActions) {
      throw new Error(`Keyboard burst exceeds the ${maxBurstActions}-action session limit`);
    }
    assertInputAllowed(state);
    const inputLease = assertObservationFresh(steps);
    successVerified = false;
    successEpoch = null;
    const priorState = state;
    const result = await runKeyboardBurst(sky, state, steps, {
      ...burstOptions,
      transactionClass: burstOptions.transactionClass ?? "local-reversible",
      beforeAction: async (currentState, index, step) => {
        assertInputAllowed(currentState);
        if (burstOptions.beforeAction) await burstOptions.beforeAction(currentState, index, step);
      },
      observationGuard: async (currentState, index, step) => {
        validateRemoteState(currentState);
        if (burstOptions.observationGuard) await burstOptions.observationGuard(currentState, index, step);
      },
    });
    const changes = result.state?.window ? acceptState(result.state) : {};
    if (!result.ok && result.outcome === "unknown" && mode === "remote-fast-fix" && !stopLatched && authorizationStatus === "active") {
      transition("stalled", "keyboard-burst-outcome-unknown");
    }
    if (result.verified) {
      rememberVerifiedCheckpoint("keyboard-burst", state);
      rememberPlaybookStep({ method: "keyboard-burst", playbookTarget: burstOptions.playbookTarget }, priorState, burstOptions.finalExpect, "verified-keyboard-burst");
    }
    return withSessionMeta(result, changes, { promoted_screenshot: false, input_lease: inputLease });
  }

  function noteAttempt(signature, strategy) {
    const key = `${String(signature)}\u0000${String(strategy)}`;
    const count = (attempts.get(key) ?? 0) + 1;
    attempts.set(key, count);
    return { count, pivot_required: count >= maxSamePathAttempts };
  }

  function clearAttempts(signature, strategy) {
    if (signature == null && strategy == null) {
      attempts.clear();
      return;
    }
    attempts.delete(`${String(signature)}\u0000${String(strategy)}`);
  }

  function markLayoutChanged() {
    layoutEpoch += 1;
    lastGeometry = "";
    pendingVisualRefresh = true;
    return layoutEpoch;
  }

  function markContentChanged() {
    pendingVisualRefresh = true;
    return { pending_visual_refresh: true, semantic_epoch: semanticEpoch };
  }

  function markDisconnected(reason = "remote-client-disconnected") {
    if (mode !== "remote-fast-fix") throw new Error("markDisconnected applies only to remote-fast-fix sessions");
    if (!stopLatched) transition("disconnected", reason, { revoke: true });
    pendingVisualRefresh = true;
    return snapshot();
  }

  function emergencyStop(reason = "customer-emergency-stop") {
    if (mode !== "remote-fast-fix") throw new Error("emergencyStop applies only to remote-fast-fix sessions");
    transition("stopped", reason, { revoke: true, latch: true, emergency: true });
    pendingVisualRefresh = true;
    return snapshot();
  }

  function validateHandoffSteps(steps) {
    if (steps == null) return;
    if (!Array.isArray(steps) || steps.length > maxBurstActions) {
      throw new Error(`Prepared handoff continuation must contain 0-${maxBurstActions} actions`);
    }
    for (let index = 0; index < steps.length; index += 1) {
      if (steps[index]?.expect == null) throw new Error(`Prepared handoff step ${index} requires an explicit postcondition`);
      if (usesCoordinates(steps[index])) throw new Error(`Prepared handoff step ${index} must use a semantic or focused-keyboard route`);
    }
  }

  function pauseForUserInput(reason = "user-credential-entry", handoffOptions = {}) {
    if (mode !== "remote-fast-fix") throw new Error("pauseForUserInput applies only to remote-fast-fix sessions");
    assertInputAllowed();
    if (handoffOptions == null || typeof handoffOptions !== "object" || Array.isArray(handoffOptions)) {
      throw new Error("pauseForUserInput handoff options must be an object");
    }
    validateHandoffSteps(handoffOptions.steps);
    if (handoffOptions.buildSteps != null && typeof handoffOptions.buildSteps !== "function") {
      throw new Error("handoff buildSteps must be a function");
    }
    if (handoffOptions.transactionOptions != null
        && (typeof handoffOptions.transactionOptions !== "object" || Array.isArray(handoffOptions.transactionOptions))) {
      throw new Error("handoff transactionOptions must be an object");
    }
    const settleMs = handoffOptions.settleMs ?? defaultHandoffSettleMs;
    if (!Number.isInteger(settleMs) || settleMs < 0 || settleMs > 2_000) {
      throw new Error("handoff settleMs must be an integer from 0 to 2000");
    }
    const handoffId = `handoff-${++handoffSequence}`;
    pendingHandoffPlan = {
      id: handoffId,
      returnExpect: handoffOptions.returnExpect ?? null,
      steps: handoffOptions.steps ?? null,
      buildSteps: handoffOptions.buildSteps ?? null,
      transactionOptions: handoffOptions.transactionOptions ?? {},
      settleMs,
      completionSignaled: false,
      signalSource: null,
      signaledAt: null,
    };
    controlOwner = "user";
    lastControlHandoff = {
      id: handoffId,
      reason: compactText(reason, 240),
      paused_at: new Date().toISOString(),
      resumed_at: null,
      completion_signaled: false,
      fast_resume_ready: pendingHandoffPlan.returnExpect != null,
      continuation_steps: pendingHandoffPlan.steps?.length ?? (pendingHandoffPlan.buildSteps ? "dynamic" : 0),
    };
    return snapshot();
  }

  function signalUserInputComplete(signal = {}) {
    if (mode !== "remote-fast-fix") throw new Error("signalUserInputComplete applies only to remote-fast-fix sessions");
    if (controlOwner !== "user" || !pendingHandoffPlan) throw new Error("No active customer-input handoff is waiting");
    const normalized = typeof signal === "string" ? { source: signal } : signal;
    if (normalized == null || typeof normalized !== "object" || Array.isArray(normalized)) {
      throw new Error("handoff completion signal must be a string or object");
    }
    if (normalized.handoffId != null && String(normalized.handoffId) !== pendingHandoffPlan.id) {
      throw new Error("handoff completion signal does not match the active handoff");
    }
    pendingHandoffPlan.completionSignaled = true;
    pendingHandoffPlan.signalSource = compactText(normalized.source ?? "explicit-event", 80);
    pendingHandoffPlan.signaledAt = currentTime();
    if (lastControlHandoff) {
      lastControlHandoff.completion_signaled = true;
      lastControlHandoff.signal_source = pendingHandoffPlan.signalSource;
    }
    return {
      handoff_id: pendingHandoffPlan.id,
      completion_signaled: true,
      control_owner: controlOwner,
    };
  }

  async function fastWindowBindingCheck(enabled = true) {
    if (!enabled || typeof sky.list_windows !== "function") return { checked: false, ok: true, calls: 0 };
    const windows = await sky.list_windows();
    if (!Array.isArray(windows)) throw new Error("sky.list_windows must return an array");
    const match = windows.find((candidate) => (
      String(candidate?.id) === String(window?.id)
      && (!expectedApp || String(candidate?.app ?? "") === expectedApp)
    ));
    return { checked: true, ok: Boolean(match), calls: 1 };
  }

  function completeControlHandoff() {
    controlOwner = "agent";
    if (lastControlHandoff) lastControlHandoff.resumed_at = new Date().toISOString();
    pendingHandoffPlan = null;
  }

  async function resumeAgentControl(observeOptions = {}) {
    if (mode !== "remote-fast-fix") throw new Error("resumeAgentControl applies only to remote-fast-fix sessions");
    if (stopLatched || emergencyStopped) throw new Error("Remote session is stopped");
    if (authorizationStatus !== "active" || sessionStatus !== "connected") {
      throw new Error("The connected authorization lease is not active");
    }
    if (controlOwner !== "user") throw new Error("Remote control is not paused for user input");
    const result = await observe("user-handoff-return", {
      ...observeOptions,
      include_screenshot: observeOptions.include_screenshot ?? true,
    });
    completeControlHandoff();
    return {
      ...result,
      authorization_check_mode: "session-lease",
      control_owner: controlOwner,
      user_handoff_resumed: true,
    };
  }

  async function resumeAndContinue(resumeOptions = {}) {
    if (mode !== "remote-fast-fix") throw new Error("resumeAndContinue applies only to remote-fast-fix sessions");
    if (stopLatched || emergencyStopped) throw new Error("Remote session is stopped");
    if (authorizationStatus !== "active" || sessionStatus !== "connected") {
      throw new Error("The connected authorization lease is not active");
    }
    if (controlOwner !== "user" || !pendingHandoffPlan) throw new Error("Remote control is not paused for user input");
    if (resumeOptions.userInputComplete === true && !pendingHandoffPlan.completionSignaled) {
      signalUserInputComplete({ source: resumeOptions.signalSource ?? "direct-runtime-event", handoffId: pendingHandoffPlan.id });
    }
    if (!pendingHandoffPlan.completionSignaled) throw new Error("An explicit customer handback event is required before fast resume");

    const started = Date.now();
    const plan = pendingHandoffPlan;
    const settleMs = resumeOptions.settleMs ?? plan.settleMs;
    if (!Number.isInteger(settleMs) || settleMs < 0 || settleMs > 2_000) {
      throw new Error("resume settleMs must be an integer from 0 to 2000");
    }
    if (settleMs > 0) await new Promise((resolve) => setTimeout(resolve, settleMs));

    const windowCheck = await fastWindowBindingCheck(resumeOptions.verifyWindowList !== false);
    if (!windowCheck.ok) {
      markDisconnected("handoff-window-missing-or-changed");
      pendingHandoffPlan = null;
      return withSessionMeta({
        ok: false,
        outcome: "handoff-window-mismatch",
        reason: "The bound remote-client window is missing or changed",
        state,
        summary: state ? compactState(state, { maxChars: 400 }) : null,
        metrics: {
          actions: 0, observations: 0, sky_calls: windowCheck.calls,
          duration_ms: Date.now() - started, compact_chars: 0, screenshot_regions: 0,
          handoff_settle_ms: settleMs, model_roundtrips_saved: 0,
        },
      });
    }

    const returnExpect = resumeOptions.expect ?? plan.returnExpect;
    if (returnExpect == null) throw new Error("resumeAndContinue requires a prepared or supplied return expectation");
    const observation = await observe("user-handoff-fast-return", {
      ...(resumeOptions.observeOptions ?? {}),
      include_screenshot: resumeOptions.include_screenshot ?? false,
      screenshotOnSemanticChange: false,
      maxChars: resumeOptions.maxChars ?? 400,
      screenshotLimit: resumeOptions.include_screenshot === true ? 1 : 0,
    });
    const returnCheck = expectationResult(observation.state, returnExpect);
    if (!returnCheck.ok) {
      completeControlHandoff();
      observation.metrics.sky_calls += windowCheck.calls;
      observation.metrics.duration_ms = Date.now() - started;
      observation.metrics.handoff_settle_ms = settleMs;
      observation.metrics.model_roundtrips_saved = 0;
      return {
        ...observation,
        ok: false,
        outcome: "handoff-expectation-mismatch",
        reason: returnCheck.reason,
        user_handoff_resumed: true,
        continuation_executed: false,
      };
    }

    completeControlHandoff();
    let steps = resumeOptions.steps ?? plan.steps;
    let transactionOptions = { ...plan.transactionOptions, ...(resumeOptions.transactionOptions ?? {}) };
    if (plan.buildSteps || resumeOptions.buildSteps) {
      const built = await (resumeOptions.buildSteps ?? plan.buildSteps)(observation.state, {
        handoff_id: plan.id,
        operation_scope: operationScope,
      });
      if (Array.isArray(built)) steps = built;
      else if (built && typeof built === "object") {
        steps = built.steps ?? steps;
        transactionOptions = { ...transactionOptions, ...(built.transactionOptions ?? {}) };
      }
    }
    validateHandoffSteps(steps);

    if (!steps?.length) {
      rememberVerifiedCheckpoint("handoff-resume", observation.state);
      observation.metrics.sky_calls += windowCheck.calls;
      observation.metrics.duration_ms = Date.now() - started;
      observation.metrics.handoff_settle_ms = settleMs;
      observation.metrics.model_roundtrips_saved = 1;
      return {
        ...observation,
        ok: true,
        outcome: "handoff-resumed-verified",
        user_handoff_resumed: true,
        continuation_executed: false,
      };
    }

    const continued = await transaction(steps, {
      ...transactionOptions,
      risk: transactionOptions.risk ?? "reversible",
      maxChars: transactionOptions.maxChars ?? 400,
      screenshotLimit: transactionOptions.screenshotLimit ?? 0,
      screenshotOnSemanticChange: false,
      promoteFailureScreenshot: false,
    });
    mergeMetrics(continued.metrics, observation.metrics);
    continued.metrics.sky_calls += windowCheck.calls;
    continued.metrics.duration_ms = Date.now() - started;
    continued.metrics.handoff_settle_ms = settleMs;
    continued.metrics.model_roundtrips_saved = continued.ok ? 1 : 0;
    return {
      ...continued,
      outcome: continued.ok ? "handoff-continued-verified" : continued.outcome,
      user_handoff_resumed: true,
      continuation_executed: true,
    };
  }

  async function resumeAfterReconnect(nextWindow, recoveryOptions = {}) {
    if (mode !== "remote-fast-fix") throw new Error("resumeAfterReconnect applies only to remote-fast-fix sessions");
    if (stopLatched || emergencyStopped) throw new Error("A stopped remote session requires a new authorization session");
    if (!nextWindow || nextWindow.id == null || !nextWindow.app) {
      throw new Error("Reconnect requires a returned app/window handle");
    }
    if (recoveryOptions.reauthorize !== true && !authorizationVerifier) {
      throw new Error("Reconnect requires reauthorize: true or a passing authorizationVerifier");
    }
    transition("rebinding", "reconnect-in-progress");
    authorizationStatus = "pending";
    controlOwner = "none";
    window = nextWindow;
    state = null;
    initialized = false;
    layoutEpoch += 1;
    lastTitle = null;
    lastGeometry = "";
    lastContentSignature = null;
    boundLabeledDeviceIds = null;
    pendingVisualRefresh = true;
    try {
      const result = await observeCompact(sky, window, {
        ...options,
        ...recoveryOptions,
        include_screenshot: true,
        include_text: recoveryOptions.include_text ?? true,
      });
      const changes = acceptState(result.state, {
        activateAuthorization: true,
        explicitAuthorization: recoveryOptions.reauthorize === true,
      });
      initialized = true;
      pendingVisualRefresh = false;
      return withSessionMeta(result, changes, {
        rebind_reason: recoveryOptions.reason ?? "reconnected",
        resumed_from_checkpoint: lastVerifiedCheckpoint,
      });
    } catch (error) {
      handleRuntimeError(error, "reconnect");
      throw error;
    }
  }

  async function rebind(nextWindow, reason = "window-invalidated", observeOptions = {}) {
    if (mode === "remote-fast-fix") {
      return resumeAfterReconnect(nextWindow, { ...observeOptions, reason });
    }
    if (!nextWindow || nextWindow.id == null || !nextWindow.app) {
      throw new Error("Rebind requires a returned app/window handle");
    }
    window = nextWindow;
    state = null;
    initialized = false;
    layoutEpoch += 1;
    lastTitle = null;
    lastGeometry = "";
    lastContentSignature = null;
    pendingVisualRefresh = true;
    const result = await initialObserve(observeOptions);
    return { ...result, rebind_reason: reason };
  }

  async function waitUntil(expect, pollOptions = {}) {
    if (!initialized) await initialObserve();
    try {
      const result = await pollUntil(sky, window, expect, {
        intervalMs: 150,
        backoffFactor: 1.6,
        maxIntervalMs: 1200,
        ...pollOptions,
        observationGuard: async (currentState, attempt) => {
          validateRemoteState(currentState);
          if (pollOptions.observationGuard) await pollOptions.observationGuard(currentState, attempt);
        },
      });
      const changes = result.state?.window ? acceptState(result.state) : {};
      let visual = null;
      if (changes.semanticChanged && (pollOptions.screenshotOnSemanticChange ?? screenshotOnSemanticChange)) {
        visual = await observe("semantic-change", { needles: pollOptions.needles });
      }
      if (result.ok) rememberVerifiedCheckpoint("wait-condition", result.state);
      return withSessionMeta(result, changes, {
        promoted_screenshot: Boolean(visual),
        visual_summary: visual?.summary ?? null,
      });
    } catch (error) {
      handleRuntimeError(error, "wait");
      throw error;
    }
  }

  async function verifySuccess(verifyOptions = {}) {
    if (success == null) throw new Error("No terminal success condition is configured");
    if (mode === "remote-fast-fix") assertInputAllowed(state);
    const observation = await observe("verification", { ...verifyOptions, include_screenshot: true });
    const check = expectationResult(observation.state, success);
    successVerified = check.ok;
    successEpoch = check.ok ? { layout: layoutEpoch, semantic: semanticEpoch } : null;
    if (check.ok) {
      rememberVerifiedCheckpoint("terminal-success", observation.state);
      await promoteVerifiedPlaybook();
    }
    return withSessionMeta({
      ok: check.ok,
      outcome: check.ok ? "verified" : "failed",
      reason: check.reason ?? null,
      state: observation.state,
      summary: observation.summary,
    }, {}, { playbook_recording: playbookRecording });
  }

  function snapshot(summaryOptions = {}) {
    return {
      mode,
      operation_scope: operationScope,
      task_scope: taskScope ? compactText(taskScope, 400) : null,
      success_configured: success != null,
      success_verified: successVerified,
      target_fingerprint: targetFingerprint(),
      window: state?.window ?? window,
      layout_epoch: layoutEpoch,
      semantic_epoch: semanticEpoch,
      pending_visual_refresh: pendingVisualRefresh,
      observation_age_ms: observationAgeMs(),
      observation_lease_ms: observationLeaseMs,
      authorization_status: authorizationStatus,
      authorization_check_mode: mode === "remote-fast-fix" ? "session-lease" : "not-required",
      session_status: sessionStatus,
      control_owner: controlOwner,
      emergency_stopped: emergencyStopped,
      stop_reason: stopReason || null,
      recovery_required: ["stalled", "disconnected", "connected-unauthorized", "rebinding"].includes(sessionStatus),
      last_verified_checkpoint: lastVerifiedCheckpoint,
      last_control_handoff: lastControlHandoff,
      handoff_pending: Boolean(pendingHandoffPlan),
      summary: state ? compactState(state, summaryOptions) : null,
    };
  }

  return Object.freeze({
    initialObserve,
    observe,
    act,
    transaction,
    keyboardBurst,
    noteAttempt,
    clearAttempts,
    markLayoutChanged,
    markContentChanged,
    markDisconnected,
    emergencyStop,
    pauseForUserInput,
    signalUserInputComplete,
    resumeAgentControl,
    resumeAndContinue,
    resumeAfterReconnect,
    rebind,
    waitUntil,
    verifySuccess,
    recordMatchedPlaybookFailure,
    assertInputAllowed,
    assertObservationFresh,
    observationAgeMs,
    snapshot,
  });
}

export async function observeCompact(sky, window, options = {}) {
  const started = Date.now();
  const state = await sky.get_window_state({
    window,
    include_screenshot: options.include_screenshot ?? false,
    include_text: options.include_text ?? true,
  });
  const summary = compactState(state, options);
  return {
    state,
    summary,
    metrics: {
      actions: 0,
      observations: 1,
      sky_calls: 1,
      duration_ms: Date.now() - started,
      observation_chars: observationChars(state),
      compact_chars: JSON.stringify(summary).length,
      screenshot_regions: state?.screenshots?.length ?? 0,
    },
  };
}

export async function actAndRefresh(sky, observation, action, refresh = {}) {
  validateObservation(observation);
  validateAction(observation, action);
  if (refresh.expect == null && refresh.allowUnverified !== true) {
    throw new Error("actAndRefresh requires an explicit postcondition; use allowUnverified only for non-terminal recovery work");
  }
  let state;
  try {
    await sky[action.method](actionArgs(observation, action));
    state = await sky.get_window_state({
      window: observation.window,
      include_screenshot: refresh.include_screenshot ?? false,
      include_text: refresh.include_text ?? true,
    });
  } catch (error) {
    throw new Error("Input or refresh outcome is unknown; reobserve before retrying", { cause: error });
  }
  validateObservation(state);
  if (refresh.expect != null) {
    const check = expectationResult(state, refresh.expect);
    if (!check.ok) {
      const error = new Error(`Postcondition failed: ${check.reason}`);
      error.outcome = "failed";
      error.state = state;
      throw error;
    }
  }
  return state;
}

export async function runVerifiedTransaction(sky, observation, steps, options = {}) {
  validateObservation(observation);
  if (options.transactionClass !== "local-reversible") {
    throw new Error("Transactions require transactionClass: 'local-reversible' after scope review");
  }
  if (!TRANSACTION_RISKS.has(options.risk ?? "reversible")) {
    throw new Error("Transactions are limited to low-risk or reversible work");
  }
  if (!Array.isArray(steps) || steps.length === 0) throw new Error("Transaction requires at least one step");
  for (let index = 0; index < steps.length; index += 1) {
    if (steps[index]?.expect == null) {
      throw new Error(`Transaction step ${index} requires an explicit postcondition`);
    }
  }

  const started = Date.now();
  let state = observation;
  const metrics = { actions: 0, observations: 0, sky_calls: 0, duration_ms: 0, observation_chars: 0, compact_chars: 0, screenshot_regions: 0 };

  for (let index = 0; index < steps.length; index += 1) {
    const step = steps[index];
    try {
      if (options.beforeAction) await options.beforeAction(state, index, step);
      validateAction(state, step);
      await sky[step.method](actionArgs(state, step));
      metrics.actions += 1;
      metrics.sky_calls += 1;
    } catch (error) {
      metrics.duration_ms = Date.now() - started;
      return { ok: false, outcome: "unknown", completed: index, failed_step: index, reason: String(error), state, summary: compactState(state, options), metrics };
    }

    try {
      state = await sky.get_window_state({
        window: state.window,
        include_screenshot: step.include_screenshot ?? nextNeedsScreenshot(steps[index + 1]),
        include_text: step.include_text ?? true,
      });
      metrics.observations += 1;
      metrics.sky_calls += 1;
      metrics.observation_chars += observationChars(state);
      metrics.screenshot_regions += state?.screenshots?.length ?? 0;
    } catch (error) {
      metrics.duration_ms = Date.now() - started;
      return { ok: false, outcome: "unknown", completed: index + 1, failed_step: index, reason: `refresh failed: ${error}`, state, summary: compactState(state, options), metrics };
    }

    if (options.observationGuard) {
      try {
        await options.observationGuard(state, index, step);
      } catch (error) {
        metrics.duration_ms = Date.now() - started;
        return { ok: false, outcome: "failed", completed: index + 1, failed_step: index, reason: `observation guard failed: ${error}`, state, summary: compactState(state, options), metrics };
      }
    }

    const check = expectationResult(state, step.expect);
    if (!check.ok) {
      const summary = compactState(state, { ...options, needles: step.needles ?? options.needles });
      metrics.compact_chars = JSON.stringify(summary).length;
      metrics.duration_ms = Date.now() - started;
      return { ok: false, outcome: "failed", completed: index + 1, failed_step: index, reason: check.reason, state, summary, metrics };
    }
  }

  const summary = compactState(state, options);
  metrics.compact_chars = JSON.stringify(summary).length;
  metrics.duration_ms = Date.now() - started;
  return { ok: true, outcome: "verified", completed: steps.length, state, summary, metrics };
}

/**
 * Execute 2-3 already-focused, low-risk keyboard inputs and pay the expensive
 * Windows state-capture cost once at the terminal postcondition. This is not a
 * general macro: it excludes pointer movement, navigation, window shortcuts,
 * and any sequence that crosses a confirmation boundary.
 */
export async function runKeyboardBurst(sky, observation, steps, options = {}) {
  validateKeyboardBurst(observation, steps, options);
  const started = Date.now();
  let state = observation;
  const metrics = {
    actions: 0,
    observations: 0,
    sky_calls: 0,
    duration_ms: 0,
    observation_chars: 0,
    compact_chars: 0,
    screenshot_regions: 0,
    baseline_observations: steps.length,
    saved_observations: steps.length - 1,
  };

  for (let index = 0; index < steps.length; index += 1) {
    const step = steps[index];
    try {
      if (options.beforeAction) await options.beforeAction(state, index, step);
      await sky[step.method]({ ...(step.args ?? {}), window: state.window });
      metrics.actions += 1;
      metrics.sky_calls += 1;
    } catch (error) {
      metrics.duration_ms = Date.now() - started;
      return {
        ok: false,
        verified: false,
        outcome: "unknown",
        completed: index,
        failed_step: index,
        reason: String(error),
        state,
        summary: compactState(state, options),
        metrics,
      };
    }
  }

  try {
    const includeScreenshot = options.include_screenshot ?? options.visualVerificationRequired === true;
    const includeText = options.include_text ?? (options.finalExpect != null || !includeScreenshot);
    state = await sky.get_window_state({
      window: state.window,
      include_screenshot: includeScreenshot,
      include_text: includeText,
    });
    metrics.observations += 1;
    metrics.sky_calls += 1;
    metrics.observation_chars += observationChars(state);
    metrics.screenshot_regions += state?.screenshots?.length ?? 0;
  } catch (error) {
    metrics.duration_ms = Date.now() - started;
    return {
      ok: false,
      verified: false,
      outcome: "unknown",
      completed: steps.length,
      failed_step: steps.length - 1,
      reason: `terminal refresh failed: ${error}`,
      state,
      summary: compactState(state, options),
      metrics,
    };
  }

  if (options.observationGuard) {
    try {
      await options.observationGuard(state, steps.length - 1, steps.at(-1));
    } catch (error) {
      metrics.duration_ms = Date.now() - started;
      return {
        ok: false,
        verified: false,
        outcome: "failed",
        completed: steps.length,
        failed_step: steps.length - 1,
        reason: `observation guard failed: ${error}`,
        state,
        summary: compactState(state, options),
        metrics,
      };
    }
  }

  let verified = false;
  if (options.finalExpect != null) {
    const check = expectationResult(state, options.finalExpect);
    if (!check.ok) {
      const summary = compactState(state, options);
      metrics.compact_chars = JSON.stringify(summary).length;
      metrics.duration_ms = Date.now() - started;
      return {
        ok: false,
        verified: false,
        outcome: "failed",
        completed: steps.length,
        failed_step: steps.length - 1,
        reason: check.reason,
        state,
        summary,
        metrics,
      };
    }
    verified = true;
  }
  if (options.visualVerificationRequired === true && (state.screenshots?.length ?? 0) === 0) {
    const summary = compactState(state, options);
    metrics.compact_chars = JSON.stringify(summary).length;
    metrics.duration_ms = Date.now() - started;
    return {
      ok: false,
      verified: false,
      outcome: "failed",
      completed: steps.length,
      failed_step: steps.length - 1,
      reason: "visual verification requested but no terminal screenshot was returned",
      state,
      summary,
      metrics,
    };
  }

  const summary = compactState(state, options);
  metrics.compact_chars = JSON.stringify(summary).length;
  metrics.duration_ms = Date.now() - started;
  return {
    ok: true,
    verified,
    outcome: verified ? "verified" : "visual-review-required",
    completed: steps.length,
    state,
    summary,
    metrics,
  };
}

/** Poll the cheap window list for a unique appearance or complete closure. */
export async function waitForWindowListState(sky, predicate, options = {}) {
  if (!sky || typeof sky.list_windows !== "function") throw new Error("waitForWindowListState requires sky.list_windows");
  if (typeof predicate !== "function") throw new Error("waitForWindowListState requires a predicate");
  const attempts = options.attempts ?? 20;
  const intervalMs = options.intervalMs ?? 75;
  const expectedCount = options.expectedCount ?? 1;
  if (!Number.isInteger(attempts) || attempts < 1) throw new Error("attempts must be positive");
  if (!Number.isFinite(intervalMs) || intervalMs < 0) throw new Error("intervalMs must be zero or greater");
  if (!Number.isInteger(expectedCount) || expectedCount < 0) throw new Error("expectedCount must be zero or greater");
  const started = Date.now();
  let windows = [];
  let matches = [];
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    windows = await sky.list_windows();
    if (!Array.isArray(windows)) throw new Error("sky.list_windows must return an array");
    matches = windows.filter(predicate);
    if (matches.length === expectedCount) {
      return {
        ok: true,
        attempts: attempt + 1,
        matches,
        metrics: { list_calls: attempt + 1, duration_ms: Date.now() - started },
      };
    }
    if (attempt + 1 < attempts) await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  return {
    ok: false,
    attempts,
    matches,
    metrics: { list_calls: attempts, duration_ms: Date.now() - started },
  };
}

export async function fillEditable(sky, observation, options) {
  const value = String(options?.value ?? "");
  if (!Number.isInteger(options?.element_index)) throw new Error("fillEditable requires element_index");
  const focusExpectation = options.focusExpect ?? ((state) => {
    const focused = String(state?.accessibility?.focused_element ?? "").trim();
    if (!focused) return false;
    if (options.focusedIncludes != null) return focused.includes(String(options.focusedIncludes));
    return new RegExp(`(?:^|\\D)${options.element_index}(?:\\D|$)`).test(focused);
  });
  if (options.strategy === "direct") {
    return runVerifiedTransaction(sky, observation, [{
      method: "set_value",
      args: { element_index: options.element_index, value },
      expect: options.expect ?? { includes: value },
    }], { ...options, transactionClass: options.transactionClass ?? "local-reversible" });
  }
  return runVerifiedTransaction(sky, observation, [
    {
      method: "click",
      args: { element_index: options.element_index },
      expect: focusExpectation,
    },
    {
      method: "press_key",
      args: { key: "Ctrl+a" },
      expect: focusExpectation,
    },
    { method: "type_text", args: { text: value }, expect: options.expect ?? { includes: value }, include_screenshot: options.include_screenshot ?? false },
  ], { ...options, transactionClass: options.transactionClass ?? "local-reversible" });
}

export async function pollUntil(sky, window, expect, options = {}) {
  const attempts = options.attempts ?? 10;
  const initialIntervalMs = options.intervalMs ?? 300;
  const backoffFactor = options.backoffFactor ?? 1;
  const maxIntervalMs = options.maxIntervalMs ?? initialIntervalMs;
  if (!Number.isInteger(attempts) || attempts < 1) throw new Error("Polling attempts must be a positive integer");
  if (![initialIntervalMs, backoffFactor, maxIntervalMs].every(Number.isFinite)
      || initialIntervalMs < 0 || backoffFactor < 1 || maxIntervalMs < initialIntervalMs) {
    throw new Error("Invalid polling interval or backoff options");
  }
  let delayMs = initialIntervalMs;
  let state;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    state = await sky.get_window_state({ window, include_screenshot: false, include_text: true });
    if (options.observationGuard) await options.observationGuard(state, attempt);
    const check = expectationResult(state, expect);
    if (check.ok) return { ok: true, attempts: attempt + 1, state, summary: compactState(state, options) };
    if (attempt + 1 < attempts) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
      delayMs = Math.min(maxIntervalMs, Math.ceil(delayMs * backoffFactor));
    }
  }
  return { ok: false, attempts, state, summary: compactState(state, options) };
}

/**
 * Require an app-specific ready condition to remain unchanged for consecutive
 * observations. A targetable window is only a candidate; it is not proof that
 * the app has finished initializing or can accept the next input.
 */
export async function waitForStableReadyState(sky, window, expect, options = {}) {
  const attempts = options.attempts ?? 10;
  const intervalMs = options.intervalMs ?? 300;
  const stablePasses = options.stablePasses ?? 2;
  if (!Number.isInteger(stablePasses) || stablePasses < 1) {
    throw new Error("stablePasses must be a positive integer");
  }

  const metrics = { actions: 0, observations: 0, sky_calls: 0, duration_ms: 0, observation_chars: 0, compact_chars: 0, screenshot_regions: 0 };
  const started = Date.now();
  let state;
  let stable = 0;
  let previousSignature = null;
  let lastReason = "ready condition was not observed";

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    state = await sky.get_window_state({
      window,
      include_screenshot: false,
      include_text: true,
    });
    metrics.observations += 1;
    metrics.sky_calls += 1;
    metrics.observation_chars += observationChars(state);

    const check = expectationResult(state, expect);
    const hasFocus = String(state?.accessibility?.focused_element ?? "").trim().length > 0;
    const focusCheck = options.requireFocusedElement && !hasFocus
      ? { ok: false, reason: "no focused element was reported" }
      : { ok: true };
    if (check.ok && focusCheck.ok) {
      const signature = readinessSignature(state, options);
      stable = signature === previousSignature ? stable + 1 : 1;
      previousSignature = signature;
      if (stable >= stablePasses) {
        const summary = compactState(state, options);
        metrics.compact_chars = JSON.stringify(summary).length;
        metrics.duration_ms = Date.now() - started;
        return { ok: true, attempts: attempt + 1, stable_passes: stable, state, summary, metrics };
      }
    } else {
      stable = 0;
      previousSignature = null;
      lastReason = check.ok ? focusCheck.reason : check.reason;
    }
    if (attempt + 1 < attempts) await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }

  const summary = compactState(state, options);
  metrics.compact_chars = JSON.stringify(summary).length;
  metrics.duration_ms = Date.now() - started;
  return {
    ok: false,
    attempts,
    stable_passes: stable,
    reason: stable > 0 ? `ready state did not remain stable for ${stablePasses} observations` : lastReason,
    state,
    summary,
    metrics,
  };
}

/**
 * Launch, bind, foreground, and prove readiness before the first input. The
 * caller must provide a meaningful `expect` whenever the app exposes one.
 */
export async function launchAndAwaitReady(sky, appId, options = {}) {
  const started = Date.now();
  const startupMetrics = { actions: 0, observations: 0, sky_calls: 0, duration_ms: 0, observation_chars: 0, compact_chars: 0, screenshot_regions: 0 };
  await sky.launch_app({ app: appId });
  startupMetrics.sky_calls += 1;
  const returnedWindow = await pollForUniqueWindow(sky, appId, { ...options, metrics: startupMetrics });
  const window = await sky.get_window({ id: returnedWindow.id, app: returnedWindow.app });
  startupMetrics.sky_calls += 1;
  if (options.activate !== false) {
    await sky.activate_window({ window });
    startupMetrics.sky_calls += 1;
  }
  const ready = await waitForStableReadyState(sky, window, options.expect, options);
  mergeMetrics(ready.metrics, startupMetrics);
  ready.window = ready.state?.window ?? window;
  const needsStrictPostActivation = options.rebindAfterReady === true
    || options.strictPostActivation === true
    || options.requireFocusedElement === true;
  if (!ready.ok || options.activate === false || !needsStrictPostActivation) {
    ready.metrics.duration_ms = Date.now() - started;
    return ready;
  }

  // A launch-ready window can still lose focus while it is being foregrounded.
  // Rebind its returned handle, activate it again, then prove the post-activation
  // state is stable immediately before the caller's first input.
  const rebound = await sky.get_window({ id: ready.window.id, app: ready.window.app });
  ready.metrics.sky_calls += 1;
  await sky.activate_window({ window: rebound });
  ready.metrics.sky_calls += 1;
  const focusReady = await waitForStableReadyState(sky, rebound, options.expect, {
    ...options,
    stablePasses: options.focusStablePasses ?? Math.max(options.stablePasses ?? 2, 3),
  });
  mergeMetrics(ready.metrics, focusReady.metrics);
  ready.attempts += focusReady.attempts;
  ready.stable_passes = focusReady.stable_passes;
  ready.state = focusReady.state;
  ready.window = focusReady.state?.window ?? rebound;
  if (!focusReady.ok) {
    ready.ok = false;
    ready.reason = `post-activation readiness failed: ${focusReady.reason}`;
    ready.summary = focusReady.summary;
  } else {
    ready.summary = focusReady.summary;
  }
  ready.metrics.duration_ms = Date.now() - started;
  return ready;
}

export async function pollForUniqueWindow(sky, appId, options = {}) {
  const attempts = options.attempts ?? 10;
  const intervalMs = options.intervalMs ?? 300;
  const exactTitle = options.exactTitle;
  const matchesApp = typeof options.appMatcher === "function"
    ? options.appMatcher
    : (candidate) => candidate.id === appId;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const apps = await sky.list_apps();
    if (options.metrics) options.metrics.sky_calls += 1;
    const matchingApps = apps.filter(matchesApp);
    if (matchingApps.length > 1) throw new Error(`Expected one target app; found ${matchingApps.length}`);
    const windows = (matchingApps[0]?.windows ?? []).filter((window) => exactTitle == null || window.title === exactTitle);
    if (windows.length === 1) return windows[0];
    if (windows.length > 1) throw new Error(`Expected one target window; found ${windows.length}`);
    if (attempt + 1 < attempts) await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw new Error("Target window did not appear within the bounded polling budget");
}

export async function selfTest() {
  const calls = [];
  let value = "";
  let shotWidth = 1280;
  const remoteDeviceId = "123-456-789";
  const window = { id: 1, app: "demo", title: "Demo" };
  const mockSky = {
    async click(input) { calls.push(["click", input]); },
    async press_key(input) { calls.push(["press_key", input]); },
    async type_text(input) { value = input.text; calls.push(["type_text", input]); },
    async set_value(input) { value = input.value; calls.push(["set_value", input]); },
    async get_window_state(input) {
      calls.push(["get_window_state", input]);
      return { window, accessibility: { focused_element: "13 Edit", document_text: `${value} Device ${remoteDeviceId}`, tree: `13 Edit ${value} Device ${remoteDeviceId}` }, screenshots: input.include_screenshot ? [{ id: `shot-${shotWidth}`, width: shotWidth, height: 720, originX: 0, originY: 0, zIndex: 1 }] : [] };
    },
  };
  const observation = { window, accessibility: { tree: "13 Edit", focused_element: "13 Edit" }, screenshots: [] };
  const toDeskSignals = createRemoteClientSignalAdapter("ToDesk", { remoteDeviceId });
  const toDeskInitial = {
    window,
    accessibility: { focused_element: "13 Edit", document_text: `ToDesk 设备ID：${remoteDeviceId}`, tree: `13 Edit ToDesk 设备ID：${remoteDeviceId}` },
    screenshots: [],
  };
  if (!toDeskSignals.connectionVerifier(toDeskInitial)
      || !toDeskSignals.deviceVerifier(toDeskInitial, remoteDeviceId)
      || toDeskSignals.stopSignalVerifier(toDeskInitial)) {
    throw new Error("ToDesk signal adapter initial binding self-test failed");
  }
  const toDeskHidden = { window, accessibility: { focused_element: "13 Edit", document_text: "Remote desktop settings", tree: "13 Edit Remote desktop settings" }, screenshots: [] };
  if (!toDeskSignals.deviceVerifier(toDeskHidden, remoteDeviceId)) {
    throw new Error("ToDesk signal adapter lost a temporarily hidden device binding");
  }
  if (toDeskSignals.deviceVerifier(toDeskHidden, remoteDeviceId, null, { require_evidence: true })) {
    throw new Error("ToDesk signal adapter accepted reconnect without device evidence");
  }
  const toDeskConflict = {
    window,
    accessibility: { focused_element: "13 Edit", document_text: `设备ID：${remoteDeviceId}\n远程设备ID：987-654-321`, tree: `设备ID：${remoteDeviceId}\n远程设备ID：987-654-321` },
    screenshots: [],
  };
  if (toDeskSignals.deviceVerifier(toDeskConflict, remoteDeviceId)
      || toDeskSignals.connectionVerifier({ ...toDeskHidden, accessibility: { document_text: "连接已断开", tree: "连接已断开" } })
      || !toDeskSignals.stopSignalVerifier({ ...toDeskHidden, accessibility: { document_text: "对方已终止远程控制", tree: "对方已终止远程控制" } })) {
    throw new Error("ToDesk signal adapter conflict/disconnect/stop self-test failed");
  }
  const sunloginSignals = createRemoteClientSignalAdapter("向日葵", { remoteDeviceId });
  const sunloginInitial = {
    window,
    accessibility: { focused_element: "13 Edit", document_text: `向日葵识别码：${remoteDeviceId}`, tree: `13 Edit 向日葵识别码：${remoteDeviceId}` },
    screenshots: [],
  };
  if (!sunloginSignals.connectionVerifier(sunloginInitial)
      || !sunloginSignals.deviceVerifier(sunloginInitial, remoteDeviceId)) {
    throw new Error("Sunlogin signal adapter initial binding self-test failed");
  }
  const result = await fillEditable(mockSky, observation, { element_index: 13, value: "hello", strategy: "keyboard", risk: "reversible" });
  if (!result.ok || result.completed !== 3 || result.metrics.sky_calls !== 6 || !result.summary.document_text.includes("hello")) {
    throw new Error("verified transaction self-test failed");
  }
  let burstValue = "";
  let burstObservations = 0;
  const burstSky = {
    ...mockSky,
    async type_text(input) { burstValue += input.text; calls.push(["burst_type_text", input]); },
    async get_window_state(input) {
      burstObservations += 1;
      return {
        window,
        accessibility: input.include_text
          ? { focused_element: "13 Edit", document_text: burstValue, tree: `13 Edit ${burstValue}` }
          : null,
        screenshots: input.include_screenshot ? [{ id: "burst-shot", width: 100, height: 100, zIndex: 1 }] : [],
      };
    },
  };
  const keyboardBurst = await runKeyboardBurst(
    burstSky,
    observation,
    [
      { method: "type_text", args: { text: "A" } },
      { method: "type_text", args: { text: "B" } },
    ],
    {
      transactionClass: "local-reversible",
      risk: "low",
      stabilityConfirmed: true,
      confirmationBoundary: false,
      finalExpect: { includes: "AB" },
    },
  );
  if (!keyboardBurst.ok || !keyboardBurst.verified || keyboardBurst.metrics.observations !== 1
      || keyboardBurst.metrics.saved_observations !== 1 || burstObservations !== 1) {
    throw new Error("single-refresh keyboard burst self-test failed");
  }
  let nonEditableFocusRejected = false;
  try {
    await runKeyboardBurst(
      burstSky,
      { ...observation, accessibility: { focused_element: "21 Button", tree: "21 Button" } },
      [
        { method: "type_text", args: { text: "should-not-run" } },
        { method: "type_text", args: { text: "should-not-run" } },
      ],
      {
        transactionClass: "local-reversible",
        risk: "low",
        stabilityConfirmed: true,
        confirmationBoundary: false,
        finalExpect: { includes: "should-not-run" },
      },
    );
  } catch { nonEditableFocusRejected = true; }
  if (!nonEditableFocusRejected) throw new Error("keyboard burst accepted non-editable semantic focus");
  for (const invalidText of ["line\nbreak", "", undefined]) {
    let invalidLiteralRejected = false;
    try {
      await runKeyboardBurst(
        burstSky,
        observation,
        [
          { method: "type_text", args: { text: invalidText } },
          { method: "type_text", args: { text: "valid" } },
        ],
        {
          transactionClass: "local-reversible",
          risk: "low",
          stabilityConfirmed: true,
          confirmationBoundary: false,
          finalExpect: { includes: "valid" },
        },
      );
    } catch { invalidLiteralRejected = true; }
    if (!invalidLiteralRejected) throw new Error("keyboard burst accepted an invalid literal text payload");
  }
  const semanticVisualBurst = await runKeyboardBurst(
    burstSky,
    observation,
    [
      { method: "type_text", args: { text: "E" } },
      { method: "type_text", args: { text: "V" } },
    ],
    {
      transactionClass: "local-reversible",
      risk: "low",
      stabilityConfirmed: true,
      confirmationBoundary: false,
      finalExpect: { includes: "ABEV" },
      visualVerificationRequired: true,
    },
  );
  if (!semanticVisualBurst.ok || !semanticVisualBurst.verified
      || semanticVisualBurst.metrics.observations !== 1
      || semanticVisualBurst.metrics.screenshot_regions !== 1) {
    throw new Error("combined semantic-and-visual keyboard burst self-test failed");
  }
  let unauthorizedReplacementRejected = false;
  try {
    await runKeyboardBurst(
      burstSky,
      observation,
      [
        { method: "press_key", args: { key: "Control_L+a" } },
        { method: "type_text", args: { text: "replacement" } },
      ],
      {
        transactionClass: "local-reversible",
        risk: "low",
        stabilityConfirmed: true,
        confirmationBoundary: false,
        finalExpect: { includes: "replacement" },
      },
    );
  } catch { unauthorizedReplacementRejected = true; }
  if (!unauthorizedReplacementRejected) throw new Error("keyboard burst bypassed replacement authorization");
  const visualBurst = await runKeyboardBurst(
    burstSky,
    { ...observation, accessibility: null, screenshots: [{ id: "focus-shot", width: 100, height: 100, zIndex: 1 }] },
    [
      { method: "type_text", args: { text: "C" } },
      { method: "type_text", args: { text: "D" } },
    ],
    {
      transactionClass: "local-reversible",
      risk: "low",
      stabilityConfirmed: true,
      confirmationBoundary: false,
      focusVerified: true,
      visualVerificationRequired: true,
    },
  );
  if (!visualBurst.ok || visualBurst.verified || visualBurst.outcome !== "visual-review-required"
      || visualBurst.metrics.screenshot_regions !== 1) {
    throw new Error("visual-review keyboard burst self-test failed");
  }
  let windowListReads = 0;
  const windowListSky = {
    async list_windows() {
      windowListReads += 1;
      return windowListReads < 2 ? [] : [window];
    },
  };
  const appeared = await waitForWindowListState(windowListSky, (candidate) => candidate.id === window.id, { attempts: 3, intervalMs: 0 });
  if (!appeared.ok || appeared.attempts !== 2 || appeared.matches.length !== 1) {
    throw new Error("lightweight window-list wait self-test failed");
  }
  let invalidWindowPollRejected = false;
  try { await waitForWindowListState(windowListSky, () => true, { attempts: 1, intervalMs: -1 }); } catch { invalidWindowPollRejected = true; }
  if (!invalidWindowPollRejected) throw new Error("window-list wait accepted a negative interval");
  const refreshed = await actAndRefresh(mockSky, observation, { method: "type_text", args: { text: "checked" } }, { expect: { includes: "checked" } });
  if (!String(refreshed.accessibility?.document_text).includes("checked")) {
    throw new Error("act-and-refresh postcondition self-test failed");
  }
  let unverifiedRejected = false;
  try { await actAndRefresh(mockSky, observation, { method: "type_text", args: { text: "blocked" } }); } catch { unverifiedRejected = true; }
  if (!unverifiedRejected) throw new Error("unverified action was not rejected");
  let staleScreenshotRejected = false;
  try {
    await actAndRefresh(
      mockSky,
      { ...observation, screenshots: [{ id: "CURRENT", width: 100, height: 100, zIndex: 1 }] },
      { method: "click", args: { x: 2, y: 2, screenshotId: "STALE" } },
      { expect: { includes: "Edit" } },
    );
  } catch { staleScreenshotRejected = true; }
  if (!staleScreenshotRejected) throw new Error("stale screenshot id was accepted");
  const localSession = createPersistentWindowSession(mockSky, { mode: "local", window });
  const localUnverified = await localSession.act(
    { method: "type_text", args: { text: "local-unverified" } },
    { allowUnverified: true, screenshotOnSemanticChange: false },
  );
  if (localUnverified.verified || localUnverified.outcome !== "observed-unverified") {
    throw new Error("allowUnverified action was mislabeled as verified");
  }
  const localBurst = await localSession.keyboardBurst(
    [
      { method: "type_text", args: { text: "session-A" } },
      { method: "type_text", args: { text: "session-B" } },
    ],
    {
      risk: "low",
      stabilityConfirmed: true,
      confirmationBoundary: false,
      finalExpect: { includes: "session-B" },
    },
  );
  if (!localBurst.ok || !localBurst.verified || localBurst.metrics.saved_observations !== 1) {
    throw new Error("persistent session keyboard burst self-test failed");
  }
  let fakeNow = 1_000;
  let staleLeaseInputs = 0;
  const staleLeaseSky = {
    ...mockSky,
    async type_text(input) { staleLeaseInputs += 1; calls.push(["stale_lease_type_text", input]); },
  };
  const staleLeaseSession = createPersistentWindowSession(staleLeaseSky, {
    mode: "local",
    window,
    clock: () => fakeNow,
    coordinateLeaseMs: 50,
    focusLeaseMs: 50,
  });
  await staleLeaseSession.initialObserve();
  fakeNow += 51;
  let staleDragLeaseRejected = false;
  try {
    staleLeaseSession.assertObservationFresh({ method: "drag", args: { from_x: 1, from_y: 1, to_x: 2, to_y: 2 } });
  } catch (error) {
    staleDragLeaseRejected = error?.code === "STALE_OBSERVATION_LEASE" && error?.lease_kind === "coordinate";
  }
  let staleLeaseRejected = false;
  try {
    await staleLeaseSession.act(
      { method: "type_text", args: { text: "expired" } },
      { expect: { includes: "expired" } },
    );
  } catch (error) {
    staleLeaseRejected = error?.code === "STALE_OBSERVATION_LEASE" && error?.lease_kind === "focus";
  }
  if (!staleDragLeaseRejected || !staleLeaseRejected || staleLeaseInputs !== 0
      || staleLeaseSession.snapshot().observation_age_ms !== 51) {
    throw new Error("expired observation lease reached an input action");
  }
  value = "";
  const playbookCalls = { match: 0, record: 0, failure: 0 };
  const mockPlaybookCache = {
    async match(context) {
      playbookCalls.match += 1;
      return { matched: true, recipes: [{ id: "pb-demo", status: "trusted", score: 12, steps: [{ action: "inspect", target: "plugin status", expect: "classified" }] }] };
    },
    async recordVerifiedSuccess(input) {
      playbookCalls.record += 1;
      if (input.evidence?.success_verified !== true || input.recipe?.steps?.length !== 1) throw new Error("invalid automatic playbook recording");
      return { recorded: true, id: "pb-recorded", status: "candidate", successes: 1 };
    },
    async recordFailure() { playbookCalls.failure += 1; return { recorded: true }; },
  };
  const playbookSession = createPersistentWindowSession(mockSky, {
    mode: "remote-fast-fix",
    window,
    targetApp: "demo",
    targetTitleIncludes: "Demo",
    remoteDeviceId,
    authorizationGranted: true,
    taskScope: "repair plugin download",
    success: { includes: "playbook-done" },
    playbookCache: mockPlaybookCache,
    playbookContext: { problem_class: "plugin-install", os_family: "windows", app: "codex", remote_client: "sunlogin" },
    playbookTitle: "Plugin download repair",
    playbookPrechecks: ["Read exact error"],
    playbookSuccessLabel: "Installed entry visible",
  });
  const playbookInitial = await playbookSession.initialObserve();
  if (!playbookInitial.playbook_match?.matched || playbookCalls.match !== 1) throw new Error("automatic playbook match failed");
  await playbookSession.act(
    { method: "type_text", args: { text: "playbook-done" }, playbookTarget: "plugin status" },
    { expect: { includes: "playbook-done" }, playbookExpect: "plugin status updated" },
  );
  const playbookVerified = await playbookSession.verifySuccess();
  if (!playbookVerified.success_verified || !playbookVerified.playbook_recording?.recorded || playbookCalls.record !== 1) {
    throw new Error("automatic verified playbook promotion failed");
  }
  const playbookFailure = await playbookSession.recordMatchedPlaybookFailure();
  if (!playbookFailure.recorded || playbookCalls.failure !== 1) throw new Error("matched playbook failure hook failed");
  value = "";
  const redacted = compactState({ window, accessibility: { focused_element: "Edit", document_text: "token=abc123456789 and Bearer abcdefghijklmnop; user@example.com; +86 138 0013 8000", tree: "Edit token=abc123456789" }, screenshots: [] });
  if (JSON.stringify(redacted).includes("abc123456789") || JSON.stringify(redacted).includes("abcdefghijklmnop") || JSON.stringify(redacted).includes("user@example.com") || JSON.stringify(redacted).includes("138 0013 8000")) {
    throw new Error("compact-state redaction self-test failed");
  }
  const tokenState = {
    window,
    accessibility: { focused_element: "Edit", document_text: `token=abc123456789 ${"x".repeat(2000)}`, tree: "Edit\nButton Save" },
    screenshots: [
      { id: "old", zIndex: 0, width: 10, height: 10, originX: 0, originY: 0 },
      { id: "top", zIndex: 1, width: 10, height: 10, originX: 0, originY: 0 },
    ],
  };
  const compactTokenView = tokenView({ ok: true, state: tokenState, metrics: { actions: 1, observation_chars: 9999, compact_chars: 500 } }, { maxChars: 400 });
  const semanticName = deriveArtifactFileName({ title: "Codex、Claude Code、CC Switch 与 DSH 使用指南", task: "写一份使用说明" }, { extension: "docx" });
  const fallbackName = deriveArtifactFileName({ title: "新建 DOCX 文档", task: "远程模型切换使用指南" }, { extension: ".docx" });
  if (semanticName !== "Codex、Claude Code、CC Switch 与 DSH 使用指南.docx" || fallbackName !== "远程模型切换使用指南.docx") {
    throw new Error(`semantic filename self-test failed: ${semanticName}; ${fallbackName}`);
  }
  const usageMeter = createTaskUsageMeter({ charsPerToken: 3 });
  usageMeter.view({ ok: true, state: tokenState, metrics: { actions: 1, sky_calls: 2 } }, { maxChars: 400 });
  const estimatedUsage = usageMeter.report();
  const exactUsage = usageMeter.report({ input_tokens: 12, output_tokens: 8, cached_input_tokens: 4 });
  if (estimatedUsage.source !== "estimated-compact-view" || estimatedUsage.estimated_compact_view_tokens < 1
      || exactUsage.source !== "host-exact" || exactUsage.total_tokens !== 20 || exactUsage.cached_input_tokens !== 4) {
    throw new Error("task usage meter self-test failed");
  }
  const noScreenshotState = compactState(tokenState, { maxChars: 400, screenshotLimit: 0 });
  const tokenJson = JSON.stringify(compactTokenView);
  if ("state" in compactTokenView || tokenJson.includes("abc123456789") || tokenJson.includes("observation_chars")
      || compactTokenView.summary.screenshots.length !== 1 || noScreenshotState.screenshots.length !== 0) {
    throw new Error("token-view compaction self-test failed");
  }
  let rejected = false;
  try { await runVerifiedTransaction(mockSky, observation, [{ method: "click", args: { element_index: 13 }, expect: { includes: "Edit" } }], { transactionClass: "local-reversible", risk: "consequential" }); } catch { rejected = true; }
  if (!rejected) throw new Error("consequential transaction was not rejected");
  const persistent = createPersistentWindowSession(mockSky, {
    mode: "remote-fast-fix",
    window,
    targetApp: "demo",
    targetTitleIncludes: "Demo",
    remoteIdentityIncludes: "Edit",
    remoteDeviceId,
    authorizationGranted: true,
    taskScope: "repair demo",
    success: { includes: "done" },
  });
  const initial = await persistent.initialObserve();
  if (initial.reused || initial.metrics.screenshot_regions !== 1 || initial.layout_epoch !== 0) throw new Error("persistent session missed initial full observation");
  const routine = await persistent.observe("routine");
  if (routine.metrics.screenshot_regions !== 0 || routine.layout_epoch !== 0 || routine.semantic_changed) throw new Error("routine observation captured an unnecessary screenshot or changed epoch");
  value = "semantic change";
  const changedView = await persistent.observe("routine");
  if (!changedView.semantic_changed || !changedView.promoted_screenshot || changedView.metrics.screenshot_regions !== 1 || changedView.semantic_epoch !== 1) {
    throw new Error("semantic change was not promoted to a visual refresh");
  }
  persistent.markContentChanged();
  const hintedView = await persistent.observe("routine");
  if (hintedView.metrics.screenshot_regions !== 1 || persistent.snapshot().pending_visual_refresh) throw new Error("explicit content-change hint missed visual refresh");
  const fingerprint = persistent.snapshot().target_fingerprint;
  if (fingerprint.app !== "demo" || fingerprint.window_id !== 1 || fingerprint.title_includes !== "Demo" || fingerprint.operation_scope !== "entire-bound-device") {
    throw new Error("target fingerprint is incomplete or missed the full-device operation scope");
  }
  const verifyView = await persistent.observe("verification");
  if (verifyView.metrics.screenshot_regions !== 1) throw new Error("verification observation missed its screenshot");
  if (persistent.noteAttempt("same-error", "same-path").pivot_required) throw new Error("retry guard pivoted too early");
  if (!persistent.noteAttempt("same-error", "same-path").pivot_required) throw new Error("retry guard missed the second unchanged attempt");
  const waited = await persistent.waitUntil({ focusedIncludes: "Edit" }, { attempts: 1, intervalMs: 0, maxIntervalMs: 0 });
  if (!waited.ok || waited.attempts !== 1) throw new Error("persistent session adaptive wait failed");
  shotWidth = 1024;
  const resized = await persistent.observe("layout-change");
  if (!resized.layout_changed || resized.layout_epoch !== 1) throw new Error("remote resolution change was not detected");
  const rebound = await persistent.rebind(window, "self-test", { reauthorize: true });
  if (rebound.rebind_reason !== "self-test" || rebound.layout_epoch !== 2 || rebound.metrics.screenshot_regions !== 1 || rebound.authorization_status !== "active") throw new Error("persistent session rebind failed");
  persistent.markDisconnected("self-test-disconnect");
  if (persistent.snapshot().authorization_status !== "revoked" || persistent.snapshot().session_status !== "disconnected") {
    throw new Error("disconnect did not revoke continuous authorization");
  }
  let disconnectedInputRejected = false;
  try { persistent.assertInputAllowed(); } catch { disconnectedInputRejected = true; }
  if (!disconnectedInputRejected) throw new Error("input remained active after disconnect");
  const resumed = await persistent.resumeAfterReconnect(window, { reauthorize: true, reason: "self-test-resume" });
  if (resumed.authorization_status !== "active" || resumed.session_status !== "connected" || !resumed.resumed_from_checkpoint) {
    throw new Error("same-device reconnect did not restore the verified checkpoint");
  }
  value = "done";
  const terminal = await persistent.verifySuccess({ screenshotOnSemanticChange: false });
  if (!terminal.ok || !terminal.success_verified || !persistent.snapshot().success_verified) {
    throw new Error("configured terminal success was not enforced");
  }

  const leaseChecks = { authorization: 0, connection: 0, device: 0, stop: 0 };
  let leaseChecksAtInput = null;
  const leaseChecksAtInputs = [];
  const leasedSky = {
    ...mockSky,
    async list_windows() { return [window]; },
    async type_text(input) {
      leaseChecksAtInput = { ...leaseChecks };
      leaseChecksAtInputs.push({ ...leaseChecks });
      return mockSky.type_text(input);
    },
  };
  const leased = createPersistentWindowSession(leasedSky, {
    mode: "remote-fast-fix", window, targetApp: "demo", targetTitleIncludes: "Demo",
    remoteDeviceId, taskScope: "credential handoff", success: "done",
    authorizationVerifier() { leaseChecks.authorization += 1; return true; },
    connectionVerifier() { leaseChecks.connection += 1; return true; },
    deviceVerifier() { leaseChecks.device += 1; return true; },
    stopSignalVerifier() { leaseChecks.stop += 1; return false; },
    screenshotOnSemanticChange: false,
  });
  const leasedInitial = await leased.initialObserve();
  if (leasedInitial.authorization_check_mode !== "session-lease" || leasedInitial.control_owner !== "agent") {
    throw new Error("remote authorization lease was not activated");
  }
  const beforeCachedGates = JSON.stringify(leaseChecks);
  for (let index = 0; index < 5; index += 1) leased.assertInputAllowed();
  if (JSON.stringify(leaseChecks) !== beforeCachedGates) {
    throw new Error("cached input gates called remote verifiers per input");
  }
  const pausedForUser = leased.pauseForUserInput("user-types-password");
  if (pausedForUser.authorization_status !== "active" || pausedForUser.control_owner !== "user") {
    throw new Error("user credential handoff revoked the connected authorization lease");
  }
  let agentInputDuringHandoffRejected = false;
  try { leased.assertInputAllowed(); } catch { agentInputDuringHandoffRejected = true; }
  if (!agentInputDuringHandoffRejected) throw new Error("agent input remained active during user handoff");
  const resumedControl = await leased.resumeAgentControl({ screenshotOnSemanticChange: false });
  if (resumedControl.control_owner !== "agent" || resumedControl.authorization_status !== "active" || leaseChecks.authorization !== 1) {
    throw new Error("user handoff return re-ran authorization or failed to resume agent control");
  }
  const checksBeforeInput = { ...leaseChecks };
  await leased.act(
    { method: "type_text", args: { text: "lease-action" } },
    { expect: { includes: "lease-action" }, screenshotOnSemanticChange: false },
  );
  if (JSON.stringify(leaseChecksAtInput) !== JSON.stringify(checksBeforeInput) || leaseChecks.authorization !== 1) {
    throw new Error("remote verifiers ran immediately before a leased input action");
  }
  const burstInputStart = leaseChecksAtInputs.length;
  const checksBeforeBurst = { ...leaseChecks };
  const leasedBurst = await leased.keyboardBurst(
    [
      { method: "type_text", args: { text: "lease-burst-1" } },
      { method: "type_text", args: { text: "lease-burst-2" } },
    ],
    {
      risk: "low",
      stabilityConfirmed: true,
      confirmationBoundary: false,
      finalExpect: { includes: "lease-burst-2" },
      screenshotOnSemanticChange: false,
    },
  );
  const burstInputChecks = leaseChecksAtInputs.slice(burstInputStart);
  if (!leasedBurst.ok || !leasedBurst.verified || burstInputChecks.length !== 2
      || burstInputChecks.some((entry) => JSON.stringify(entry) !== JSON.stringify(checksBeforeBurst))) {
    throw new Error("remote keyboard burst re-ran live verifiers between cached-gate inputs");
  }

  const checksBeforeFastHandoff = { ...leaseChecks };
  let coordinateHandoffRejected = false;
  try {
    leased.pauseForUserInput("bad-coordinate-plan", {
      returnExpect: { includes: "user-complete" },
      steps: [{ method: "click", args: { x: 1, y: 1, screenshotId: "old" }, expect: { includes: "done" } }],
    });
  } catch { coordinateHandoffRejected = true; }
  if (!coordinateHandoffRejected || leased.snapshot().control_owner !== "agent") {
    throw new Error("fast handoff accepted a pre-handoff coordinate or changed ownership after validation failure");
  }
  const fastPaused = leased.pauseForUserInput("user-types-private-value", {
    returnExpect: { includes: "user-complete" },
    settleMs: 0,
    steps: [
      { method: "type_text", args: { text: "fast-resume-action" }, expect: { includes: "fast-resume-action" } },
    ],
  });
  if (!fastPaused.handoff_pending || !fastPaused.last_control_handoff?.fast_resume_ready) {
    throw new Error("fast handoff plan was not retained in the persistent session");
  }
  let missingHandoffSignalRejected = false;
  try { await leased.resumeAndContinue({ settleMs: 0 }); } catch { missingHandoffSignalRejected = true; }
  if (!missingHandoffSignalRejected || leased.snapshot().control_owner !== "user") {
    throw new Error("fast resume accepted control before an explicit handback signal");
  }
  value = "user-complete";
  const handoffSignal = leased.signalUserInputComplete({ source: "self-test-button", handoffId: fastPaused.last_control_handoff.id });
  if (!handoffSignal.completion_signaled || handoffSignal.control_owner !== "user") {
    throw new Error("customer handback signal was not latched");
  }
  const fastResumed = await leased.resumeAndContinue({ settleMs: 0 });
  const fastTokenView = tokenView(fastResumed, { maxChars: 400 });
  if (!fastResumed.ok || fastResumed.outcome !== "handoff-continued-verified"
      || fastResumed.metrics.model_roundtrips_saved !== 1 || fastResumed.metrics.screenshot_regions !== 0
      || fastResumed.control_owner !== "agent" || leased.snapshot().handoff_pending
      || leaseChecks.authorization !== checksBeforeFastHandoff.authorization
      || leaseChecks.connection !== checksBeforeFastHandoff.connection + 3
      || leaseChecks.device !== checksBeforeFastHandoff.device + 3
      || leaseChecks.stop !== checksBeforeFastHandoff.stop + 3
      || "state" in fastTokenView || JSON.stringify(fastTokenView).length > 1000) {
    throw new Error(`event-driven token-compact handoff resume failed: ${JSON.stringify({
      ok: fastResumed.ok,
      outcome: fastResumed.outcome,
      metrics: fastResumed.metrics,
      owner: fastResumed.control_owner,
      pending: leased.snapshot().handoff_pending,
      checksBeforeFastHandoff,
      leaseChecks,
      tokenViewChars: JSON.stringify(fastTokenView).length,
    })}`);
  }

  const missingInitialDevice = createPersistentWindowSession({
    async get_window_state(input) {
      return { window, accessibility: { focused_element: "13 Edit", document_text: "Remote desktop", tree: "13 Edit Remote desktop" }, screenshots: input.include_screenshot ? [{ id: "missing-device", width: 100, height: 100, zIndex: 1 }] : [] };
    },
  }, {
    mode: "remote-fast-fix", window, targetApp: "demo", targetTitleIncludes: "Demo",
    remoteDeviceId, authorizationGranted: true, taskScope: "repair", success: "done",
    screenshotOnSemanticChange: false,
  });
  let missingInitialDeviceRejected = false;
  try { await missingInitialDevice.initialObserve(); } catch { missingInitialDeviceRejected = true; }
  if (!missingInitialDeviceRejected || missingInitialDevice.snapshot().session_status !== "stopped") {
    throw new Error("remote session accepted an initial observation without device evidence");
  }

  let hiddenDeviceObservation = 0;
  const temporarilyHiddenDeviceSky = {
    async get_window_state(input) {
      hiddenDeviceObservation += 1;
      const text = hiddenDeviceObservation === 1 ? `Device ID: ${remoteDeviceId}` : "Remote desktop settings";
      return { window, accessibility: { focused_element: "13 Edit", document_text: text, tree: `13 Edit ${text}` }, screenshots: input.include_screenshot ? [{ id: `hidden-device-${hiddenDeviceObservation}`, width: 100, height: 100, zIndex: 1 }] : [] };
    },
  };
  const stableHiddenDevice = createPersistentWindowSession(temporarilyHiddenDeviceSky, {
    mode: "remote-fast-fix", window, targetApp: "demo", targetTitleIncludes: "Demo",
    remoteDeviceId, authorizationGranted: true, taskScope: "repair", success: "done",
    screenshotOnSemanticChange: false,
  });
  await stableHiddenDevice.initialObserve();
  await stableHiddenDevice.observe("routine", { screenshotOnSemanticChange: false });
  if (stableHiddenDevice.snapshot().session_status !== "connected"
      || stableHiddenDevice.snapshot().authorization_status !== "active") {
    throw new Error("remote device binding was lost when the ID temporarily left the accepted observation");
  }

  let observedDeviceId = remoteDeviceId;
  const switchedDeviceSky = {
    async get_window_state(input) {
      const deviceText = `Device ${remoteDeviceId}\nRemote ID ${observedDeviceId}`;
      return { window, accessibility: { focused_element: "13 Edit", document_text: deviceText, tree: `13 Edit ${deviceText}` }, screenshots: input.include_screenshot ? [{ id: "device-shot", width: 100, height: 100, zIndex: 1 }] : [] };
    },
  };
  const deviceLocked = createPersistentWindowSession(switchedDeviceSky, {
    mode: "remote-fast-fix", window, targetApp: "demo", targetTitleIncludes: "Demo",
    remoteDeviceId, authorizationGranted: true, taskScope: "repair", success: "done",
    screenshotOnSemanticChange: false,
  });
  await deviceLocked.initialObserve();
  observedDeviceId = "987-654-321";
  let deviceSwitchRejected = false;
  try { await deviceLocked.observe("routine", { screenshotOnSemanticChange: false }); } catch { deviceSwitchRejected = true; }
  if (!deviceSwitchRejected || deviceLocked.snapshot().session_status !== "stopped" || deviceLocked.snapshot().authorization_status !== "revoked") {
    throw new Error("remote device switch did not stop and revoke the session");
  }

  const stopped = createPersistentWindowSession(mockSky, {
    mode: "remote-fast-fix", window, targetApp: "demo", targetTitleIncludes: "Demo",
    remoteDeviceId, authorizationGranted: true, taskScope: "repair", success: "done",
  });
  await stopped.initialObserve();
  stopped.emergencyStop("customer-stop-button");
  let stoppedInputRejected = false;
  try { stopped.assertInputAllowed(); } catch { stoppedInputRejected = true; }
  if (!stoppedInputRejected || !stopped.snapshot().emergency_stopped || stopped.snapshot().authorization_status !== "revoked") {
    throw new Error("customer emergency stop did not revoke input immediately");
  }

  let missingRemoteGuardsRejected = false;
  try {
    createPersistentWindowSession(mockSky, { mode: "remote-fast-fix", window, targetApp: "demo", targetTitleIncludes: "Demo", taskScope: "repair", success: "done" });
  } catch { missingRemoteGuardsRejected = true; }
  if (!missingRemoteGuardsRejected) throw new Error("remote session accepted missing authorization/device guards");
  const wrongTargetSky = {
    async get_window_state() {
      return { window: { id: 2, app: "other", title: "Demo" }, accessibility: { document_text: `Edit Device ${remoteDeviceId}` }, screenshots: [] };
    },
  };
  const wrongTarget = createPersistentWindowSession(wrongTargetSky, { mode: "remote-fast-fix", window: { id: 2, app: "other", title: "Demo" }, targetApp: "demo", targetTitleIncludes: "Demo", remoteDeviceId, authorizationGranted: true, taskScope: "repair", success: "done" });
  let wrongTargetRejected = false;
  try { await wrongTarget.initialObserve(); } catch { wrongTargetRejected = true; }
  if (!wrongTargetRejected) throw new Error("target fingerprint accepted the wrong app");
  let burstRejected = false;
  try {
    await persistent.transaction(new Array(4).fill({ method: "click", args: { element_index: 13 }, expect: { includes: "Edit" } }));
  } catch { burstRejected = true; }
  if (!burstRejected) throw new Error("persistent session accepted more than three burst actions");
  let missingExpectationRejected = false;
  try { await runVerifiedTransaction(mockSky, observation, [{ method: "click", args: { element_index: 13 } }], { transactionClass: "local-reversible", risk: "reversible" }); } catch { missingExpectationRejected = true; }
  if (!missingExpectationRejected) throw new Error("transaction step without a postcondition was not rejected");
  const wrongFocusSky = {
    ...mockSky,
    async get_window_state(input) {
      calls.push(["get_window_state", input]);
      return { window, accessibility: { focused_element: "99 Other", document_text: value, tree: `99 Other ${value}` }, screenshots: [] };
    },
  };
  const wrongFocus = await fillEditable(wrongFocusSky, observation, { element_index: 13, value: "blocked", strategy: "keyboard", risk: "reversible" });
  if (wrongFocus.ok || wrongFocus.outcome !== "failed" || wrongFocus.failed_step !== 0) {
    throw new Error("fillEditable accepted focus on the wrong element");
  }
  let badPointRejected = false;
  try { screenshotPoint({ window, screenshots: [{ id: "s", width: 10, height: 10, zIndex: 1 }] }, 10, 1); } catch { badPointRejected = true; }
  if (!badPointRejected) throw new Error("out-of-bounds screenshot point was not rejected");
  let readyReads = 0;
  const readySky = {
    async launch_app() { calls.push(["launch_app"]); },
    async list_apps() { return [{ id: "demo", windows: [window] }]; },
    async get_window() { return window; },
    async activate_window() { calls.push(["activate_window"]); },
    async get_window_state() {
      readyReads += 1;
      return { window, accessibility: { focused_element: "13 Edit", document_text: "Ready", tree: `13 Edit Ready ${readyReads}` }, screenshots: [] };
    },
  };
  const ready = await launchAndAwaitReady(readySky, "demo", { expect: { includes: "Ready" }, attempts: 3, intervalMs: 0, stablePasses: 2, signature: (state) => state.accessibility.document_text });
  if (!ready.ok || ready.stable_passes !== 2 || ready.attempts !== 2) {
    throw new Error("stable readiness self-test failed");
  }
  const strictReady = await launchAndAwaitReady(readySky, "demo", { expect: { includes: "Ready" }, attempts: 4, intervalMs: 0, stablePasses: 2, requireFocusedElement: true, signature: (state) => state.accessibility.document_text });
  if (!strictReady.ok || strictReady.stable_passes !== 3 || strictReady.attempts !== 5) {
    throw new Error("strict post-activation readiness self-test failed");
  }
  return "self-test: ok";
}

function isCliEntryPoint() {
  // `process` is intentionally absent in Codex's persistent node_repl. Keep
  // the module importable there while retaining the standalone CLI self-test.
  if (typeof process === "undefined" || !process.argv?.[1]) return false;
  try {
    return realpathSync(fileURLToPath(import.meta.url)) === realpathSync(process.argv[1]);
  } catch {
    return fileURLToPath(import.meta.url) === process.argv[1];
  }
}

// CLI entry point — resolve junctions/symlinks before comparing paths.
if (isCliEntryPoint()) {
  if (process.argv.includes("--self-test")) {
    selfTest().then((msg) => console.log(msg)).catch((err) => { console.error("FAIL:", err.message); process.exit(1); });
  } else {
    console.log("Usage: node sky_fast_path.mjs --self-test");
  }
}
