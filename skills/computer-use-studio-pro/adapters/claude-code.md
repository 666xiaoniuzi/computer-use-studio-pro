# Claude Code adapter

First inspect the tools actually configured for this Claude Code session. Claude Code with only shell tools can use file/API routes and the shared Python helpers, but cannot directly operate a desktop application.

- Map browser or desktop MCP tools to the core loop: observe -> one action -> refresh -> explicit postcondition.
- Prefer the browser's DOM/accessibility interface over screenshots; prefer an accessibility-capable desktop tool over coordinates.
- Do not invoke `adapters/codex/scripts/sky_fast_path.mjs`, `sky`, or any Codex-specific API.
- If the task needs a GUI action and no compatible MCP/browser/desktop tool is available, stop and request a tool or user takeover.
- Keep host confirmation rules for consequential actions even if a local helper reports a successful state.
- Build a tool-name inventory from the already available session metadata and pass it to `scripts/capability_router.py`; do not issue probe actions. Cache the returned connector/file, DOM, accessibility, lifecycle, vision, and input routes for the task.
- Reuse the latest action result for terminal verification when it is current and already contains the required evidence. Window-only waits should use the host's lightweight window/process enumeration rather than a screenshot.
- Use `scripts/operator_state.py` plus milestone-only events for resumable work; ordinary actions stay off the disk-write path.
