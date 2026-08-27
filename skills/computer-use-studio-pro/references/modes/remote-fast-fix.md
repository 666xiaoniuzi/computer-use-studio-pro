# Remote Fast Fix Mode

Read this profile only after selecting `mode=remote-fast-fix`. It extends the shared Computer Use Studio Pro workflow; it is not a separate Skill and does not initialize another Computer Use runtime.

## Remote task contract

Before input, establish these fields in one pass:

```text
remote client/window | exact customer device ID | entire-device operation surface | concrete goal
session authorization signal | success evidence | risk ceiling | mutation/time budget | takeover boundary
```

The default operation surface is `entire-bound-device`: all desktops, drives, system settings, applications, terminals, services, network components, and registry areas inside the locked customer computer. Network, proxy, Git, certificates, DNS, or Codex settings mentioned in a prompt are starting hypotheses rather than a subsystem allowlist. Use the concrete requested outcome as the task goal and infer the obvious visible success evidence. When several remote sessions are open or different outcomes imply materially different changes, ask one concise question.

Default operational budget: risk ceiling `L1`, at most 20 remote mutations, 30 minutes, and two attempts for the same `failure signature + strategy`. Host confirmation rules remain active.

## Single-runtime low-latency contract

1. **One runtime:** create or obtain one approved `@oai/sky` object for the task. Reuse its imports and live session through completion.
2. **One window, device, and authorization lease:** bind the current ToDesk/Sunlogin window by app, returned handle, stable title substring, and the exact customer device ID. Activate authorization once after the initial lock passes. Validate live remote signals on accepted observations and client events; each input reads only the cached lease gate.
3. **Lazy profile:** local rules remain the default. Load this file and only the active diagnostic section of [rapid-playbook.md](../remote/rapid-playbook.md) for remote work.
4. **Initial map:** capture one complete initial view of the remote-client window. Record client title, remote-session identity cue, visible modal, connection state, geometry, and the first useful symptom.
5. **Incremental observations:** after the initial map, prefer compact accessibility state, one relevant subtree, or a current crop. Promote a detected semantic change to one screenshot. When the remote client exposes only an opaque video canvas, call `session.markContentChanged()` after a known transition so the next observation includes a screenshot. Capture a new full view for layout/remote-resolution changes, failed assertions, coordinate remapping, connection recovery, or final verification.
6. **Stable bursts:** on one unchanged low-risk page, run one to three deterministic reversible actions in `runVerifiedTransaction`; refresh and assert after every action. Return to the model only after the burst, a mismatch, or a new decision.
7. **Adaptive waits:** use `session.waitUntil(expect)` to poll a visible or semantic condition locally. It begins with a short interval and applies bounded backoff while download, restart, spinner, or network progress remains observable.
8. **Pivot guard:** retry a timing-sensitive path once. When the second attempt has the same failure signature and no meaningful state change, select the next supported hypothesis.
9. **Compact ledger:** retain only `symptom | hypothesis | last action | result` plus the rollback stack and mutation count. Keep verbose raw observations inside the runtime.
10. **Target lock:** validate the bound client window and exact customer device ID during the initial map, every accepted observation, explicit client events, and reconnect. A window, application, title, identity, or device-ID mismatch latches `stopped`, revokes authorization, and ends input for that session.
11. **Continuous authorization lease:** activate authorization only after the initial connected state and device lock pass. Keep it active while the same connection remains intact. The per-input gate is an in-memory status read and does not call authorization, connection, device, or stop verifiers. A customer emergency stop or device-lock violation latches `stopped`; a disconnect moves to `disconnected`. Each transition revokes input authorization immediately.
12. **Reconnect and resume:** reconnect only to the same customer device. Obtain a fresh authorization signal, bind the returned window, capture a complete observation, verify the device ID and connection state, then continue from the last verified checkpoint. Do not replay committed actions.
13. **Customer credential handoff:** call `pauseForUserInput` before the customer types a password, OTP, UAC credential, or private value. Agent input stays paused while the connected lease remains active. Call `resumeAgentControl` after handback; it captures one fresh view and remaps focus without repeating authorization when the connection and target binding stayed intact.

For Codex, use `createPersistentWindowSession` from `adapters/codex/scripts/sky_fast_path.mjs`. Supply `mode`, `window`, `targetApp`, `targetTitleIncludes`, `remoteDeviceId`, `taskScope`, `success`, and an authorization signal. Remote mode defaults `operationScope` to `entire-bound-device`; an explicit value may document a user-selected narrower surface. Wire customer stop to `emergencyStop`, out-of-band disconnect to `markDisconnected`, customer credential takeover to `pauseForUserInput`/`resumeAgentControl`, and same-device reconnection to `resumeAfterReconnect(..., { reauthorize: true })`. Add a device extractor/verifier, connection verifier, stop-signal verifier, identity cue, or target verifier when available.

The session state is one of `connected`, `stalled`, `disconnected`, `connected-unauthorized`, `rebinding`, or `stopped`. Input requires `connected`, `authorization_status=active`, and `control_owner=agent`. During credential handoff, `control_owner=user` pauses Agent input without revoking the lease. `stopped` is latched; continue by creating a new explicitly authorized session. `disconnected` may resume after same-device verification and fresh authorization.

## Direct execution chain

```text
computer-use-studio-pro (remote-fast-fix profile)
  -> one approved Computer Use / @oai/sky runtime
  -> one ToDesk or Sunlogin window lease
  -> remote Windows UI
  -> fresh verification
```

The Skill performs planning, routing, recovery, and verification in the same control loop. Mouse, keyboard, screenshot, window, and accessibility calls come from the single host runtime.

## Fast operating loop

1. Observe the bound remote window and confirm that input forwarding is responsive.
2. Classify the current fault as `remote-input`, `network`, `account/auth`, `permissions`, `app/version`, `configuration`, or `resource/storage`.
3. Rank at most three supported hypotheses. Choose the cheapest check that separates the leading causes.
4. Define the postcondition, perform one low-risk repair or a verified stable burst, and refresh immediately.
5. Compare fresh evidence with the success condition. Continue only from the observed result.
6. Call `session.verifySuccess()` and require `success_verified=true` before cleanup and completion.

Read [rapid-playbook.md](../remote/rapid-playbook.md) only for the active fault branch.

## Remote window and nested-input discipline

- Treat local and remote apps, filesystems, accounts, proxies, processes, clipboard state, and logs as separate systems.
- Prefer accessibility elements and direct value setting. For visual targets, use coordinates relative to the current screenshot and current window lease.
- Before typing, activate the remote client, focus the nested remote field, and verify the focus cue. After typing, verify that the intended remote field visibly contains the value.
- Keep separate bindings for the remote client, its toolbar or dialogs, and local overlays. Rebind after display, DPI, zoom, window, monitor, or remote-resolution changes.
- If the user moves the mouse or types, refresh the current view and incorporate the changed state before continuing.
- For deliberate password/OTP/UAC entry, call `pauseForUserInput`, let the customer finish, then call `resumeAgentControl`; this handoff keeps the connected authorization lease and performs one focus remap on return.
- Shared clipboard is suitable for short ordinary diagnostic text when already enabled. Keep credentials, OTPs, API keys, tokens, and private files out of shared clipboard and logs.

## Risk and recovery

| Tier | Examples | Mode behavior |
| --- | --- | --- |
| `L0` | Read system/app state, logs, network/process/port status | Execute within task scope and budget. |
| `L1` | Restart an app, rebuild a task cache, change an ordinary reversible app setting | Capture original state, execute, verify, restore after a failed hypothesis. |
| `L2` | Install/update software, proxy/VPN/service/registry/system changes | Apply the host confirmation boundary immediately before mutation. |
| `L3` | Credentials, OTP/API keys, account permissions, firewall/security tools, UAC/admin authentication | Hold the current decision screen for user takeover, then remap. |
| `L4` | Broad deletion, reset, reimage, disk formatting | Keep outside the autonomous mutation set and report the exact proposed step. |

Push a restore action onto the rollback stack before each reversible mutation. Freeze mutations on connection loss, target/window switch, device-ID mismatch, abnormal screen state, exhausted budget, or a stop signal. A disconnect revokes authorization. Resume only through same-device reconnection, fresh authorization, a complete observation, and reconciliation with the last verified checkpoint.

## Local and remote task-artifact lifecycle (default)

Use these defaults:

```text
cleanup_mode=task-generated-nonessential
local_cleanup=true
remote_cleanup=true
disconnect_after_remote_cleanup=true
finalize_after_local_cleanup=true
```

“Task-unrelated” means an artifact created during this task that is absent from the requested result and no longer supports verification or rollback. Pre-existing files remain outside this classification even when unrelated to the current task.

### Create and classify

- Read-only tasks create no working directory.
- Immediately before the first generated artifact, create task-scoped roots:
  - local controller: `%TEMP%\\computer-use-studio-pro\\<TASK_ID>\\`;
  - remote computer, when needed: `%TEMP%\\computer-use-studio-pro\\<TASK_ID>\\`.
- Place local screenshots, downloaded bundles, extracted copies, diagnostic exports, scratch logs, patch drafts, duplicate outputs, and failed-attempt files under the local task root. Put the requested final output directly in its user-selected destination.
- Keep one compact two-sided ledger: `side | path | existed_before | created_by_task | class | purpose | cleanup_state`.
- Classify every task-created artifact as:
  - `temporary` — required only while the task is running;
  - `unrelated` — abandoned, duplicate, failed-attempt, superseded, or irrelevant to the final result;
  - `rollback` — retained until functional verification succeeds;
  - `deliverable` — requested output or a file required for the final result.
- Record ownership before creating or overwriting a path. A path with `existed_before=true` stays outside automatic cleanup.
- When local working files exist, use `scripts/task_artifacts.py`. Temporary, unrelated, and rollback cleanup candidates must stay under the task-owned root; a requested deliverable may be tracked at its final destination and is always preserved. Keep the state file outside the artifact root. During `cleanup-local`, pass the original `--local-root`; any untracked remainder produces `cleanup_pending`, and the state is removed only after verified cleanup.

```powershell
python scripts/task_artifacts.py init --state <ledger.json> --task-id <TASK_ID> --local-root <TASK_ROOT>
python scripts/task_artifacts.py cleanup-local --state <ledger.json> --task-id <TASK_ID> --local-root <TASK_ROOT> --task-verified --remove-state
```

### Close sequence

1. Verify the requested functional result and freeze new mutations.
2. Review the ledger. Preserve `deliverable`, pre-existing paths, installed applications/plugins, committed source changes, required configuration, and rollback copies still needed for an unresolved result.
3. While the remote connection is active, close session-opened handles, remove exact remote `temporary` and `unrelated` paths, remove expired task-owned rollback files, then remove the remote task root.
4. Refresh the remote view and record `remote_cleanup=verified`; then disconnect ToDesk/Sunlogin.
5. On the local controller, close session-opened handles and run the local cleanup plan. Remove exact local `temporary` and `unrelated` paths plus expired rollback files, then remove the local task root and ledger state.
6. Verify that all tracked deletion targets are absent. Record `local_cleanup=verified` and only then issue the final completion report.

The cleanup set is limited to positive task ownership. Preserve user files, files existing before the task, requested outputs, source edits that implement the task, installed results, broad Desktop/Documents/Downloads contents, application data, host-managed runtime caches, system caches, historical logs, recycle-bin contents, and every path whose ownership is ambiguous.

For a tracked file held open by a session-started process, close that handle and retry the exact path once. Report any remainder as an exact `local_cleanup_pending` or `remote_cleanup_pending` path list.

## Completion evidence

Accept success only from a fresh remote observation, relevant remote log/tool result, or minimal remote functional test. A clicked button or transport-level success is only an attempt. Completion also requires verified cleanup on both sides or exact pending-path lists.

```text
已处理：<visible outcome>
原因：<root cause or strongest supported cause>
改动：<1-3 concrete changes>
验证：<fresh remote evidence>
清理：remote=verified; local=verified
待清理：remote_cleanup_pending=<exact paths>; local_cleanup_pending=<exact paths>
远程：disconnected after remote cleanup
注意：<only when a retained setting or takeover point matters>
```
