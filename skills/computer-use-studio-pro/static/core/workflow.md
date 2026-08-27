# Core Workflow

```text
G0-CONTRACT -> G1-MAP -> G2-EXECUTE-VERIFY <-> G3-RECOVER -> G4-CLOSE
```

## G0-CONTRACT

Establish the goal, terminal evidence, permitted side effects, risky boundaries, active identity, target surface, and last safe checkpoint. Ask only when a missing choice changes authority or outcome.

## G1-MAP

Map only the current interaction region. Choose the first safe route in the router's route ladder. Record the target app/window/display and a `layout_epoch`. Increase the epoch after navigation, modal appearance, focus loss, window movement, zoom/DPI change, display change, or major rerender.

Keep the control runtime and target binding alive. Do not repeatedly initialize or enumerate every application when the verified target window remains valid.

Estimate the route before adding machinery. For one or two ordinary actions with no reusable semantic route, use the native controller unchanged. Do not create run state, tree deltas, or helper transactions that cannot remove a model roundtrip.

## G2-EXECUTE-VERIFY

1. Define one postcondition.
2. Choose the route that reaches it with the fewest model roundtrips and state changes. Prefer a semantic file/API operation or direct value setting over GUI text replacement and click-select-delete-type sequences.
3. For one action, combine the action and immediate refresh in the same execution call. For two or more deterministic reversible steps, use a locally verified transaction that refreshes and asserts after every action, then returns only the compact final state.
4. Use bounded local polling for loading or window launch so the model is not called between identical checks. Poll a state condition, not a blind long sleep.
5. Verify with the cheapest reliable evidence and keep only the smallest useful output.
6. Continue on a match; otherwise enter G3.

For remote input, the execution gate also requires `session_status=connected`, `authorization_status=active`, and a matching window/device lock. Evaluate the gate before every action inside a transaction as well as before standalone input.

Call the model again only for a new decision, unexpected branch, failed assertion, risk boundary, or terminal report. A generic macro without intermediate refresh and assertions is not a verified transaction.

## G3-RECOVER

Classify the failure:

- `STALE` — remap the element/window;
- `DYNAMIC` — wait for a meaningful condition;
- `FOCUS` — reacquire and verify the target field/window;
- `VISION` — crop, zoom, improve contrast, or switch to semantics;
- `BLOCKED` — stop for permissions, authentication, CAPTCHA, network, or missing capability;
- `DIVERGED` — restore the last safe checkpoint or stop before more side effects.

Use: retry once -> refresh state/geometry -> switch route -> restore checkpoint -> request user action. Run the retry guard before repeated attempts.

For a remote disconnect, revoke the current authorization and retain the last verified checkpoint. Reconnect to the same device, obtain fresh authorization, capture a complete view, reconcile committed effects, and continue from the first unmet postcondition. A device switch or emergency stop latches the session in `stopped`.

## G4-CLOSE

Confirm terminal evidence. For remote mode, clean and verify exact task-created nonessential artifacts on the remote side, disconnect the remote client, then clean and verify the local controller side. Report the result, material side effects, both cleanup states, and unresolved takeover points. Never turn an attempted action into a completed result.

## Low-latency observation ladder

1. Reuse the persistent runtime and verified target window; do not enumerate applications again while the binding is valid.
2. Query one property or compact accessibility subtree without a screenshot.
3. Keep successful straight-line work inside `runVerifiedTransaction`; emit only `summary` and `metrics`.
4. Compare trees with `ui_delta.py`.
5. Capture the target crop only when semantics are insufficient.
6. Capture the full window only for initial visual mapping, layout change, or recovery.
7. Capture all displays only to discover an unknown window or resolve geometry/focus.

Request text and screenshot together only when the next decision needs both. Do not re-emit or reprocess an already displayed screenshot.

## Compact run state

For long or measured runs:

```powershell
python scripts/operator_state.py init --state <run>/state.json --task "<goal>" --platform windows
python scripts/operator_state.py set --state <run>/state.json --stage G2-EXECUTE-VERIFY --app "<app>" --window "<window>" --checkpoint "<verified state>" --postcondition "<next evidence>"
python scripts/operator_state.py event --state <run>/state.json --kind verify --summary "<check>" --result ok --roundtrip-ms 320 --observation-chars 900 --compact-chars 240 --model-roundtrips 1 --capture structured
python scripts/operator_state.py guard --state <run>/state.json --signature "<failure>" --strategy "<route>"
python scripts/operator_state.py resolve --state <run>/state.json --signature "<failure>"
python scripts/operator_state.py compact --state <run>/state.json
python scripts/operator_state.py metrics --state <run>/state.json
```

Keep older history on disk. Load only compact state and independently re-observe the live window when resuming. Stored coordinates never survive a session boundary.
