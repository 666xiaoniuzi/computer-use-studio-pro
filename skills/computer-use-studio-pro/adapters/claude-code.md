# Claude Code adapter

First inspect the tools actually configured for this Claude Code session. Claude Code with only shell tools can use file/API routes and the shared Python helpers, but cannot directly operate a desktop application.

- Map browser or desktop MCP tools to the core loop: observe -> one action -> refresh -> explicit postcondition.
- Prefer the browser's DOM/accessibility interface over screenshots; prefer an accessibility-capable desktop tool over coordinates.
- Do not invoke `adapters/codex/scripts/sky_fast_path.mjs`, `sky`, or any Codex-specific API.
- If the task needs a GUI action and no compatible MCP/browser/desktop tool is available, stop and request a tool or user takeover.
- Keep host confirmation rules for consequential actions even if a local helper reports a successful state.
