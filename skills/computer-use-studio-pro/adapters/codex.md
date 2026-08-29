# Codex Adapter

Use Codex-approved computer, browser, connector, and file tools. For Windows Computer Use, load the bundled host Computer Use API guidance, then import `adapters/codex/scripts/sky_fast_path.mjs` into the same persistent `node_repl` kernel before the first input. It wraps the approved `sky` object; it is not another input driver.

## One-time startup

```js
if (!globalThis.sky) {
  const { sky } = await import("@oai/sky");
  globalThis.sky = sky;
}
if (!globalThis.cusproFastPath) {
  const path = await import("node:path");
  const os = await import("node:os");
  const { pathToFileURL } = await import("node:url");
  const homeDir = nodeRepl.homeDir || os.homedir();
  const modulePath = path.join(homeDir, ".codex", "skills", "computer-use-studio-pro", "adapters", "codex", "scripts", "sky_fast_path.mjs");
  globalThis.cusproFastPath = await import(pathToFileURL(modulePath).href);
}
if (!globalThis.cusproUsage) {
  globalThis.cusproUsage = globalThis.cusproFastPath.createTaskUsageMeter();
}
```

Use the actual Skill root when installation differs. Reuse both globals for the whole task.

## Compact output discipline

Keep full observations/results in `globalThis`; make `tokenView` the final expression of the same cell so only the compact, redacted envelope reaches the model:

```js
globalThis.last = await globalThis.session.observe("routine");
globalThis.cusproUsage.view(globalThis.last, { maxChars: 900 });
```

Use `maxChars: 400` for stable polling/window state, about `900` for routine decisions, and up to `1800` for ambiguity or recovery. Add `needles` to select only relevant accessibility lines. Keep screenshots only when the next decision needs pixels. Raw state remains available as `globalThis.last.state` for the next action. The meter wraps `tokenView`, accumulates only already emitted compact envelopes, and requires no additional GUI or model call.

Prefer the matching helper, persistent session, signal adapter, and `tokenView`; use raw `sky` only for an uncovered capability or bounded recovery with the same target lease and postcondition.

## Local execution

- Treat an explicit task as continuous authorization for ordinary low-risk reversible local input. Keep host action-time confirmation boundaries for consequential actions.
- Start with compact accessibility. Use lifecycle enumeration for pure window appearance/closure, explicit expectations for actions, and verified transactions only for up to three deterministic reversible steps.
- `runKeyboardBurst` is limited to two or three inputs in one verified stable field: single-line literal typing, Select All, Backspace, or Delete. Require its stability, authorization, boundary, and terminal-verification declarations; use the per-action path otherwise.

## Remote execution

Import `playbook_cache.mjs` beside `sky_fast_path.mjs` once per remote runtime, open `cusproPlaybooks`, and pass it plus the normalized problem/OS/app/version/client/surface context and compact semantic labels to `createPersistentWindowSession`. `initialObserve()` returns the best match in its existing cell; `verifySuccess()` automatically promotes verified semantic steps in its closeout cell.

Create one `createRemoteClientSignalAdapter(clientName, { remoteDeviceId })` and one `createPersistentWindowSession` for the current ToDesk/Sunlogin window. Provide target app/title, exact device ID, task goal, success condition, authorization signal, playbook cache/context, and the adapter's connection/device/stop verifiers. `operationScope` defaults to `entire-bound-device`.

Call `initialObserve()` once. Every input reads the cached gate; live verifiers run on accepted observations/events/reconnect. Wire stop, disconnect, and same-device reconnect to their session methods.

Use `session.observe("routine")` for compact semantic refreshes. Call `markContentChanged()` when an opaque remote canvas changed; use `layout-change`, `failure`, `coordinate`, or `verification` when a screenshot is required. On `STALE_OBSERVATION_LEASE`, refresh the requested surface and remap before input.

Before private input, prepare the expected return state and any deterministic reversible continuation. An approved button/hotkey/client bridge signals completion without a model turn; the same event callback runs:

```js
session.pauseForUserInput("private-input", { returnExpect, steps, settleMs: 350 });
// Later, from the approved local customer-done event callback:
session.signalUserInputComplete({ source: "approved-event" });
globalThis.last = await session.resumeAndContinue();
globalThis.cusproUsage.view(globalThis.last, { maxChars: 400 });
```

The fast path checks the bound window, takes one screenshot-free compact observation, and executes prepared steps only when `returnExpect` matches. It emits no screenshot and saves one model roundtrip on the stable path; mismatch returns compact evidence for diagnosis. `resumeAgentControl()` remains the general visual fallback. Keep full secrets out of model/log output.

Call `session.verifySuccess()` before completion and require `success_verified=true`. The persistent session automatically distills verified semantic actions and promotes the recipe in that same closeout call; cache persistence adds no model turn. If a matched recipe misses its postcondition, call `session.recordMatchedPlaybookFailure()` and resume ordinary diagnosis. Use `noteAttempt(signature, strategy)` and pivot after the repeated-path guard. Keep raw session state in the kernel and return only `tokenView(...)` plus necessary metrics.

For Office bulk text, `scripts/ooxml_text.py` writes and verifies a new copy; inspect it visually when the task requires visual fidelity. Before opening Save As, call `deriveArtifactFileName({ title, task }, { extension: ".docx" })` (or the matching extension), use clipboard paste when remote Unicode direct typing is unreliable, then verify the exact desktop filename. A generic application default is a failed filename postcondition, even when document contents are correct.

## Completion handback and usage

For remote work, finish cleanup, end Agent input, revoke/close the task lease, then minimize or close the bound remote-client window and reveal the host desktop. Reuse the latest valid window lease and a screenshot-free lifecycle/window check; do not add a visual-model turn merely for handback.

Every completion response includes `cusproUsage.report(hostUsage)` output. Pass host usage when Codex exposes `input_tokens`, `output_tokens`, cached-input Tokens, or a total; the report labels those as `host-exact`. If the host omits usage, call `cusproUsage.report()` and label `estimated_compact_view_tokens`, `compact_chars`, `tool_calls`, and `screenshots` as a compact-view estimate rather than an API billing total.
