/** Low-latency helpers over the approved @oai/sky Computer Use object. */

import { fileURLToPath } from "node:url";

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

const ASSIGNMENT_SECRET = /\b(password|passwd|secret|token|cookie|authorization|api[_-]?key|otp|one[- ]?time code)\b\s*[:=]\s*(?:"[^"]*"|'[^']*'|[^\s,;]+)/gi;
const BEARER_SECRET = /\bbearer\s+[A-Za-z0-9._~+/=-]{8,}\b/gi;
const PREFIX_SECRET = /\b(?:sk|ghp|github_pat|xox[baprs])[-_][A-Za-z0-9_-]{8,}\b/gi;
const EMAIL = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const PHONE = /(?<!\d)(?:\+?\d[\d -]{7,}\d)(?!\d)/g;

function redactText(value) {
  return String(value ?? "")
    .replace(ASSIGNMENT_SECRET, (_, label) => `${label}=[REDACTED]`)
    .replace(BEARER_SECRET, "Bearer [REDACTED]")
    .replace(PREFIX_SECRET, "[REDACTED]")
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

function selectedTreeLines(tree, needles, limit) {
  const lines = String(tree ?? "").split(/\r?\n/).filter(Boolean);
  const wanted = (needles ?? []).map(String).filter(Boolean);
  const selected = wanted.length
    ? lines.filter((line) => wanted.some((needle) => line.includes(needle)))
    : lines.slice(0, 40);
  return capped(selected.map(redactText).join("\n"), limit);
}

function compactText(value, limit) {
  return capped(redactText(value), limit);
}

export function compactState(state, options = {}) {
  if (typeof options === "number") options = { maxChars: options };
  const maxChars = options.maxChars ?? 1800;
  const accessibility = state?.accessibility ?? {};
  const screenshots = [...(state?.screenshots ?? [])]
    .sort((a, b) => (a?.zIndex ?? 0) - (b?.zIndex ?? 0))
    .slice(-2)
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
      ? { id: state.window.id, app: state.window.app, title: compactText(state.window.title, 200) }
      : null,
    focused_element: compactText(accessibility.focused_element, 240),
    selected_text: compactText(accessibility.selected_text, 240),
    document_text: compactText(accessibility.document_text, Math.floor(maxChars / 2)),
    tree: selectedTreeLines(accessibility.tree, options.needles, maxChars),
    screenshots,
  };
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

function expectationResult(state, expect) {
  if (typeof expect === "function") {
    return expect(state) ? { ok: true } : { ok: false, reason: "custom expectation failed" };
  }
  if (!expect) return state?.window ? { ok: true } : { ok: false, reason: "window binding was lost" };
  const text = stateText(state);
  const includes = Array.isArray(expect.includes) ? expect.includes : expect.includes ? [expect.includes] : [];
  const excludes = Array.isArray(expect.excludes) ? expect.excludes : expect.excludes ? [expect.excludes] : [];
  for (const value of includes) if (!text.includes(String(value))) return { ok: false, reason: `missing expected text: ${value}` };
  for (const value of excludes) if (text.includes(String(value))) return { ok: false, reason: `unexpected text remains: ${value}` };
  if (expect.focusedIncludes && !String(state?.accessibility?.focused_element ?? "").includes(expect.focusedIncludes)) {
    return { ok: false, reason: `focus does not contain: ${expect.focusedIncludes}` };
  }
  if (expect.titleIncludes && !String(state?.window?.title ?? "").includes(expect.titleIncludes)) {
    return { ok: false, reason: `window title does not contain: ${expect.titleIncludes}` };
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
  if (usesCoordinates(action) && !topScreenshot(observation)?.id && !args.screenshotId) {
    throw new Error("Coordinate action requires a screenshot id from the current observation");
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
  const intervalMs = options.intervalMs ?? 300;
  let state;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    state = await sky.get_window_state({ window, include_screenshot: false, include_text: true });
    const check = expectationResult(state, expect);
    if (check.ok) return { ok: true, attempts: attempt + 1, state, summary: compactState(state, options) };
    if (attempt + 1 < attempts) await new Promise((resolve) => setTimeout(resolve, intervalMs));
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
  const window = { id: 1, app: "demo", title: "Demo" };
  const mockSky = {
    async click(input) { calls.push(["click", input]); },
    async press_key(input) { calls.push(["press_key", input]); },
    async type_text(input) { value = input.text; calls.push(["type_text", input]); },
    async set_value(input) { value = input.value; calls.push(["set_value", input]); },
    async get_window_state(input) {
      calls.push(["get_window_state", input]);
      return { window, accessibility: { focused_element: "13 Edit", document_text: value, tree: `13 Edit ${value}` }, screenshots: [] };
    },
  };
  const observation = { window, accessibility: { tree: "13 Edit", focused_element: "13 Edit" }, screenshots: [] };
  const result = await fillEditable(mockSky, observation, { element_index: 13, value: "hello", strategy: "keyboard", risk: "reversible" });
  if (!result.ok || result.completed !== 3 || result.metrics.sky_calls !== 6 || !result.summary.document_text.includes("hello")) {
    throw new Error("verified transaction self-test failed");
  }
  const refreshed = await actAndRefresh(mockSky, observation, { method: "type_text", args: { text: "checked" } }, { expect: { includes: "checked" } });
  if (!String(refreshed.accessibility?.document_text).includes("checked")) {
    throw new Error("act-and-refresh postcondition self-test failed");
  }
  let unverifiedRejected = false;
  try { await actAndRefresh(mockSky, observation, { method: "type_text", args: { text: "blocked" } }); } catch { unverifiedRejected = true; }
  if (!unverifiedRejected) throw new Error("unverified action was not rejected");
  const redacted = compactState({ window, accessibility: { focused_element: "Edit", document_text: "token=abc123456789 and Bearer abcdefghijklmnop; user@example.com; +86 138 0013 8000", tree: "Edit token=abc123456789" }, screenshots: [] });
  if (JSON.stringify(redacted).includes("abc123456789") || JSON.stringify(redacted).includes("abcdefghijklmnop") || JSON.stringify(redacted).includes("user@example.com") || JSON.stringify(redacted).includes("138 0013 8000")) {
    throw new Error("compact-state redaction self-test failed");
  }
  let rejected = false;
  try { await runVerifiedTransaction(mockSky, observation, [{ method: "click", args: { element_index: 13 }, expect: { includes: "Edit" } }], { transactionClass: "local-reversible", risk: "consequential" }); } catch { rejected = true; }
  if (!rejected) throw new Error("consequential transaction was not rejected");
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

// CLI entry point — only runs when this file is executed directly
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  if (process.argv.includes("--self-test")) {
    selfTest().then((msg) => console.log(msg)).catch((err) => { console.error("FAIL:", err.message); process.exit(1); });
  } else {
    console.log("Usage: node sky_fast_path.mjs --self-test");
  }
}
