# OpenClaw adapter

Use the current OpenClaw session's approved skills and tools for browser, desktop, accessibility, filesystem, or connectors.

- Map the core loop to the available tool semantics: current observation -> one bounded action -> refreshed observation -> explicit postcondition.
- Apply the shared single-pass default on local and remote routes: inventory effective state and override layers once, batch backed-up idempotent changes, reload/restart once, run one functional test, then clean task-owned artifacts and restore the visible window state.
- On Windows, resolve native/CMD launchers before `.ps1`, use long collision-checked PowerShell helper names, wait before fallback launches, preflight long remote ASCII/IME input, and distinguish `environment_gap` from an executed workflow failure.
- Keep browser and desktop work in the same host session where possible; do not recreate a controller after every step.
- Prefer DOM/accessibility and direct value setting before visual coordinates. Read the selected surface fragment for platform details.
- Do not use Codex-specific `sky` or the Node helper. Use shared Python helpers only when local execution is enabled and appropriate.
- Consequential actions remain subject to OpenClaw and user confirmation policy.
- Run the existing tool registry through `scripts/capability_router.py` once, then keep the selected route for the task. Do not probe a GUI merely to discover capabilities.
- Use existing action results for eligible terminal verification, lightweight window/process checks for lifecycle waits, and milestone-only `operator_state.py` checkpoints for interruption recovery.
