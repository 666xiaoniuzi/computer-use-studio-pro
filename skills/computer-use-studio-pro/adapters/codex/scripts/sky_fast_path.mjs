/** Low-latency helpers over the approved @oai/sky Computer Use object. */

import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";

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
  const success = options.success;
  const targetVerifier = options.targetVerifier;
  const deviceIdExtractor = options.deviceIdExtractor;
  const deviceVerifier = options.deviceVerifier;
  const connectionVerifier = options.connectionVerifier;
  const authorizationVerifier = options.authorizationVerifier;
  const stopSignalVerifier = options.stopSignalVerifier;
  const disconnectErrorMatcher = options.disconnectErrorMatcher ?? defaultDisconnectErrorMatcher;
  for (const [name, callback] of Object.entries({
    targetVerifier,
    deviceIdExtractor,
    deviceVerifier,
    connectionVerifier,
    authorizationVerifier,
    stopSignalVerifier,
    disconnectErrorMatcher,
  })) {
    if (callback != null && typeof callback !== "function") throw new Error(`${name} must be a function`);
  }
  if (mode === "remote-fast-fix" && (!titleCue || !expectedApp || !remoteDeviceId || !taskScope || success == null)) {
    throw new Error("remote-fast-fix requires targetTitleIncludes, targetApp/window.app, remoteDeviceId, taskScope, and success");
  }
  if (mode === "remote-fast-fix" && options.authorizationGranted !== true && !authorizationVerifier) {
    throw new Error("remote-fast-fix requires authorizationGranted: true or an authorizationVerifier");
  }
  const maxBurstActions = options.maxBurstActions ?? 3;
  const maxSamePathAttempts = options.maxSamePathAttempts ?? 2;
  const screenshotOnSemanticChange = options.screenshotOnSemanticChange ?? mode === "remote-fast-fix";
  if (!Number.isInteger(maxBurstActions) || maxBurstActions < 1 || maxBurstActions > 3) {
    throw new Error("maxBurstActions must be an integer from 1 to 3");
  }
  if (!Number.isInteger(maxSamePathAttempts) || maxSamePathAttempts < 1) {
    throw new Error("maxSamePathAttempts must be a positive integer");
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
  let stopLatched = false;
  let emergencyStopped = false;
  let stopReason = "";
  let successVerified = false;
  let successEpoch = null;
  let lastVerifiedCheckpoint = null;
  const attempts = new Map();

  function targetFingerprint() {
    return {
      app: expectedApp || null,
      window_id: window?.id ?? null,
      title_includes: titleCue || null,
      remote_identity_configured: Boolean(identityCue),
      device_id_sha256_12: deviceIdHash(remoteDeviceId),
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

  function deviceMatches(nextState) {
    if (mode !== "remote-fast-fix") return true;
    if (deviceVerifier) return callbackBoolean("deviceVerifier", deviceVerifier, nextState, remoteDeviceId, targetFingerprint());
    if (deviceIdExtractor) {
      const observed = deviceIdExtractor(nextState, targetFingerprint());
      if (observed && typeof observed.then === "function") throw new Error("deviceIdExtractor must return synchronously");
      return normalizeDeviceId(observed) === normalizeDeviceId(remoteDeviceId);
    }
    return stateContainsDeviceId(nextState, remoteDeviceId);
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
    if (!deviceMatches(nextState)) failTargetLock("Remote device lock changed", "remote-device-changed");
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
      return withSessionMeta(result, changes, { reused: false });
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
    try {
      assertInputAllowed(state);
      successVerified = false;
      successEpoch = null;
      const nextState = await actAndRefresh(sky, state, action, refresh);
      const changes = acceptState(nextState);
      const verified = refresh.expect != null;
      let visual = null;
      if ((nextState?.screenshots?.length ?? 0) === 0 && changes.semanticChanged
          && (refresh.screenshotOnSemanticChange ?? screenshotOnSemanticChange)) {
        visual = await observe("semantic-change", { needles: refresh.needles });
      }
      if (verified) rememberVerifiedCheckpoint("action", state);
      return withSessionMeta({
        ok: true,
        verified,
        outcome: verified ? "verified" : "observed-unverified",
        state,
        summary: compactState(state, refresh),
        visual_summary: visual?.summary ?? null,
      }, changes, { promoted_screenshot: Boolean(visual) });
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
    successVerified = false;
    successEpoch = null;
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
    if (!result.ok && (result.state?.screenshots?.length ?? 0) === 0) {
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
    if (result.ok) rememberVerifiedCheckpoint("transaction", state);
    return withSessionMeta(result, changes, { promoted_screenshot: Boolean(visual) });
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

  function pauseForUserInput(reason = "user-credential-entry") {
    if (mode !== "remote-fast-fix") throw new Error("pauseForUserInput applies only to remote-fast-fix sessions");
    assertInputAllowed();
    controlOwner = "user";
    lastControlHandoff = {
      reason: compactText(reason, 240),
      paused_at: new Date().toISOString(),
      resumed_at: null,
    };
    return snapshot();
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
    controlOwner = "agent";
    if (lastControlHandoff) lastControlHandoff.resumed_at = new Date().toISOString();
    return {
      ...result,
      authorization_check_mode: "session-lease",
      control_owner: controlOwner,
      user_handoff_resumed: true,
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
    if (check.ok) rememberVerifiedCheckpoint("terminal-success", observation.state);
    return withSessionMeta({
      ok: check.ok,
      outcome: check.ok ? "verified" : "failed",
      reason: check.reason ?? null,
      state: observation.state,
      summary: observation.summary,
    });
  }

  function snapshot(summaryOptions = {}) {
    return {
      mode,
      task_scope: taskScope ? compactText(taskScope, 400) : null,
      success_configured: success != null,
      success_verified: successVerified,
      target_fingerprint: targetFingerprint(),
      window: state?.window ?? window,
      layout_epoch: layoutEpoch,
      semantic_epoch: semanticEpoch,
      pending_visual_refresh: pendingVisualRefresh,
      authorization_status: authorizationStatus,
      authorization_check_mode: mode === "remote-fast-fix" ? "session-lease" : "not-required",
      session_status: sessionStatus,
      control_owner: controlOwner,
      emergency_stopped: emergencyStopped,
      stop_reason: stopReason || null,
      recovery_required: ["stalled", "disconnected", "connected-unauthorized", "rebinding"].includes(sessionStatus),
      last_verified_checkpoint: lastVerifiedCheckpoint,
      last_control_handoff: lastControlHandoff,
      summary: state ? compactState(state, summaryOptions) : null,
    };
  }

  return Object.freeze({
    initialObserve,
    observe,
    act,
    transaction,
    noteAttempt,
    clearAttempts,
    markLayoutChanged,
    markContentChanged,
    markDisconnected,
    emergencyStop,
    pauseForUserInput,
    resumeAgentControl,
    resumeAfterReconnect,
    rebind,
    waitUntil,
    verifySuccess,
    assertInputAllowed,
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
  value = "";
  const redacted = compactState({ window, accessibility: { focused_element: "Edit", document_text: "token=abc123456789 and Bearer abcdefghijklmnop; user@example.com; +86 138 0013 8000", tree: "Edit token=abc123456789" }, screenshots: [] });
  if (JSON.stringify(redacted).includes("abc123456789") || JSON.stringify(redacted).includes("abcdefghijklmnop") || JSON.stringify(redacted).includes("user@example.com") || JSON.stringify(redacted).includes("138 0013 8000")) {
    throw new Error("compact-state redaction self-test failed");
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
  if (fingerprint.app !== "demo" || fingerprint.window_id !== 1 || fingerprint.title_includes !== "Demo") throw new Error("target fingerprint is incomplete");
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
  const leasedSky = {
    ...mockSky,
    async type_text(input) {
      leaseChecksAtInput = { ...leaseChecks };
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

  let observedDeviceId = remoteDeviceId;
  const switchedDeviceSky = {
    async get_window_state(input) {
      return { window, accessibility: { focused_element: "13 Edit", document_text: `Device ${observedDeviceId}`, tree: `13 Edit Device ${observedDeviceId}` }, screenshots: input.include_screenshot ? [{ id: "device-shot", width: 100, height: 100, zIndex: 1 }] : [] };
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

// CLI entry point — only runs when this file is executed directly
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  if (process.argv.includes("--self-test")) {
    selfTest().then((msg) => console.log(msg)).catch((err) => { console.error("FAIL:", err.message); process.exit(1); });
  } else {
    console.log("Usage: node sky_fast_path.mjs --self-test");
  }
}
