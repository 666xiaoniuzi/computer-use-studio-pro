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
```

Use the actual Skill root when installation differs. Reuse both globals for the whole task.

## Compact output discipline

Keep full observations/results in `globalThis`; make `tokenView` the final expression of the same cell so only the compact, redacted envelope reaches the model:

```js
globalThis.last = await globalThis.session.observe("routine");
globalThis.cusproFastPath.tokenView(globalThis.last, { maxChars: 900 });
```

Use `maxChars: 400` for stable polling/window state, about `900` for routine decisions, and up to `1800` for ambiguity or recovery. Add `needles` to select only relevant accessibility lines. Keep screenshots only when the next decision needs pixels. Raw state remains available as `globalThis.last.state` for the next action.

Preferred helpers: `launchAndAwaitReady`, `observeCompact`, `actAndRefresh`, `runVerifiedTransaction`, `runKeyboardBurst`, `waitForWindowListState`, `fillEditable`, `createPersistentWindowSession`, `createRemoteClientSignalAdapter`, and `tokenView`. Use raw `sky` calls only for an uncovered capability or bounded recovery while preserving the same runtime, target lease, postcondition, refresh, and compact output.

## Local execution

- Treat an explicit task as continuous authorization for ordinary low-risk reversible local input. Keep host action-time confirmation boundaries for consequential actions.
- Start with compact accessibility when sufficient. Use `launchAndAwaitReady` after launching and `waitForWindowListState` when appearance/closure is the whole postcondition.
- `actAndRefresh` requires an explicit expectation. Use `runVerifiedTransaction` only for up to three deterministic local-reversible actions with per-step refresh/assertion.
- `runKeyboardBurst` is limited to two or three inputs in one currently focused stable field: non-empty single-line literal typing (maximum 4096 characters), Select All, Backspace, or Delete. Declare `stabilityConfirmed: true`, `confirmationBoundary: false`, and the applicable `mutationAuthorized`; require `finalExpect` or terminal visual verification. Navigation, pointer input, submission keys, multiline/control characters, uncertain focus, and consequential work use the ordinary verified path.

## Remote execution

Create one `createRemoteClientSignalAdapter(clientName, { remoteDeviceId })` and one `createPersistentWindowSession` for the current ToDesk/Sunlogin window. Provide target app/title, exact device ID, task goal, success condition, authorization signal, and the adapter's connection/device/stop verifiers. `operationScope` defaults to `entire-bound-device`.

Call `initialObserve()` once and reuse the session. Every input reads only its cached connected-session gate. Verifiers run on initial/accepted observations, explicit events, and reconnect. Wire customer stop to `emergencyStop`, out-of-band disconnect to `markDisconnected`, customer credential/payment takeover to `pauseForUserInput`/`resumeAgentControl`, and same-device reconnect to `resumeAfterReconnect(..., { reauthorize: true })`.

Use `session.observe("routine")` for compact semantic refreshes. Call `markContentChanged()` when an opaque remote canvas changed; use `layout-change`, `failure`, `coordinate`, or `verification` when a screenshot is required. On `STALE_OBSERVATION_LEASE`, refresh the requested surface and remap before input.

After a password, OTP, payment approval, UAC, or private-value handoff, `resumeAgentControl()` performs one fresh observation/focus remap and continues the same lease while the target and connection stayed intact. The Agent may then create, configure, and test an API key; emit only masked status and keep the full secret out of model/log output.

Call `session.verifySuccess()` before completion and require `success_verified=true`. Use `noteAttempt(signature, strategy)` and pivot after the repeated-path guard. Keep raw session state in the kernel and return only `tokenView(...)` plus necessary metrics.

For Office bulk text, `scripts/ooxml_text.py` writes and verifies a new copy; inspect it visually when the task requires visual fidelity.
