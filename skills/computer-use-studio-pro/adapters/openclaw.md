# OpenClaw adapter

Use the current OpenClaw session's approved skills and tools for browser, desktop, accessibility, filesystem, or connectors.

- Map the core loop to the available tool semantics: current observation -> one bounded action -> refreshed observation -> explicit postcondition.
- Keep browser and desktop work in the same host session where possible; do not recreate a controller after every step.
- Prefer DOM/accessibility and direct value setting before visual coordinates. Read the selected surface fragment for platform details.
- Do not use Codex-specific `sky` or the Node helper. Use shared Python helpers only when local execution is enabled and appropriate.
- Consequential actions remain subject to OpenClaw and user confirmation policy.
- Run the existing tool registry through `scripts/capability_router.py` once, then keep the selected route for the task. Do not probe a GUI merely to discover capabilities.
- Use existing action results for eligible terminal verification, lightweight window/process checks for lifecycle waits, and milestone-only `operator_state.py` checkpoints for interruption recovery.
