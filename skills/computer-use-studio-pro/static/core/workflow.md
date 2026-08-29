# Core Workflow

```text
G0-CONTRACT -> G1-MAP -> G2-EXECUTE-VERIFY <-> G3-RECOVER -> G4-CLOSE
```

## G0-CONTRACT

Establish the goal, terminal evidence, permitted side effects, risky boundaries, active identity, target surface, and last safe checkpoint. Ask only when a missing choice changes authority or outcome.

## G1-MAP

Map only the current interaction region. Choose the first safe route in the router's route ladder. Record the target app/window/display and a `layout_epoch`. Increase the epoch after navigation, modal appearance, focus loss, window movement, zoom/DPI change, display change, or major rerender.

Keep the control runtime and target binding alive. Do not repeatedly initialize or enumerate every application when the verified target window remains valid. For remote mode, match the verified cross-task playbook cache immediately after the first accepted observation in the same local runtime call. Use the best match only to rank hypotheses and choose a separating precheck; a cache miss preserves the ordinary path.

Estimate the route before adding machinery. For one or two ordinary actions with no reusable semantic route, use the native controller unchanged. Do not create run state, tree deltas, or helper transactions that cannot remove a model roundtrip.

## G2-EXECUTE-VERIFY

1. Define one postcondition.
2. Choose the route that reaches it with the fewest model roundtrips and state changes. Prefer a semantic file/API operation or direct value setting over GUI text replacement and click-select-delete-type sequences. For a new user-facing file, derive the final filename from the task goal or internal title before creation, sanitize target-OS-invalid characters, keep the required extension, and include exact-name verification in the postcondition.
3. For one action, combine the action and immediate refresh in the same execution call. For two or more deterministic reversible steps, normally use a locally verified transaction that refreshes and asserts after every action. The only single-terminal-refresh exception is an already-focused, stable, keyboard-only sequence accepted by `runKeyboardBurst`; it requires an explicit no-confirmation-boundary declaration plus final semantic verification or a terminal screenshot for model review.
4. Use bounded local polling for loading or window launch so the model is not called between identical checks. Poll a state condition, not a blind long sleep.
5. Verify with the cheapest reliable evidence and keep only the smallest useful output.
6. Continue on a match; otherwise enter G3.

For remote input, the execution gate also requires cached `session_status=connected`, `authorization_status=active`, `control_owner=agent`, and no latched target-lock event. Read this local gate before every action inside a transaction and before standalone input. Evaluate live connection/device/stop signals at observation and explicit event boundaries instead of adding a remote verification roundtrip to each keyboard or pointer action.

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

For a customer-entered private value, pause Agent input while retaining the lease. Pre-register the expected return state and optional reversible continuation. After a matching explicit completion event, debounce briefly, check the bound window cheaply, take one compact screenshot-free observation, and continue locally only on the expected state. A mismatch returns to G3; a disconnect or target-lock event follows normal recovery.

## G4-CLOSE

Confirm terminal evidence, including the exact semantic name and location of every deliverable. After `success_verified=true`, distill semantic prechecks, steps, postconditions, and rollback into the verified playbook cache in the same closeout call; omit secrets, identities, paths, screenshots, coordinates, handles, and expiring indexes. For remote mode, clean and verify exact task-created nonessential artifacts on the remote side, end Agent input and the task lease, disconnect when the contract calls for it, then clean and verify the local controller side. Minimize or close the remote-client window and reveal the host desktop before reporting. For remote mode, report the result, material side effects, both cleanup states, unresolved takeover points, Token usage, and total wall-clock duration from accepted task contract through verification, cleanup, and host handback. Include start/finish timestamps and `HH:MM:SS.mmm`; prefer exact host input/output/cache counts, otherwise report the in-memory meter's labelled compact-view estimate and basis. Ordinary chat and local completion omit the usage/timing block. Capture the final meter report once after handback and reuse collected metrics so closeout adds no observation or model roundtrip. Never turn an attempted action into a completed result.

## Low-latency observation ladder

1. Reuse the persistent runtime and verified target window; do not enumerate applications again while the binding is valid.
2. Query one property or compact accessibility subtree without a screenshot.
3. For pure window appearance/closure checks, use `waitForWindowListState` instead of paying for screen/accessibility capture.
4. Keep successful straight-line work inside `runVerifiedTransaction`; for an already-focused stable keyboard field, use `runKeyboardBurst` to replace two or three captures with one terminal capture.
5. Compare trees with `ui_delta.py`.
6. Capture the target crop only when semantics are insufficient.
7. Capture the full window only for initial visual mapping, layout change, recovery, terminal visual review, or final verification.
8. Capture all displays only to discover an unknown window or resolve geometry/focus.

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
