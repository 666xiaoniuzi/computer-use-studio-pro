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

Do not reduce latency by reusing stale indexes/coordinates, skipping verification, hiding confirmations, or queueing unverified GUI inputs. A transaction earns its speed by moving repeated refresh-and-check work into the tool runtime, not by omitting it.

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
