# Hermes adapter

Use only the computer, browser, accessibility, filesystem, or connector tools registered in the current Hermes installation. A Hermes skill supplies procedure; it does not install a desktop driver by itself.

- Inspect the available tool names and map them to observe, act, refresh, and verify before starting.
- Prefer semantic browser/accessibility operations. Treat screenshots and coordinates as short-lived observations.
- Shared Python helpers in `scripts/` may be used when the host permits local execution; do not use the Codex-only Node helper.
- If a required control tool is absent, fall back to file/API work or ask the user to take over. Do not claim that Hermes can click an unavailable surface.
- Route the already registered tool names through `scripts/capability_router.py` once and cache the result; capability discovery adds no GUI call.
- Reuse current action evidence for final verification and use process/window enumeration for lifecycle-only waits.
- Long tasks may record only verified milestones with `scripts/operator_state.py`; remap the live target after a restart.
