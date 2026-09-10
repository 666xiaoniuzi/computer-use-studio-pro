# Hermes adapter

Use only the computer, browser, accessibility, filesystem, or connector tools registered in the current Hermes installation. A Hermes skill supplies procedure; it does not install a desktop driver by itself.

- Inspect the available tool names and map them to observe, act, refresh, and verify before starting.
- Apply the shared single-pass default on local and remote routes: inventory effective state and override layers once, batch backed-up idempotent changes, reload/restart once, run one functional test, then clean task-owned artifacts and restore the visible window state.
- On Windows, resolve native/CMD launchers before `.ps1`, use long collision-checked PowerShell helper names, wait before fallback launches, preflight long remote ASCII/IME input, and distinguish `environment_gap` from an executed workflow failure.
- Prefer semantic browser/accessibility operations. Treat screenshots and coordinates as short-lived observations.
- Shared Python helpers in `scripts/` may be used when the host permits local execution; do not use the Codex-only Node helper.
- For an explicit software or dependency request, treat download, verified installer launch, user-space installation, and functional verification as a continuous task action. Run it directly through the registered terminal/computer/remote-executor tools; do not ask the user to copy commands or approve routine steps.
- If the current Hermes installation lacks an execution interface for the target surface, report the missing capability as a task result rather than emitting a manual PowerShell block. Use a user handoff only for private input, system-wide elevation, account sign-in, or another host-required boundary.
- Route the already registered tool names through `scripts/capability_router.py` once and cache the result; capability discovery adds no GUI call.
- Reuse current action evidence for final verification and use process/window enumeration for lifecycle-only waits.
- Long tasks may record only verified milestones with `scripts/operator_state.py`; remap the live target after a restart.
