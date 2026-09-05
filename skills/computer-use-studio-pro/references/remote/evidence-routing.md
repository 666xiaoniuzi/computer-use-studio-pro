# Remote Evidence Routing

Load this reference only when a remote verification branch can use an existing structured executor or verified terminal/clipboard bridge. Import `adapters/codex/scripts/remote_evidence.mjs` beside the fast path.

## Speed contract

- Declare capabilities and expected latency before routing; do not probe for a channel.
- `classifyRemoteEvidenceRoute(...)` and `router.inspect(...)` make zero tool, network, state-capture, and model calls.
- `router.collect(...)` executes exactly one selected route. A route error returns to the caller; it never cascades into a slower route.
- The router keeps in-memory EWMA latency by evidence kind/route. A transport failure suppresses that route for the current router, so the next caller decision can select the next declared route without replaying inside the failed call.
- Set `baselineStateCaptureMs` to the measured current path (about 3100 ms on the measured host). A candidate above `maxEstimatedMs` is excluded.
- A supplied fresh state plus a local predicate wins at zero calls. A requested screenshot uses a supplied screenshot or the visual route.

Route order after latency sorting:

```text
fresh current evidence -> verified structured executor -> one terminal batch
-> outer host window list -> accessibility -> state capture -> visual capture
```

Host `list_windows` covers the outer ToDesk/Sunlogin-equivalent window. Remote inner windows use a customer-side executor, the terminal probe, remote accessibility when exposed, or the nested screen.

## Structured executor

Pass a narrow, already verified adapter:

```js
const router = createRemoteEvidenceRouter({
  sky,
  baselineStateCaptureMs: 3100,
  structuredExecutor: {
    verified: true,
    kinds: ["file", "process", "service", "api"],
    estimatedMs: 80,
    execute: (request) => executor.execute(request),
  },
});

const evidence = await router.collect({
  kind: "process",
  name: "TARGET_PROCESS",
  verify: (result) => result.verified === true && result.value.running === true,
});
```

Keep allowlists, schema validation, task/target binding, rollback, confirmation, and audit in the executor policy gate. Router selection does not expand its authority.

## One-batch Windows terminal evidence

`buildWindowsRemoteEvidenceBatch(...)` supports 1-20 read-only probes: `file`, `process`, `service`, `port`, `inner-window`, `registry`, `app-version`, `system`, `dns`, the bounded wait probes `wait-file` / `wait-process` / `wait-service` / `wait-port` (`timeoutMs` up to 300000, `intervalMs` 50-10000, optional `present: false` to invert), and `keyboard` (CapsLock/NumLock/layout of the machine that runs the batch). It emits one UTF-16LE encoded PowerShell command with marker-delimited compact JSON. `runWindowsRemoteEvidenceBatch(...)` executes one verified bridge call and parses only the marked payload; an expired wait probe reports its id in `timed_out_ids` so the caller can decide "not yet" without a GUI capture or model roundtrip.

```js
const result = await runWindowsRemoteEvidenceBatch(verifiedTerminalBridge, [
  { id: "app", kind: "file", path: "C:\\Program Files\\APP\\APP.exe" },
  { id: "proc", kind: "process", name: "APP" },
  { id: "port", kind: "port", port: 8080 },
  { id: "ready", kind: "wait-file", path: "C:\\APP\\ready.txt", timeoutMs: 60000, intervalMs: 500 },
]);
```

## Visible-client terminal bridge

`createVisibleClientTerminalBridge(sky, options)` is the real execution channel for a visible client: it writes the encoded command through a verified clipboard bridge, pastes it with `Control_L+v` into the focused terminal, presses `Return`, then repeatedly selects/copies the buffer (`Control_L+a` / `Control_L+c`) until the output markers appear (bounded copy attempts), parses the JSON, and restores the pre-run clipboard. The whole batch is one bridge call with zero state captures; the caller supplies the focused terminal window (optionally a `focusPoint` from the current screenshot) and must confirm the select/copy/paste keys work in that terminal (Windows Terminal supports Ctrl+A/Ctrl+C/Ctrl+V).

```js
const bridge = createVisibleClientTerminalBridge(sky, {
  window,
  clipboard,          // verified read/write/restore bridge (same contract as remoteUnicodeText)
  verified: true,     // after the operator confirms terminal paste/copy works
  focusPoint,         // optional: { x, y, screenshotId } from the current full screenshot
  estimatedMs: 4000,
});
const router = createRemoteEvidenceRouter({ sky, baselineStateCaptureMs: 3100, terminalBridge: bridge });
const evidence = await router.collect({
  kind: "batch",
  probes: [
    { id: "installed", kind: "file", path: "C:\\Program Files\\APP\\APP.exe" },
    { id: "service", kind: "service", name: "APP" },
    { id: "ready", kind: "wait-port", port: 8080, timeoutMs: 45000, intervalMs: 500 },
  ],
  verify: (result) => result.verified === true,
});
```

A multi-probe request scales the state-capture baseline by the probe count, so one batch compares against the captures it actually replaces. `wait-*`/`keyboard` requests never fall back to a state/screenshot route because only the executor can answer them; when no terminal bridge exists, `router.inspect(...)` reports no eligible route and the caller uses the ordinary observation path (or passes an explicit `maxEstimatedMs` when a single probe still beats the baseline).

## Accuracy

- Provide a local `verify` predicate for the requested functional claim; transport success alone is not task success.
- The terminal parser requires complete unique probe IDs and both output markers, ignoring echoed commands and prompts.
- A partial/error result fails the batch verification and triggers a new caller decision rather than an automatic GUI replay.
- Use exact, case-sensitive field expectations for readable text. For private/opaque fields, verify the resulting state instead of the hidden value.
