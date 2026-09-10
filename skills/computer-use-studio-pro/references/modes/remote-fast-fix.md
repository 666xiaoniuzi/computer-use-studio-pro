# Remote Fast Fix Mode

Load this profile only when another computer is being operated through a visible remote client. It extends the single Computer Use Studio Pro runtime; it does not create another planner or input driver.

## Session contract

Establish once before input:

```text
client/window | exact customer device ID | entire-bound-device | concrete goal | success evidence | authorization/takeover boundary
```

Default operation scope is `entire-bound-device`: every desktop, drive, setting, application, terminal, service, network component, and registry area inside the locked device. The requested result is the completion boundary. Default autonomous mutation budget is reversible `L1`, 20 mutations, 30 minutes, and two attempts per identical `failure signature + strategy`; named software acquisition, dependency bootstrap, and user-space installation are included in this default. Host confirmation rules apply only at higher-impact boundaries.

## One-session fast path

1. Initialize one approved runtime and keep it warm.
2. Bind one ToDesk, Sunlogin, RustDesk, AnyDesk, or TeamViewer window by app, returned handle, stable title cue, and exact customer device ID. Reuse the already bound handle when duplicate titles exist, and foreground it before the first observation/input; the host user does not prepare the desktop by clicking the remote-client window. Reject a collapsed/toolbar-only candidate before input; never type the device ID to discover or select the target.
3. Capture one complete initial view, or reuse the already-current full observation used to select the window. Record client state, device identity cue, usable canvas geometry, visible modal, remote OS, and first useful symptom.
4. Activate one connected-session authorization lease only after connected state and exact-device evidence pass.
5. In the same cell as the first accepted observation, match the local verified-playbook cache using problem class, OS/app version buckets, remote client, and surface. Use at most the best compact candidate to prioritize the first separating precheck; a miss follows the ordinary path.
6. Prefer current evidence. When a verified executor/terminal bridge exists, load [evidence-routing.md](../remote/evidence-routing.md) and select one call-free route; otherwise use compact accessibility, outer-window enumeration, or pixels. On an opaque canvas, `remoteText` selects the lower-call verified transport and takes one terminal screenshot.
7. Define one postcondition; execute one reversible action or an eligible verified transaction; refresh and assert locally. When creating a deliverable, choose its task/title-derived final filename first and verify that exact name and extension after save.
8. Return to the model only for a new decision, mismatch, confirmation boundary, recovery choice, or final verification.

For Codex, use `createRemoteClientSignalAdapter` and `createPersistentWindowSession` from `sky_fast_path.mjs`. Feed the signal adapter's synchronous connection/device/stop verifiers to the session. This classifies stable client state inside JavaScript instead of spending a model turn on unchanged text.

## Token-efficient state

Keep raw observations and verbose history inside the runtime. End each execution cell with `tokenView(result, { maxChars })`:

- `400`: stable polling, window lifecycle, or unchanged state;
- `900`: normal diagnosis and verification;
- `1800`: new branch, ambiguity, or recovery.

Keep only this rolling ledger in model context:

```text
symptom | current hypothesis | last verified action/result | rollback head | next postcondition | takeover boundary
```

Retain at most four unresolved/recent events. Use `needles` to select relevant tree lines. Request text or pixels only as needed; take a complete screenshot again for layout/resolution change, failed assertion, coordinate remap, reconnect, or terminal visual proof.

## Verified cross-task playbook cache

On Codex, attach `playbook_cache.mjs` to the persistent session. `initialObserve()` returns the best redacted semantic match in its existing cell; `verifySuccess()` automatically records verified steps and promotes the second identical success to `trusted`. A missed cached postcondition records failure and returns to normal diagnosis; repeated failures retire it. Device/account/secret/path/pixel/window/index data never enters the cache. Read [verified-playbook-cache.md](../remote/verified-playbook-cache.md) only for cache review.

## Authorization, target lock, and handoff

- Each input reads only cached state: `connected`, authorization active, `control_owner=agent`, and no latched stop. Remote verifiers run at initial mapping, accepted observations, explicit client events, and reconnect rather than before every input.
- After initial binding, a temporarily hidden device ID retains the established baseline. A newly visible conflicting labeled device ID, wrong window/app/title, emergency stop, or target-lock mismatch latches `stopped` and revokes input.
- A disconnect revokes the lease and freezes mutations. Reconnect only to the same device, obtain fresh authorization, capture a complete view, reconcile committed effects, and continue from the first unmet postcondition.
- Before private input, pause with `returnExpect` and optional reversible continuation. Present `surface="remote-client"` for input inside the customer computer; present `surface="codex"` with a concrete instruction when the host must click, approve, choose, or type in Codex. Change ownership only after that foreground activation succeeds. An approved non-model completion event calls `signalUserInputComplete` then `resumeAndContinue`: short debounce, cheap binding check, remote-client reactivation, one screenshot-free 400-character observation, and continuation only on a match. Stable success preserves the lease and saves one model roundtrip; mismatch returns compact evidence.

### API acquisition after customer handoff

Use this fixed sequence to avoid extra planning turns:

```text
open provider console -> pre-register return state -> pause for password/OTP/payment
-> customer-done event -> compact resumeAndContinue -> create/configure/test API key
-> report masked key fingerprint/status -> clear task clipboard and temporary traces
```

If the provider displays a secret once, keep the full value inside the approved private input/runtime path. The customer may perform the secret copy/paste during takeover when that is the available private path. The Agent handles navigation, key creation, configuration, testing, and cleanup after handback. Never emit the full secret into model text, logs, screenshots retained as artifacts, or persistent task state.

## Operating loop

1. Confirm remote input forwarding and target binding. Keep client connection fields/control bars separate from the remote desktop data plane.
2. Run one short read-only feasibility batch before downloads or edits: current OS, installed state, requested application's actual capability, dependency path, success test, and all effective override layers. For command-line/API/model tools, include command/version, process environment, application config, selector/launcher config, auth-store metadata, and startup/user environment without returning secret values. Classify the fault as `remote-input`, `network`, `account/auth`, `permissions`, `app/version`, `configuration`, or `resource/storage`; separately label a missing command/dependency as `environment_gap` rather than `workflow_failure`.
3. Rank at most three supported hypotheses and choose the cheapest separating check.
4. Back up the exact touched values and perform one idempotent low-risk repair batch or verified stable transaction against an explicit postcondition. Avoid sequential trial edits when the inventory already exposes multiple precedence layers.
5. Reload/restart once and run one real functional test. Verify its structured output, exit code, log, or marker through the terminal/evidence bridge when available; request another observation only when evidence is missing or may have changed. On an opaque canvas, do not rerun a successful test solely for accessibility recognition. On the second unchanged attempt, pivot.
6. Require `session.verifySuccess()` and `success_verified=true` before cleanup. Eligible terminal evidence is reused, saving one state capture.

Use a 12-minute soft decision budget for a known configuration repair and a 20-minute budget for a routine fresh user-space installation. At the boundary, emit the compact failure signature and change diagnostic strategy. Keep a separate active-execution meter; call `pauseActive(category)` and `resumeActive()` around disconnect, customer takeover, host-limit waits, and other explicit external waits.

Read [rapid-playbook.md](../remote/rapid-playbook.md) only for the active diagnostic branch.

## Input and recovery discipline

- Keep local and remote apps, filesystems, accounts, clipboard state, and logs distinct.
- Prefer accessibility/direct value setting. Pointer actions use coordinates from the current window/observation lease.
- Before typing, activate and focus the bound target. `session.remoteText(...)` uses verified clipboard for ASCII only when its declared `estimatedSkyCalls` is lower; an unknown cost keeps key events. Unicode/layout needs use clipboard. Before a long opaque-canvas ASCII burst, run `prepareRemoteAsciiInput(...)` through the session-supplied `imePreflight`: send the short marker, toggle Shift once after a mismatch, and reuse success only until `layout_epoch` changes. Exact checks are case-sensitive, known Caps Lock changes only key mapping, and selection adds zero calls.
- On Windows, select `.exe`/`.com`/`.cmd`/`.bat` launchers ahead of `.ps1`. PowerShell batch helper functions use collision-resistant `__Cusp_*` names after a case-insensitive `Get-Command` preflight. After a primary terminal/app launch, wait for its window and do one final race-closing list check before starting a fallback.
- Device IDs remain in the control-plane fingerprint only. Application searches, addresses, settings, and documents receive task payloads only.
- Rebind after window/display/DPI/zoom/remote-resolution changes. On `STALE_OBSERVATION_LEASE`, refresh and remap; do not replay the expired action object.
- Use `waitUntil` for bounded adaptive polling only when no terminal bridge exists. When the device exposes a PowerShell/Windows terminal, prefer the single-batch bridge with `wait-file`/`wait-process`/`wait-service`/`wait-port` probes (bounded in-batch timeout, `timed_out_ids` on expiry), so download/install/ready waits are one bridge call instead of repeated GUI reads; mark an opaque video canvas changed after a known transition.
- Prefer control-scoped verification when the accessibility tree exposes element values: postconditions may bind `elementIndex` with `elementValueEquals`/`elementValueIncludes`/`elementLabelIncludes`, and `fillEditable(..., { strategy: "direct" })` verifies the element's own tree line by default.
- If the customer moves the mouse or types outside a deliberate handoff, refresh and incorporate the new state.

## Risk checkpoints

| Tier | Examples | Handling |
| --- | --- | --- |
| `L0` | State, logs, network/process/port checks | Execute within scope. |
| `L1` | Restart app, clear task cache, reversible app setting, verified download, user-space install/update, dependency bootstrap | Save original state, execute within the task, verify, and roll back a failed hypothesis. |
| `L2` | System-wide installer, proxy/VPN/service/registry/system change | Apply the host confirmation boundary immediately before mutation. |
| `L3` | Password, OTP/API key, account/security permission, UAC | Pause for customer/private-input path, then remap and continue. |
| `L4` | Broad deletion, reset, reimage, disk formatting | Keep outside the autonomous mutation budget and present the exact pending step. |

Push a restore action before each reversible mutation. Freeze on connection loss, target mismatch, abnormal screen state, exhausted budget, or stop signal.

## Artifact cleanup and close

Track only files created by this task, separately for local controller and remote device. Create a task-owned temporary root only when needed. Classify each created path as `temporary`, `abandoned/duplicate`, `rollback`, or `deliverable`; record whether it existed before the task.

Close in this order:

1. Verify functional success and freeze new mutations.
2. Preserve deliverables, installed/configured results, pre-existing files, committed source changes, and rollback material still needed.
3. While connected, use `task_artifacts.py plan-remote` to obtain exact task-root candidates, remove them in one remote file/terminal batch, verify each path is absent, and record the results with `apply-remote-results`. Do not scan the full device.
4. End Agent input and revoke/close the task lease. Disconnect only when the task contract calls for it; otherwise leave the customer deliverable in a stable state.
5. Remove and verify the same classes under the local task root. Use `scripts/task_artifacts.py` when local working files exist; any untracked remainder is `cleanup_pending`.
6. Minimize or close the remote-client window, then foreground the host task surface; the Codex adapter calls `session.presentUserSurface("codex")`. Use the latest bound handle or one cheap `list_windows` plus `activate_window`; take no screenshot/state capture for this handback.
7. After Codex is visible, capture one final meter report and show the visible outcome, exact deliverable name/path, root cause, 1-3 changes, fresh verification, masked API status when applicable, both cleanup states, Token usage, start/finish timestamps, total wall-clock duration, and active execution duration in `HH:MM:SS.mmm`. Prefer exact host totals; otherwise label the compact-view estimate and show its basis. Wall clock includes handoff, reconnect, download, and wait time; active execution excludes explicitly recorded disconnect, customer takeover, host-limit wait, and other external-wait intervals.

Never clean broad user folders, application/system caches, historical logs, ambiguous paths, or pre-existing content as part of task cleanup.
