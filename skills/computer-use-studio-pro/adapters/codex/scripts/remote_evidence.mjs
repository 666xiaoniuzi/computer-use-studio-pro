/** Zero-probe remote evidence routing and one-batch Windows terminal probes. */

import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Buffer } from "node:buffer";

import { enforceRuntimeGate, assertLicensed } from "./license_check.mjs";

enforceRuntimeGate();

const ROUTE_PRIORITY = Object.freeze({
  "current-state": 0,
  "structured-executor": 1,
  "terminal-batch": 2,
  "outer-window-list": 3,
  accessibility: 4,
  "state-capture": 5,
  "visual-capture": 6,
});

const TERMINAL_KINDS = new Set([
  "file", "process", "service", "port", "inner-window", "registry", "app-version", "system", "dns",
]);

const REQUEST_KINDS = new Set([
  ...TERMINAL_KINDS, "api", "network", "outer-window", "ui", "visual", "batch",
]);

const START_MARKER = "__CUSPRO_EVIDENCE_BEGIN__";
const END_MARKER = "__CUSPRO_EVIDENCE_END__";

function finiteMs(value, fallback) {
  const result = Number(value ?? fallback);
  if (!Number.isFinite(result) || result < 0) throw new Error("Evidence route latency must be zero or greater");
  return result;
}

function supportedBy(adapter, kind) {
  if (!adapter || adapter.verified !== true) return false;
  if (!Array.isArray(adapter.kinds) || adapter.kinds.length === 0) return true;
  return adapter.kinds.includes(kind) || (kind === "batch" && adapter.kinds.some((item) => TERMINAL_KINDS.has(item)));
}

function normalizeRequest(request = {}) {
  if (!request || typeof request !== "object" || Array.isArray(request)) throw new Error("Evidence request must be an object");
  const kind = String(request.kind ?? (Array.isArray(request.probes) ? "batch" : "")).trim().toLowerCase();
  if (!REQUEST_KINDS.has(kind)) throw new Error(`Unsupported remote evidence kind: ${kind || "empty"}`);
  return { ...request, kind };
}

/** Synchronously choose a route from declared capabilities; performs no probe or tool call. */
export function classifyRemoteEvidenceRoute(capabilities = {}, rawRequest = {}) {
  const request = normalizeRequest(rawRequest);
  const baselineMs = finiteMs(request.baselineStateCaptureMs ?? capabilities.baselineStateCaptureMs, 3100);
  const maxEstimatedMs = finiteMs(request.maxEstimatedMs, baselineMs);
  const candidates = [];
  const add = (route, available, estimatedMs, extra = {}) => {
    if (!available) return;
    const estimate = finiteMs(estimatedMs, baselineMs);
    if (estimate > maxEstimatedMs) return;
    candidates.push({ route, estimated_ms: estimate, ...extra });
  };

  const requiresVisual = request.requireScreenshot === true || request.kind === "visual";
  const currentStateEligible = request.state && typeof request.verify === "function"
    && (!requiresVisual || (request.state.screenshots?.length ?? 0) > 0);
  add("current-state", Boolean(currentStateEligible), 0, { state_captures: 0 });
  add("structured-executor", !requiresVisual && Boolean(capabilities.structuredExecutor), capabilities.structuredExecutorMs ?? 50, { state_captures: 0 });
  add("terminal-batch", !requiresVisual && Boolean(capabilities.terminalBatch), capabilities.terminalBatchMs ?? 650, { state_captures: capabilities.terminalStateCaptures ?? 0 });
  add("outer-window-list", !requiresVisual && request.kind === "outer-window" && Boolean(capabilities.windowList), capabilities.windowListMs ?? 20, { state_captures: 0 });
  add("accessibility", !requiresVisual && Boolean(request.state?.accessibility && typeof request.verify === "function"), 0, { state_captures: 0 });
  add("state-capture", !requiresVisual && Boolean(capabilities.stateCapture), capabilities.stateCaptureMs ?? baselineMs, { state_captures: 1 });
  add("visual-capture", Boolean(capabilities.visualCapture), capabilities.visualCaptureMs ?? baselineMs, { state_captures: 1 });

  candidates.sort((a, b) => a.estimated_ms - b.estimated_ms || ROUTE_PRIORITY[a.route] - ROUTE_PRIORITY[b.route]);
  return Object.freeze({
    ok: candidates.length > 0,
    kind: request.kind,
    route: candidates[0]?.route ?? null,
    estimated_ms: candidates[0]?.estimated_ms ?? null,
    baseline_state_capture_ms: baselineMs,
    estimated_ms_saved: candidates[0] ? Math.max(0, baselineMs - candidates[0].estimated_ms) : 0,
    candidates: Object.freeze(candidates.map((item) => Object.freeze(item))),
    inventory_calls: 0,
    network_probes: 0,
    model_roundtrips: 0,
    automatic_fallbacks: 0,
  });
}

function verifyCollected(value, request) {
  if (typeof request.verify === "function") {
    const checked = request.verify(value);
    if (checked && typeof checked === "object") return { ok: checked.ok === true, reason: checked.reason ?? null };
    return { ok: checked === true, reason: checked === true ? null : "local evidence predicate did not match" };
  }
  return { ok: value?.verified === true, reason: value?.verified === true ? null : "evidence requires a local predicate or verified executor result" };
}

/**
 * Build a router whose construction and selection are call-free. collect() runs
 * exactly one selected route and never cascades into a slower fallback.
 */
export function createRemoteEvidenceRouter(options = {}) {
  assertLicensed();
  const sky = options.sky ?? null;
  const structuredExecutor = options.structuredExecutor ?? null;
  const terminalBridge = options.terminalBridge ?? null;
  const baselineStateCaptureMs = finiteMs(options.baselineStateCaptureMs, 3100);
  const routeStats = new Map();
  const capabilities = Object.freeze({
    baselineStateCaptureMs,
    structuredExecutor: supportedBy(structuredExecutor, "batch") || structuredExecutor?.verified === true,
    structuredExecutorMs: structuredExecutor?.estimatedMs,
    terminalBatch: terminalBridge?.verified === true && (typeof terminalBridge.execute === "function" || typeof terminalBridge.runBatch === "function"),
    terminalBatchMs: terminalBridge?.estimatedMs,
    terminalStateCaptures: terminalBridge?.estimatedStateCaptures,
    windowList: typeof sky?.list_windows === "function",
    windowListMs: options.windowListMs,
    stateCapture: typeof sky?.get_window_state === "function",
    visualCapture: typeof sky?.get_window_state === "function",
  });

  const statKey = (kind, route) => `${kind}\u0000${route}`;
  const estimate = (kind, route, fallback) => {
    const stat = routeStats.get(statKey(kind, route));
    if (stat?.consecutive_failures > 0) return baselineStateCaptureMs + 1;
    return stat?.ewma_ms ?? fallback;
  };
  const record = (kind, route, durationMs, ok) => {
    const key = statKey(kind, route);
    const previous = routeStats.get(key);
    const duration = Math.max(0, Number(durationMs) || 0);
    routeStats.set(key, {
      runs: (previous?.runs ?? 0) + 1,
      successes: (previous?.successes ?? 0) + (ok ? 1 : 0),
      failures: (previous?.failures ?? 0) + (ok ? 0 : 1),
      consecutive_failures: ok ? 0 : (previous?.consecutive_failures ?? 0) + 1,
      ewma_ms: previous?.ewma_ms == null ? duration : Math.round(previous.ewma_ms * 0.7 + duration * 0.3),
    });
  };

  function inspect(rawRequest) {
    const request = normalizeRequest(rawRequest);
    const scoped = {
      ...capabilities,
      structuredExecutor: supportedBy(structuredExecutor, request.kind),
      structuredExecutorMs: estimate(request.kind, "structured-executor", capabilities.structuredExecutorMs ?? 50),
      terminalBatch: request.kind === "batch"
        ? capabilities.terminalBatch && supportedBy(terminalBridge, "batch")
        : capabilities.terminalBatch && TERMINAL_KINDS.has(request.kind) && supportedBy(terminalBridge, request.kind),
      terminalBatchMs: estimate(request.kind, "terminal-batch", capabilities.terminalBatchMs ?? 650),
      windowListMs: estimate(request.kind, "outer-window-list", capabilities.windowListMs ?? 20),
    };
    const stateEstimate = estimate(request.kind, "state-capture", baselineStateCaptureMs);
    const visualEstimate = estimate(request.kind, "visual-capture", baselineStateCaptureMs);
    scoped.stateCaptureMs = stateEstimate;
    scoped.visualCaptureMs = visualEstimate;
    return classifyRemoteEvidenceRoute(scoped, request);
  }

  async function collect(rawRequest) {
    const request = normalizeRequest(rawRequest);
    const selection = inspect(request);
    if (!selection.ok) throw new Error(`No verified remote evidence route for ${request.kind}`);
    const started = Date.now();
    let value;
    let metrics = {};
    try {
      switch (selection.route) {
      case "current-state":
      case "accessibility":
        value = request.state;
        break;
      case "structured-executor": {
        if (typeof structuredExecutor.execute !== "function") throw new Error("Structured executor requires execute(request)");
        value = await structuredExecutor.execute(request);
        metrics = value?.metrics ?? {};
        break;
      }
      case "terminal-batch": {
        const probes = request.probes ?? [request];
        value = await runWindowsRemoteEvidenceBatch(terminalBridge, probes, request);
        metrics = value.metrics;
        break;
      }
      case "outer-window-list": {
        const windows = await sky.list_windows();
        if (!Array.isArray(windows)) throw new Error("sky.list_windows must return an array");
        value = { windows, verified: typeof request.predicate === "function" ? request.predicate(windows) === true : false };
        metrics = { sky_calls: 1, state_captures: 0 };
        break;
      }
      case "state-capture":
      case "visual-capture": {
        if (!request.window) throw new Error(`${selection.route} requires request.window`);
        value = await sky.get_window_state({
          window: request.window,
          include_text: request.includeText ?? true,
          include_screenshot: selection.route === "visual-capture",
        });
        metrics = { sky_calls: 1, state_captures: 1, screenshots: value?.screenshots?.length ?? 0 };
        break;
      }
      default:
        throw new Error(`Unimplemented evidence route: ${selection.route}`);
      }
    } catch (error) {
      record(request.kind, selection.route, Date.now() - started, false);
      error.remote_evidence_route = selection.route;
      throw error;
    }
    const verificationRequest = selection.route === "outer-window-list" && typeof request.verify !== "function"
      ? { ...request, verify: (result) => result.verified === true }
      : request;
    const checked = verifyCollected(value, verificationRequest);
    record(request.kind, selection.route, Date.now() - started, true);
    return {
      ok: checked.ok,
      verified: checked.ok,
      reason: checked.reason,
      kind: request.kind,
      route: selection.route,
      evidence: value,
      selection,
      metrics: {
        sky_calls: Number(metrics.sky_calls ?? 0),
        state_captures: Number(metrics.state_captures ?? 0),
        screenshots: Number(metrics.screenshots ?? 0),
        terminal_batches: Number(metrics.terminal_batches ?? 0),
        model_roundtrips: 0,
        route_selection_calls: 0,
        attempted_routes: 1,
        automatic_fallbacks: 0,
        duration_ms: Date.now() - started,
      },
    };
  }

  function performanceSnapshot() {
    return Object.fromEntries([...routeStats.entries()].map(([key, value]) => [key.replace("\u0000", ":"), { ...value }]));
  }

  return Object.freeze({ capabilities, inspect, collect, performanceSnapshot });
}

function psQuote(value) {
  return `'${String(value ?? "").replace(/'/gu, "''")}'`;
}

function probeStatement(probe) {
  const id = psQuote(probe.id);
  const kind = psQuote(probe.kind);
  const push = (expression) => `$r+=[pscustomobject]@{id=${id};kind=${kind};ok=$true;value=${expression};error=$null}`;
  let body;
  switch (probe.kind) {
    case "file":
      body = push(`[pscustomobject]@{exists=(Test-Path -LiteralPath ${psQuote(probe.path)})}`);
      break;
    case "process":
      body = push(`@(Get-Process -Name ${psQuote(probe.name)} -ErrorAction SilentlyContinue|Select-Object -First 20 Id,ProcessName,MainWindowTitle,Path)`);
      break;
    case "service":
      body = push(`@(Get-Service -Name ${psQuote(probe.name)} -ErrorAction SilentlyContinue|Select-Object Name,Status,StartType)`);
      break;
    case "port":
      body = push(`@(Get-NetTCPConnection -LocalPort ${Number(probe.port)} -ErrorAction SilentlyContinue|Select-Object -First 20 LocalAddress,LocalPort,RemoteAddress,RemotePort,State,OwningProcess)`);
      break;
    case "inner-window": {
      const filter = probe.processName ? `|Where-Object ProcessName -eq ${psQuote(probe.processName)}` : "";
      body = push(`@(Get-Process|Where-Object MainWindowHandle -ne 0${filter}|Select-Object -First 30 Id,ProcessName,MainWindowTitle)`);
      break;
    }
    case "registry":
      body = push(`(Get-ItemPropertyValue -LiteralPath ${psQuote(probe.path)} -Name ${psQuote(probe.name)} -ErrorAction Stop)`);
      break;
    case "app-version":
      body = push(`[pscustomobject]@{path=${psQuote(probe.path)};version=(Get-Item -LiteralPath ${psQuote(probe.path)} -ErrorAction Stop).VersionInfo.FileVersion}`);
      break;
    case "system":
      body = `$cv=Get-ItemProperty -LiteralPath 'HKLM:\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion' -ErrorAction Stop;${push(`[pscustomobject]@{ProductName=$cv.ProductName;DisplayVersion=$cv.DisplayVersion;CurrentBuildNumber=$cv.CurrentBuildNumber;OSArchitecture=[System.Runtime.InteropServices.RuntimeInformation]::OSArchitecture.ToString()}`)}`;
      break;
    case "dns":
      body = push(`@(Resolve-DnsName -Name ${psQuote(probe.host)} -ErrorAction Stop|Select-Object -First 20 Name,Type,IPAddress,NameHost)`);
      break;
    default:
      throw new Error(`Unsupported Windows terminal probe: ${probe.kind}`);
  }
  return `try{${body}}catch{$r+=[pscustomobject]@{id=${id};kind=${kind};ok=$false;value=$null;error=$_.Exception.Message}}`;
}

function normalizeProbes(probes) {
  if (!Array.isArray(probes) || probes.length === 0 || probes.length > 20) {
    throw new Error("Remote terminal evidence requires 1-20 probes");
  }
  const ids = new Set();
  return probes.map((raw, index) => {
    const probe = { ...raw, kind: String(raw?.kind ?? "").trim().toLowerCase(), id: String(raw?.id ?? `probe-${index + 1}`) };
    if (!TERMINAL_KINDS.has(probe.kind)) throw new Error(`Unsupported remote terminal probe kind: ${probe.kind}`);
    if (!/^[A-Za-z0-9._-]{1,64}$/u.test(probe.id) || ids.has(probe.id)) throw new Error(`Invalid or duplicate probe id: ${probe.id}`);
    if (probe.kind === "port" && (!Number.isInteger(Number(probe.port)) || Number(probe.port) < 1 || Number(probe.port) > 65535)) {
      throw new Error(`Invalid port for probe ${probe.id}`);
    }
    for (const field of probe.kind === "file" || probe.kind === "app-version" ? ["path"]
      : probe.kind === "process" || probe.kind === "service" ? ["name"]
        : probe.kind === "registry" ? ["path", "name"]
          : probe.kind === "dns" ? ["host"] : []) {
      if (!String(probe[field] ?? "").trim()) throw new Error(`Probe ${probe.id} requires ${field}`);
    }
    ids.add(probe.id);
    return probe;
  });
}

/** Build one encoded PowerShell command that emits a marker-delimited JSON array. */
export function buildWindowsRemoteEvidenceBatch(probes, options = {}) {
  const normalized = normalizeProbes(probes);
  const statements = normalized.map(probeStatement).join(";");
  const script = `$ProgressPreference='SilentlyContinue';$ErrorActionPreference='Stop';$r=@();${statements};Write-Output '${START_MARKER}';Write-Output ($r|ConvertTo-Json -Compress -Depth 6);Write-Output '${END_MARKER}'`;
  const encodedCommand = Buffer.from(script, "utf16le").toString("base64");
  const executable = String(options.executable ?? "powershell.exe");
  return Object.freeze({
    probes: Object.freeze(normalized.map((item) => Object.freeze(item))),
    script,
    encodedCommand,
    command: `${executable} -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -EncodedCommand ${encodedCommand}`,
    startMarker: START_MARKER,
    endMarker: END_MARKER,
  });
}

/** Parse only the marker-delimited JSON, ignoring prompts and echoed commands. */
export function parseWindowsRemoteEvidenceOutput(output) {
  const text = String(output ?? "");
  const start = text.lastIndexOf(START_MARKER);
  const end = text.indexOf(END_MARKER, start + START_MARKER.length);
  if (start < 0 || end < 0) throw new Error("Remote evidence output markers are missing");
  const json = text.slice(start + START_MARKER.length, end).trim();
  const value = JSON.parse(json);
  return Array.isArray(value) ? value : [value];
}

/** Execute and parse exactly one verified terminal batch; no retry or fallback. */
export async function runWindowsRemoteEvidenceBatch(bridge, probes, options = {}) {
  assertLicensed();
  if (!bridge || bridge.verified !== true || (typeof bridge.execute !== "function" && typeof bridge.runBatch !== "function")) {
    throw new Error("Remote terminal evidence requires a verified bridge with execute or runBatch");
  }
  const plan = buildWindowsRemoteEvidenceBatch(probes, options);
  const started = Date.now();
  const raw = typeof bridge.runBatch === "function"
    ? await bridge.runBatch({ probes: plan.probes, plan })
    : await bridge.execute(plan);
  const results = Array.isArray(raw?.results)
    ? raw.results
    : parseWindowsRemoteEvidenceOutput(raw?.stdout ?? raw?.text ?? raw);
  const expectedIds = new Set(plan.probes.map((probe) => probe.id));
  const returnedIds = new Set(results.map((result) => String(result?.id ?? "")));
  const complete = expectedIds.size === returnedIds.size && [...expectedIds].every((id) => returnedIds.has(id));
  const allOk = complete && results.every((result) => result?.ok === true);
  return {
    ok: allOk,
    verified: allOk,
    complete,
    results,
    failed_ids: results.filter((result) => result?.ok !== true).map((result) => result?.id),
    metrics: {
      sky_calls: Number(raw?.metrics?.sky_calls ?? 0),
      state_captures: Number(raw?.metrics?.state_captures ?? 0),
      screenshots: Number(raw?.metrics?.screenshots ?? 0),
      terminal_batches: 1,
      model_roundtrips: 0,
      automatic_fallbacks: 0,
      duration_ms: Date.now() - started,
    },
  };
}

export async function selfTest() {
  const selection = classifyRemoteEvidenceRoute({
    baselineStateCaptureMs: 3100,
    structuredExecutor: true,
    structuredExecutorMs: 40,
    terminalBatch: true,
    terminalBatchMs: 300,
    stateCapture: true,
    visualCapture: true,
  }, { kind: "process" });
  if (selection.route !== "structured-executor" || selection.inventory_calls !== 0 || selection.estimated_ms_saved !== 3060) {
    throw new Error("zero-probe remote evidence route selection self-test failed");
  }

  const probes = [
    { id: "file-1", kind: "file", path: "C:\\Program Files\\Demo\\demo.exe" },
    { id: "proc-1", kind: "process", name: "demo" },
  ];
  const plan = buildWindowsRemoteEvidenceBatch(probes);
  let terminalCalls = 0;
  const batch = await runWindowsRemoteEvidenceBatch({
    verified: true,
    async execute() {
      terminalCalls += 1;
      return {
        stdout: `prompt>${START_MARKER}\n[{"id":"file-1","kind":"file","ok":true,"value":{"exists":true},"error":null},{"id":"proc-1","kind":"process","ok":true,"value":[],"error":null}]\n${END_MARKER}\nprompt>`,
        metrics: { sky_calls: 2, state_captures: 0 },
      };
    },
  }, probes);
  if (!plan.command.includes("-EncodedCommand") || !batch.ok || !batch.complete || terminalCalls !== 1
      || batch.metrics.terminal_batches !== 1 || batch.metrics.model_roundtrips !== 0) {
    throw new Error("single-batch Windows remote evidence self-test failed");
  }

  let structuredCalls = 0;
  let slowerCalls = 0;
  const router = createRemoteEvidenceRouter({
    baselineStateCaptureMs: 3100,
    structuredExecutor: {
      verified: true,
      kinds: ["process"],
      estimatedMs: 10,
      async execute() { structuredCalls += 1; return { verified: true, value: "ok", metrics: { state_captures: 0 } }; },
    },
    terminalBridge: {
      verified: true,
      estimatedMs: 100,
      async execute() { slowerCalls += 1; throw new Error("slower route should stay idle"); },
    },
  });
  const collected = await router.collect({ kind: "process", name: "demo", verify: (result) => result.value === "ok" });
  if (!collected.ok || collected.route !== "structured-executor" || structuredCalls !== 1 || slowerCalls !== 0
      || collected.metrics.attempted_routes !== 1 || collected.metrics.automatic_fallbacks !== 0) {
    throw new Error("single-route no-fallback evidence router self-test failed");
  }

  let failureFallbackCalls = 0;
  const failureRouter = createRemoteEvidenceRouter({
    structuredExecutor: {
      verified: true, kinds: ["process"], estimatedMs: 5,
      async execute() { throw new Error("fast-route-failed"); },
    },
    terminalBridge: {
      verified: true, estimatedMs: 50,
      async execute() { failureFallbackCalls += 1; return { results: [] }; },
    },
  });
  let fastFailureReturned = false;
  try { await failureRouter.collect({ kind: "process", name: "demo" }); } catch (error) {
    fastFailureReturned = /fast-route-failed/u.test(String(error?.message));
  }
  const nextAfterFailure = failureRouter.inspect({ kind: "process", name: "demo" });
  const strictBudget = classifyRemoteEvidenceRoute({ stateCapture: true, visualCapture: true }, {
    kind: "ui", maxEstimatedMs: 100, baselineStateCaptureMs: 3100,
  });
  if (!fastFailureReturned || failureFallbackCalls !== 0 || nextAfterFailure.route !== "terminal-batch"
      || strictBudget.ok || strictBudget.automatic_fallbacks !== 0) {
    throw new Error("route failure cascaded or strict latency ceiling was ignored");
  }
  return "self-test: ok";
}

function isCliEntryPoint() {
  if (typeof process === "undefined" || !process.argv?.[1]) return false;
  try {
    return realpathSync(fileURLToPath(import.meta.url)) === realpathSync(process.argv[1]);
  } catch {
    return fileURLToPath(import.meta.url) === process.argv[1];
  }
}

if (isCliEntryPoint()) {
  if (process.argv.includes("--self-test")) console.log(await selfTest());
  else console.log("Usage: node remote_evidence.mjs --self-test");
}
