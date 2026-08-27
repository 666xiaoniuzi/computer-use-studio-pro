# Codex adapter

Use the Codex-approved computer, browser, connector, and file tools only. Read the selected surface fragment as well as the core rules.

On the supported Windows Computer Use runtime, `scripts/sky_fast_path.mjs` is available at `adapters/codex/scripts/sky_fast_path.mjs`. It wraps the approved persistent `sky` object; it is not a second input driver.

- Obtain/import the runtime once and keep the same object alive for the task.
- In ordinary local mode, start with a compact observation when accessibility data is sufficient. Use `launchAndAwaitReady` with a task-specific expectation after launching an app.
- In `remote-fast-fix` mode, create one `createPersistentWindowSession` for the current ToDesk/Sunlogin window. Provide `targetApp`, `targetTitleIncludes`, the exact `remoteDeviceId`, `taskScope`, `success`, and either `authorizationGranted: true` or a synchronous `authorizationVerifier`. Add `remoteIdentityIncludes`, `deviceIdExtractor`, `deviceVerifier`, `connectionVerifier`, and `stopSignalVerifier` when the host exposes stronger signals. Call `initialObserve()` once, then reuse the returned session.
- Wire the customer's stop control to `session.emergencyStop(reason)`. A client disconnect must call `session.markDisconnected(reason)` when detected out of band; observation and runtime errors also detect common disconnect states. Both routes revoke input authorization.
- Use `session.observe("routine")` for compact semantic refreshes. A semantic change is promoted to one screenshot. For an opaque remote video canvas, call `session.markContentChanged()` after a known transition. Use `layout-change`, `failure`, `coordinate`, or `verification` reasons when a fresh screenshot is required.
- For `type_text`, require a focused editable element and use the strict post-activation stability gate. For ordinary clicks, use the light gate unless instability has been observed.
- `actAndRefresh` requires an explicit expectation. Stable bursts use `runVerifiedTransaction`, or `session.transaction`, only after declaring the sequence local and reversible; the remote session caps them at three actions, checks authorization/device/stop state before each input, and refreshes/asserts after each action. `allowUnverified` returns `observed-unverified` and never counts as task success.
- Use `session.waitUntil(expect)` for adaptive local polling. After a remote disconnect, call `session.resumeAfterReconnect(newWindow, { reauthorize: true, reason })`; it accepts only the same locked device, captures a fresh complete view, and returns the last verified checkpoint. A device/window switch or emergency stop requires a new session.
- Call `session.verifySuccess()` before completion. The configured `success` condition is evaluated against a fresh verification observation and `snapshot().success_verified` must be true.
- Call `session.noteAttempt(signature, strategy)` after an ineffective path. A `pivot_required` result means the next action must use a different supported diagnosis.
- Retain raw state inside the runtime and emit only the redacted compact summary and useful metrics.
- The Node helper is Codex-specific. Other adapters must never import it.

For Office bulk text work, the shared `scripts/ooxml_text.py` writes a new copy, verifies it, and should be visually inspected in the target application when the task requires it.
