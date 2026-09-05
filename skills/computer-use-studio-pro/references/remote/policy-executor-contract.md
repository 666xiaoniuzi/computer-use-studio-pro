# Policy Gate and Controlled Executor Contract

Read this reference when a customer-side executor, policy MCP server, or structured remote-repair tool is available or being implemented.

On Codex, adapt an existing verified executor to `remote_evidence.mjs` rather than probing for one during a task. Its route selector is synchronous, uses declared latency/capability metadata, and executes one selected route with no automatic fallback. Visible-client-only Windows checks can instead use its one-process read-only terminal batch.

## Architecture contract

The planner proposes an action. The policy gate returns a decision. The executor runs only an approved action. The verifier evaluates the result independently.

```text
Task Contract -> Planner -> Policy Gate -> Executor -> Verifier
                      ^                         |
                      +---- new evidence -------+
```

The model may propose and interpret actions. Programmatic policy owns allowlists, parameter validation, budgets, confirmation state, rollback requirements, and emergency stop.

## Action request

```json
{
  "task_id": "TASK_ID",
  "target_id": "TARGET_ID",
  "action_id": "ACTION_ID",
  "tool": "ALLOWLISTED_TOOL",
  "arguments": {},
  "evidence_refs": ["EVIDENCE_ID"],
  "hypothesis": "SUPPORTED_CAUSE",
  "risk_level": "L0|L1|L2|L3|L4",
  "expected_result": "CHECKABLE_RESULT",
  "rollback": {
    "tool": "RESTORE_TOOL",
    "arguments": {}
  },
  "verification": {
    "tool": "VERIFY_TOOL",
    "arguments": {}
  }
}
```

## Policy decision

```json
{
  "decision": "allow|confirm|takeover|deny",
  "reason_code": "SCOPE|EVIDENCE|RISK|ROLLBACK|CONNECTION|BUDGET|POLICY",
  "confirmation_id": "OPTIONAL_CONFIRMATION_ID",
  "constraints": {},
  "audit_id": "AUDIT_ID"
}
```

The executor must bind approval to `task_id`, `target_id`, `action_id`, exact tool arguments, expiry, and risk tier. A changed parameter creates a new policy request.

## Recommended executor tools

Expose narrow tools rather than a generic unrestricted shell:

- `collect_system_info`
- `check_network`
- `check_dns_tls`
- `list_processes`
- `check_listening_ports`
- `read_proxy_config`
- `read_application_config`
- `read_recent_logs`
- `restart_application`
- `restart_approved_service`
- `update_application_config`
- `clear_approved_cache`
- `install_approved_package`
- `verify_application`
- `restore_previous_config`

Each mutating tool should support idempotency keys, dry-run where practical, before/after values, timeout, typed error codes, rollback metadata, and an audit ID. Package installation should accept only approved package identifiers and verified sources.

## Gate algorithm

For every mutation, check in order:

1. Target and task IDs match the active task contract.
2. Tool and arguments are allowlisted and schema-valid.
3. Evidence directly supports the hypothesis and proposed action.
4. The action is the smallest useful change.
5. Risk tier is within the task ceiling and active confirmation state.
6. Rollback is defined for reversible mutations and the original state was captured.
7. The action is unlikely to disconnect remote control; otherwise require takeover or a reconnect plan.
8. Time, mutation, retry, and cost budgets remain.
9. Verification is concrete and executable.
10. Emergency stop is clear and has not been triggered.

## Result envelope

```json
{
  "ok": true,
  "changed": true,
  "before": {},
  "after": {},
  "evidence_id": "EVIDENCE_ID",
  "rollback_id": "ROLLBACK_ID",
  "audit_id": "AUDIT_ID",
  "error": null
}
```

The verifier should use a fresh observation or a separate read-only tool call. Treat executor success as transport success until the requested functional result is independently observed.

## Audit privacy

Store task IDs, tool names, normalized parameters, timestamps, risk decisions, result codes, verification, and rollback outcomes. Redact screen contents, customer files, credentials, tokens, personal identifiers, and unrelated telemetry by default.
