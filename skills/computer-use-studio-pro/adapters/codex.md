# Codex adapter

Use the Codex-approved computer, browser, connector, and file tools only. Read the selected surface fragment as well as the core rules.

On the supported Windows Computer Use runtime, `scripts/sky_fast_path.mjs` is available at `adapters/codex/scripts/sky_fast_path.mjs`. It wraps the approved persistent `sky` object; it is not a second input driver.

## Mandatory Computer Use startup

Whenever the task will issue Windows Computer Use input, load this adapter and import `sky_fast_path.mjs` before the first input. Loading only the bundled Computer Use API instructions is incomplete. Initialize one `@oai/sky` object and one fast-path module in the same persistent `node_repl` kernel, then reuse both for the entire task:

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
  const modulePath = path.join(
    homeDir,
    ".codex", "skills", "computer-use-studio-pro",
    "adapters", "codex", "scripts", "sky_fast_path.mjs",
  );
  globalThis.cusproFastPath = await import(pathToFileURL(modulePath).href);
}
```

Use the actual loaded Skill directory instead when Codex is configured with a non-default Skill root. Prefer `launchAndAwaitReady`, `observeCompact`, `actAndRefresh`, `runVerifiedTransaction`, `fillEditable`, and `createPersistentWindowSession` over repeated raw action/observation cells. Use raw `sky` calls only for a capability the helper does not wrap or for bounded recovery, and still preserve the same persistent runtime, target lease, compact observation, explicit postcondition, and immediate refresh rules.

For an explicit user task, treat ordinary low-risk reversible inputs across the selected local computer as one continuous task authorization. Do not request approval again for each click, keystroke, window change, or routine verification. Keep consequential actions outside fast transactions and apply the host's action-time confirmation rules.

- Obtain/import the runtime once and keep the same object alive for the task.
- In ordinary local mode, start with a compact observation when accessibility data is sufficient. Use `launchAndAwaitReady` with a task-specific expectation after launching an app.
- In `remote-fast-fix` mode, create one `createPersistentWindowSession` for the current ToDesk/Sunlogin window. Provide `targetApp`, `targetTitleIncludes`, the exact `remoteDeviceId`, `taskScope`, `success`, and either `authorizationGranted: true` or a synchronous `authorizationVerifier`. `operationScope` defaults to `entire-bound-device`, covering every desktop, drive, setting, application, terminal, service, network component, and registry area inside that locked remote device. Add `remoteIdentityIncludes`, `deviceIdExtractor`, `deviceVerifier`, `connectionVerifier`, and `stopSignalVerifier` when the host exposes stronger signals. Call `initialObserve()` once, then reuse the returned session.
- Wire the customer's stop control to `session.emergencyStop(reason)`. A client disconnect must call `session.markDisconnected(reason)` when detected out of band; observation and runtime errors also detect common disconnect states. Both routes revoke input authorization.
- Authorization is a connected-session lease. `session.assertInputAllowed()` reads only cached session state and never calls remote verifiers, so keyboard and pointer actions add no network/vision authorization roundtrip. Remote verifiers run on initial mapping, accepted observations, explicit client events, and reconnect.
- For customer-entered passwords, OTPs, UAC credentials, or private values, call `session.pauseForUserInput(reason)`. It keeps authorization active while blocking Agent input. When the customer is done, call `await session.resumeAgentControl()` to take one fresh observation, remap focus, and resume the same lease.
- Use `session.observe("routine")` for compact semantic refreshes. A semantic change is promoted to one screenshot. For an opaque remote video canvas, call `session.markContentChanged()` after a known transition. Use `layout-change`, `failure`, `coordinate`, or `verification` reasons when a fresh screenshot is required.
- For `type_text`, require a focused editable element and use the strict post-activation stability gate. For ordinary clicks, use the light gate unless instability has been observed.
- `actAndRefresh` requires an explicit expectation. Stable bursts use `runVerifiedTransaction`, or `session.transaction`, only after declaring the sequence local and reversible; the remote session caps them at three actions, reads the cached lease gate before each input, and refreshes/asserts remote state after each action. `allowUnverified` returns `observed-unverified` and never counts as task success.
- Use `session.waitUntil(expect)` for adaptive local polling. After a remote disconnect, call `session.resumeAfterReconnect(newWindow, { reauthorize: true, reason })`; it accepts only the same locked device, captures a fresh complete view, and returns the last verified checkpoint. A device/window switch or emergency stop requires a new session.
- Call `session.verifySuccess()` before completion. The configured `success` condition is evaluated against a fresh verification observation and `snapshot().success_verified` must be true.
- Call `session.noteAttempt(signature, strategy)` after an ineffective path. A `pivot_required` result means the next action must use a different supported diagnosis.
- Retain raw state inside the runtime and emit only the redacted compact summary and useful metrics.
- The Node helper is Codex-specific. Other adapters must never import it.

For Office bulk text work, the shared `scripts/ooxml_text.py` writes a new copy, verifies it, and should be visually inspected in the target application when the task requires it.
