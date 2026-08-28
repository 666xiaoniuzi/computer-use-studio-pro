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
- A failed transaction stops at its first mismatched assertion and reports the completed step count.
- Duplicate-prone actions never retry without durable status/history checks.
- Compact resume output contains no more than four events and eight active retry entries per category.

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
