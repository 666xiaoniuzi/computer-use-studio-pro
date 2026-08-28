# Latency and Token Evaluation

## What can and cannot be improved

The skill cannot change the model's raw inference speed, network latency, application load time, or the computer-control service's own fixed cost. It can reduce how often those costs are paid.

Use these levers:

1. initialize the approved runtime once and keep its session alive;
2. keep the verified target window/page handle instead of rediscovering every app;
3. choose connectors, DOM, or accessibility before vision;
4. request text or screenshot, not both, unless both are needed;
5. replace multi-step text editing with direct value setting when supported;
6. combine one action and its immediate refresh in one execution call;
7. run bounded loading/window polling locally inside the tool runtime;
8. return UI deltas and compact state instead of whole trees and full history;
9. run deterministic reversible sequences as locally verified transactions that refresh and assert after every action;
10. use semantic OOXML operations for bulk WPS/Office text work, then visually inspect the output only when needed;
11. call the model again only for a new decision, unexpected branch, risk boundary, or failed postcondition.
12. verify app/window appearance or closure with `waitForWindowListState`, avoiding a full state capture when window lifecycle is the complete postcondition;
13. use `runKeyboardBurst` for two or three inputs in one already-focused stable field, paying for one terminal observation instead of one observation per input.
14. classify stable ToDesk/向日葵 connection, device, reconnect, disconnect, and stop signals with `createRemoteClientSignalAdapter` inside the persistent runtime rather than asking the model to reinterpret unchanged client text;
15. reject expired coordinate, focus, and semantic leases before input, paying for recovery only when a reference is actually stale.
16. keep the entrypoint, always-load contract, adapter, and selected profile concise; load detailed core workflow, recovery, and benchmark references only when the current branch needs them;
17. keep full results in the persistent runtime and make `tokenView(result, { maxChars })` the final expression of the same execution cell, avoiding a second tool call and avoiding raw state emission.
18. for customer handback, prepare the expected return state before pausing; let an approved local event call `signalUserInputComplete` and `resumeAndContinue`, combining debounce, binding check, one compact screenshot-free observation, and eligible continuation without another model turn.

Do not reduce latency by reusing stale indexes/coordinates, hiding confirmations, or queueing general unverified GUI macros. `runKeyboardBurst` is the only terminal-only input burst: it requires current focus proof, stable single-field scope, a narrow keyboard vocabulary, an explicit confirmation-boundary declaration, and terminal semantic or visual verification.

## Measure before claiming improvement

Run the same task, same application state, and same terminal evidence at least three times for baseline and optimized modes. Record medians, not the single best run.

Track:

- wall-clock completion time;
- tool roundtrips and summed tool duration;
- full-window, cropped, structured, and all-display captures;
- observation characters as a token proxy;
- compact characters actually emitted to the model;
- actions, verification failures, recoveries, and unknown outcomes;
- successful terminal evidence and accidental side effects.

`observation_chars` is only a proxy. Use the host's real token accounting when it is available.

## Suggested acceptance checks

- Success and side effects must be no worse than baseline.
- The runtime initializes once per healthy session.
- Full-window captures occur only for visual mapping, layout changes, or recovery.
- Stable accessibility tasks avoid screenshot capture.
- A successful straight-line reversible sequence returns to the model once, not once per action.
- An eligible two- or three-input keyboard burst performs exactly one terminal state capture and reports `saved_observations`.
- Window lifecycle verification uses lightweight enumeration and does not capture the screen.
- Stable ToDesk/向日葵 observations are classified by the local signal adapter with no model call; a newly visible conflicting device ID revokes the session.
- An expired input lease produces zero input actions and reports its lease class, age, and maximum age.
- A failed transaction stops at its first mismatched assertion and reports the completed step count.
- Duplicate-prone actions never retry without durable status/history checks.
- Compact resume output contains no more than four events and eight active retry entries per category.
- Routine Codex cells retain raw results in the persistent kernel and emit only `tokenView`; its output excludes the raw `state`, full observation character count, and unredacted secrets.
- Use compact budgets around 400 characters for stable polling, 900 for routine work, and 1800 only for ambiguity or recovery. Raise the budget rather than guessing when the compact state lacks evidence.
- A fast handback accepts no Agent input before an explicit matching completion event, emits no screenshot on the stable path, and saves one model roundtrip. Mismatch performs no prepared continuation and returns compact evidence.

## Advantage gate

Do not call a route optimized unless, across at least three comparable runs:

- successful terminal evidence and side effects are no worse than baseline;
- human interventions are no greater than baseline; and
- median wall-clock time is at least 15% lower, or model roundtrips are at least 25% lower without increasing wall-clock time.

If the gate is not met, use the native controller as the zero-overhead fallback for that task/app pattern and record the failed optimization signature. A Skill invocation is not proof that the optimized route should be used.

Summarize collected metrics with:

```powershell
python scripts/operator_state.py metrics --state <run>/state.json
```

Compare the median task time, roundtrips, capture mix, and observation characters. Report uncertainty and failures, not only the improvement percentage.

## 0.6.0 Windows reference measurement

On 2026-08-27, one local Windows runtime produced these three-run medians:

- text-only `get_window_state`: 3.056 seconds;
- screenshot-only `get_window_state`: 3.153 seconds;
- `list_windows`: 0.018 seconds;
- two literal inputs with a screenshot after each input: 6.305 seconds;
- the same two literal inputs through `runKeyboardBurst` with one terminal screenshot: 3.220 seconds.

The eligible keyboard pattern reduced median wall-clock time by 48.9% while retaining one visible terminal review image. Treat these as a machine/runtime reference rather than a universal service guarantee; repeat the benchmark after runtime, network, display, or remote-client changes.

## 0.7.0 in-process guard reference

On 2026-08-28, five mock-state runs on the same host measured the added local decision cost:

- one ToDesk signal cycle (`connectionVerifier` + `stopSignalVerifier` + `deviceVerifier`): median `0.0148 ms`;
- one observation-lease check: median `0.000105 ms`.

These are synchronous JavaScript microbenchmarks rather than remote end-to-end timings. They show that the new accuracy gates add negligible local overhead relative to the measured `0.018 s` window enumeration and `3.056-3.153 s` state capture. Measure avoided model decisions and recovery captures during real ToDesk/Sunlogin tasks before claiming an end-to-end percentage.

A fresh `node_repl` runtime import plus five real `list_windows` calls on the same date produced one cold call at `1004.98 ms`, followed by warm calls at `15.31`, `14.82`, `14.09`, and `14.84 ms` (warm median `14.83 ms`). Keep the runtime warm; reinitializing it during a task discards this advantage.

## 0.7.1 instruction and result compaction reference

On 2026-08-28, the default Codex/Windows instruction chain was measured as UTF-8 file bytes for `SKILL.md + manifest + always_load + Codex adapter + Windows surface`:

- 0.7.0 local chain: `33,334` bytes;
- 0.7.1 local chain: `18,172` bytes, a `45.5%` reduction;
- 0.7.0 remote chain after adding the remote profile: `48,431` bytes;
- 0.7.1 remote chain: `26,205` bytes, a `45.9%` reduction.

Bytes are an instruction-size proxy rather than provider token billing. Version 0.7.1 replaces the two detailed always-load core files with one compact contract, keeps detailed workflow/recovery files on demand, changes the routine compact-state budget from 1800 to about 900 characters, and adds `tokenView`. The helper keeps raw state inside the persistent kernel while emitting only status, compact redacted evidence, selected metrics, and bounded change/reason text. Its self-test checks that raw `state`, `observation_chars`, full secrets, and excess screenshots do not enter the compact envelope.

## 0.7.2 customer-handback reference

The deterministic mock regression for a signaled customer handback plus one prepared verified action produced zero screenshots, a 400-character-budget `tokenView` of 660 serialized characters, and `model_roundtrips_saved=1`. It also verifies that Agent input remains paused before the matching completion event and that the authorization verifier is not repeated. Real remote latency still includes one current semantic observation and each prepared action's verification refresh.

The default Codex/Windows instruction chains did not grow: local decreased from `18,172` to `18,071` UTF-8 bytes and remote from `26,205` to `26,201`. Thus the new handback capability adds no default instruction-size token proxy. Measure provider billing and real ToDesk/Sunlogin handback latency separately when those counters are available.
