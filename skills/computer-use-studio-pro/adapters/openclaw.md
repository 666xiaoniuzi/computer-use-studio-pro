# OpenClaw adapter

Use the current OpenClaw session's approved skills and tools for browser, desktop, accessibility, filesystem, or connectors.

- Map the core loop to the available tool semantics: current observation -> one bounded action -> refreshed observation -> explicit postcondition.
- Keep browser and desktop work in the same host session where possible; do not recreate a controller after every step.
- Prefer DOM/accessibility and direct value setting before visual coordinates. Read the selected surface fragment for platform details.
- Do not use Codex-specific `sky` or the Node helper. Use shared Python helpers only when local execution is enabled and appropriate.
- Consequential actions remain subject to OpenClaw and user confirmation policy.
