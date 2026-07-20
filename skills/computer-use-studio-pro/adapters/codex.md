# Codex adapter

Use the Codex-approved computer, browser, connector, and file tools only. Read the selected surface fragment as well as the core rules.

On the supported Windows Computer Use runtime, `scripts/sky_fast_path.mjs` is available at `adapters/codex/scripts/sky_fast_path.mjs`. It reuses the approved persistent `sky` control session; it is not a second input driver.

- Start with a compact observation when accessibility data is sufficient; retain raw state only inside the runtime and emit its redacted summary.
- After launch, use `launchAndAwaitReady` with a task-specific expectation. For `type_text`, require a focused editable element and use the strict post-activation stability gate. For ordinary clicks, use the light gate unless instability has been observed.
- `actAndRefresh` requires an explicit expectation. Use `runVerifiedTransaction` only after declaring the sequence local and reversible; refresh/assert after every action.
- The Node helper is Codex-specific. Other adapters must never import it.

For Office bulk text work, the shared `scripts/ooxml_text.py` writes a new copy, verifies it, and should be visually inspected in the target application when the task requires it.
