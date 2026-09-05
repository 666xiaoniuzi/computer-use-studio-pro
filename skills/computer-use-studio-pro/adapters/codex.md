# Codex Adapter

Use Codex-approved computer, browser, connector, and file tools. For Windows Computer Use, load the bundled host Computer Use API guidance, then import `adapters/codex/scripts/sky_fast_path.mjs` into the same persistent `node_repl` kernel before the first input. It wraps the approved `sky` object; it is not another input driver.

## One-time startup

```js
if (!globalThis.sky) {
  const { sky } = await import("@oai/sky");
  globalThis.sky = sky;
}
if (!globalThis.cusproFastPath) {
  const path = await import("node:path");
  const os = await import("node:os");
  const { pathToFileURL } = await import("node:url");
  const homeDir = nodeRepl.homeDir || os.homedir();
  const modulePath = path.join(homeDir, ".codex", "skills", "computer-use-studio-pro", "adapters", "codex", "scripts", "sky_fast_path.mjs");
  globalThis.cusproFastPath = await import(pathToFileURL(modulePath).href);
}
if (!globalThis.cusproCapabilities) {
  globalThis.cusproCapabilities = globalThis.cusproFastPath.inspectSkyCapabilities(globalThis.sky);
}
if (!globalThis.cusproWarm) {
  globalThis.cusproWarm = await globalThis.cusproFastPath.warmUpRuntime(globalThis.sky);
}
if (!globalThis.cusproUsage) {
  globalThis.cusproUsage = globalThis.cusproFastPath.createTaskUsageMeter();
}
```

`warmUpRuntime` pays the cold-start tax once with a single cheap `list_windows` (measured from roughly `1004.98 ms` cold to `14.83 ms` warm), before the first task decision; it performs no state capture, adds no model roundtrip, and a failure is non-blocking.

Use the actual Skill root when installation differs. Reuse these globals for the whole task. Capability negotiation is synchronous and adds no Computer Use call. When a task is classified as `remote-fast-fix`, call `globalThis.cusproUsage.startTask()` exactly once as soon as its compact task contract is accepted and before the first remote observation or input; this resets prior counters and establishes the wall-clock start.

For long or interruption-prone work, import adjacent `runtime_checkpoint.mjs`, open one store with a task ID, and pass it as `checkpointStore`. Milestones queue compact local writes without awaiting them in the GUI hot path. Flush at customer pause/recovery/close; after a process restart load the checkpoint, remap the window, and obtain a fresh connected-session authorization before continuing.

## Compact output discipline

Keep full observations/results in `globalThis`; make `tokenView` the final expression of the same cell so only the compact, redacted envelope reaches the model:

```js
globalThis.last = await globalThis.session.observe("routine");
globalThis.cusproUsage.view(globalThis.last, { maxChars: 900 });
```

Use `maxChars: 400` for stable polling/window state, about `900` for routine decisions, and up to `1800` for ambiguity or recovery. Add `needles` to select only relevant accessibility lines. Keep screenshots only when the next decision needs pixels. Raw state remains available as `globalThis.last.state` for the next action. The meter wraps `tokenView`, accumulates only already emitted compact envelopes, and requires no additional GUI or model call.

Prefer the matching helper, persistent session, signal adapter, and `tokenView`; use raw `sky` only for an uncovered capability or bounded recovery with the same target lease and postcondition.

## Local execution

- Treat an explicit task as continuous authorization for ordinary low-risk reversible local input. Keep host action-time confirmation boundaries for consequential actions.
- Start with compact accessibility. Use lifecycle enumeration for pure window appearance/closure, explicit expectations for actions, and verified transactions only for up to three deterministic reversible steps.
- `fillEditable(..., { strategy: "direct" })` defaults to control-scoped verification: the value must appear on that element's own accessibility tree line (`elementIndex` + `elementValueIncludes`), not merely anywhere in the document. Pass an explicit `expect` when a document-level check is intended.
- `runKeyboardBurst` is limited to two or three inputs in one verified stable field: single-line literal typing, Select All, Backspace, or Delete. Require its stability, authorization, boundary, and terminal-verification declarations; use the per-action path otherwise.

## Remote execution

Import `playbook_cache.mjs` beside `sky_fast_path.mjs` once per remote runtime, open `cusproPlaybooks`, and pass it plus the normalized problem/OS/app/version/client/surface context and compact semantic labels to `createPersistentWindowSession`. `initialObserve()` returns the best match in its existing cell; `verifySuccess()` automatically promotes verified semantic steps in its closeout cell.

Create one `createRemoteClientSignalAdapter(clientName, { remoteDeviceId })` and one `createPersistentWindowSession` for the current ToDesk, Sunlogin, RustDesk, AnyDesk, or TeamViewer window. Provide target app/title, exact device ID, task goal, success condition, authorization signal, playbook cache/context, optional checkpoint store, and the adapter's connection/device/stop verifiers. `operationScope` defaults to `entire-bound-device`.

Call `initialObserve()` once. In remote mode it foregrounds the bound ToDesk/Sunlogin-equivalent window before the first observation, so the host user does not need to expose the remote-client window manually. Every input reads the cached gate; live verifiers run on accepted observations/events/reconnect. Wire stop, disconnect, and same-device reconnect to their session methods.

Remote work takes one complete initial screenshot; pixels stay in runtime. The dominant delay is the state-capture call. Remove redundant calls: use `list_windows` for lifecycle, screenshot-free compact state for bounded semantic checks, and `session.remoteCanvasText(...)` for stable opaque-canvas ASCII input. That helper uses cached session gates, key-event forwarding, and exactly one terminal screenshot; it never uses the device ID as task text. Mark opaque-canvas transitions and remap stale leases.

When the target device exposes a PowerShell/Windows terminal, import `remote_evidence.mjs` and create the real execution bridge with `createVisibleClientTerminalBridge(sky, { window, clipboard, verified: true, focusPoint })`, then pass it as `terminalBridge` to `createRemoteEvidenceRouter`. One bridge call pastes the encoded 1-20 probe batch, presses Enter, copies the marker-delimited output, parses it into results, and restores the prior clipboard — zero state captures and zero model roundtrips. Use `wait-file`/`wait-process`/`wait-service`/`wait-port` probes (bounded timeout inside the batch, `timed_out_ids` on expiry) and the `keyboard` probe (CapsLock/NumLock/layout) instead of GUI polling for download/install/ready waits. The caller exposes and keeps the terminal window/pane focused and must confirm that Ctrl+A/Ctrl+C/Ctrl+V work in that terminal.

```js
globalThis.last = await session.remoteCanvasText("https://example.invalid", {
  focusPoint: { x: 420, y: 64 }, // coordinates from the current full screenshot
  focusVerified: true,
  stabilityConfirmed: true,
  confirmationBoundary: false,
  clearExisting: true,
  mutationAuthorized: true,
  submitKey: "Return",
});
globalThis.cusproUsage.view(globalThis.last, { maxChars: 500 });
```

Use this for ordinary visible search/address/edit fields. For Unicode text, use `session.remoteUnicodeText(...)` with a verified local clipboard bridge, clipboard save/restore callbacks, and one terminal screenshot. Do not send raw `type_text` through an opaque remote canvas based only on a local focus guess.

When the target window was selected from an already-current full observation, pass it as `observation`; `initialObserve()` reuses it and saves one state capture. `verifySuccess()` likewise reuses a fresh action-refresh state that already satisfies the terminal condition and screenshot requirement. Set `forceRefresh: true` only when evidence may have changed outside the session.

Before private input, prepare the expected return state and any deterministic reversible continuation. `pauseForUserInput()` presents the selected surface before ownership changes. The default is the bound remote-client window for password/OTP/UAC entry on the remote computer:

```js
await session.pauseForUserInput("private-input", {
  surface: "remote-client",
  instruction: "请在远程电脑中完成当前私密输入，然后点击已完成",
  returnExpect,
  steps,
  settleMs: 350,
});
// Later, from the approved local customer-done event callback:
session.signalUserInputComplete({ source: "approved-event" });
globalThis.last = await session.resumeAndContinue();
globalThis.cusproUsage.view(globalThis.last, { maxChars: 400 });
```

When the host user must click, approve, choose, or type in Codex itself, use a Codex handoff instead. It foregrounds the bound/discovered Codex window before the Agent pauses and records the instruction in the handoff snapshot:

```js
globalThis.handoff = await session.pauseForUserInput("host-action-in-codex", {
  surface: "codex",
  instruction: "请在 Codex 中点击继续，并在完成后发送“继续”",
  presentation: globalThis.hostCodexWindow ? { window: globalThis.hostCodexWindow } : {},
});
```

The fast path checks and reactivates the bound remote window on return, takes one screenshot-free compact observation, and executes prepared steps only when `returnExpect` matches. It emits no screenshot and saves one model roundtrip on the stable path; mismatch returns compact evidence for diagnosis. `resumeAgentControl()` remains the general visual fallback. Keep full secrets out of model/log output. Foreground presentation uses only `list_windows` plus `activate_window` when discovery is needed, or one `activate_window` with a bound handle; it makes zero `get_window_state` calls.

Call `session.verifySuccess()` before completion and require `success_verified=true`. It reuses the current terminal evidence when eligible, avoiding an extra roughly state-capture-sized delay. The persistent session automatically distills verified semantic actions and promotes the recipe in that same closeout call; cache persistence adds no model turn. If a matched recipe misses its postcondition, call `session.recordMatchedPlaybookFailure()` and resume ordinary diagnosis. Use `noteAttempt(signature, strategy)` and pivot after the repeated-path guard. Keep raw session state in the kernel and return only `tokenView(...)` plus necessary metrics.

For Office bulk text, `scripts/ooxml_text.py` writes and verifies a new copy; inspect it visually when the task requires visual fidelity. Before opening Save As, call `deriveArtifactFileName({ title, task }, { extension: ".docx" })` (or the matching extension), use clipboard paste when remote Unicode direct typing is unreliable, then verify the exact desktop filename. A generic application default is a failed filename postcondition, even when document contents are correct.

## Remote completion handback, usage, and duration

For remote work, finish cleanup, end Agent input, revoke/close the task lease, then minimize or close the bound remote-client window and call `await session.presentUserSurface("codex")` before emitting the completion response. This brings the Codex task window to the foreground so the host user sees either the requested prompt or the final result. Reuse a cached `hostCodexWindow` when available; discovery uses one cheap window list and is cached by the session. Do not add a state capture or visual-model turn merely for handback.

After host handback, call `cusproUsage.report(hostUsage)` exactly once and reuse that returned object in the remote completion response. Pass host usage when Codex exposes `input_tokens`, `output_tokens`, cached-input Tokens, or a total; the report labels those as `host-exact`. If the host omits usage, call `cusproUsage.report()` and label `estimated_compact_view_tokens`, `compact_chars`, `tool_calls`, and `screenshots` as a compact-view estimate rather than an API billing total. Always show `started_at`, `finished_at`, `duration_ms`, and `duration_human`; duration is wall-clock time from `startTask()` through verification, cleanup, and visible host handback, including customer takeover and wait/reconnect time.

Show this Token-and-duration block only for `remote-fast-fix` completion. Ordinary conversation and `local` completion reports omit it.
