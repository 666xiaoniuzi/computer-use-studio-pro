#!/usr/bin/env python3
"""Dependency-free checkpoint, retry, lock, and metric utility for GUI runs."""

from __future__ import annotations

import argparse
import json
import os
import re
import secrets
import tempfile
import time
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path

SCHEMA = 3
STAGES = {"G0-CONTRACT", "G1-MAP", "G2-EXECUTE-VERIFY", "G3-RECOVER", "G4-CLOSE"}
ASSIGNMENT_SECRET = re.compile(
    r"(?i)\b(password|passwd|secret|token|cookie|authorization|api[_-]?key|otp|one[- ]?time code)\b"
    r"\s*[:=]\s*(?:\"[^\"]*\"|'[^']*'|[^\s,;]+)"
)
BEARER_SECRET = re.compile(r"(?i)\bbearer\s+[A-Za-z0-9._~+/=-]{8,}")
PREFIX_SECRET = re.compile(r"\b(?:sk|ghp|github_pat|xox[baprs])[-_][A-Za-z0-9_-]{8,}\b")
EMAIL = re.compile(r"\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b", re.IGNORECASE)
PHONE = re.compile(r"(?<!\d)(?:\+?\d[\d -]{7,}\d)(?!\d)")
MAX_STORED_CHARS = 2_000


def now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def scrub(value: str) -> str:
    value = ASSIGNMENT_SECRET.sub(lambda match: match.group(1) + "=[REDACTED]", value)
    value = BEARER_SECRET.sub("Bearer [REDACTED]", value)
    value = PREFIX_SECRET.sub("[REDACTED]", value)
    value = EMAIL.sub("[REDACTED_EMAIL]", value)
    value = PHONE.sub("[REDACTED_PHONE]", value)
    return value if len(value) <= MAX_STORED_CHARS else value[: MAX_STORED_CHARS - 1] + "…"


def nonnegative_int(value: str) -> int:
    parsed = int(value)
    if parsed < 0:
        raise argparse.ArgumentTypeError("value must be non-negative")
    return parsed


def positive_int(value: str) -> int:
    parsed = int(value)
    if parsed < 1:
        raise argparse.ArgumentTypeError("value must be positive")
    return parsed


def empty_metrics() -> dict:
    return {
        "events": 0,
        "actions": 0,
        "verifications": 0,
        "verification_failures": 0,
        "recoveries": 0,
        "tool_roundtrips": 0,
        "model_roundtrips": 0,
        "tool_duration_ms": 0,
        "observation_chars": 0,
        "compact_chars": 0,
        "human_interventions": 0,
        "captures": {"none": 0, "structured": 0, "crop": 0, "full": 0, "all-displays": 0},
    }


def read(path: Path) -> dict:
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError as error:
        raise SystemExit(f"state file does not exist: {path}") from error
    except json.JSONDecodeError as error:
        raise SystemExit(f"state file is not valid JSON: {path}: {error}") from error
    if not isinstance(data, dict):
        raise SystemExit(f"state file root must be a JSON object: {path}")
    schema = data.get("schema")
    if schema in (1, 2):
        data["schema"] = SCHEMA
        data.setdefault("owner", "")
        metrics = data.setdefault("metrics", {})
        defaults = empty_metrics()
        for key, value in defaults.items():
            if isinstance(value, dict):
                metrics.setdefault(key, {}).update({name: count for name, count in value.items() if name not in metrics.get(key, {})})
            else:
                metrics.setdefault(key, value)
    elif schema != SCHEMA:
        raise SystemExit(f"unsupported state schema: {schema!r}")
    data.setdefault("owner", "")
    data.setdefault("stage", "G0-CONTRACT")
    data.setdefault("app", "")
    data.setdefault("window", "")
    data.setdefault("layout_epoch", 0)
    data.setdefault("checkpoint", "")
    data.setdefault("next_postcondition", "")
    data.setdefault("committed_side_effects", [])
    data.setdefault("pending_boundary", "")
    if not isinstance(data.get("committed_side_effects"), list):
        raise SystemExit(f"state field committed_side_effects must be a list: {path}")
    retry = data.setdefault("retry", {})
    if not isinstance(retry, dict):
        raise SystemExit(f"state field retry must be an object: {path}")
    retry.setdefault("by_pair", {})
    retry.setdefault("by_signature", {})
    if not isinstance(retry["by_pair"], dict) or not isinstance(retry["by_signature"], dict):
        raise SystemExit(f"state retry counters must be objects: {path}")
    metrics = data.setdefault("metrics", {})
    if not isinstance(metrics, dict):
        raise SystemExit(f"state field metrics must be an object: {path}")
    defaults = empty_metrics()
    for key, value in defaults.items():
        if isinstance(value, dict):
            bucket = metrics.setdefault(key, {})
            for name, count in value.items():
                bucket.setdefault(name, count)
        else:
            metrics.setdefault(key, value)
    data.setdefault("events", [])
    if not isinstance(data["events"], list):
        raise SystemExit(f"state field events must be a list: {path}")
    return data


def write(path: Path, data: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    data["updated_at"] = now()
    fd, temporary = tempfile.mkstemp(prefix=path.name + ".", dir=path.parent)
    try:
        with os.fdopen(fd, "w", encoding="utf-8", newline="\n") as handle:
            json.dump(data, handle, ensure_ascii=False, indent=2)
            handle.write("\n")
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


@contextmanager
def locked(path: Path, timeout: float = 5.0, stale_after: float = 60.0, break_stale: bool = False):
    path.parent.mkdir(parents=True, exist_ok=True)
    lock_path = path.with_suffix(path.suffix + ".lock")
    deadline = time.monotonic() + timeout
    token = secrets.token_hex(16)
    while True:
        try:
            descriptor = os.open(lock_path, os.O_CREAT | os.O_EXCL | os.O_WRONLY)
            with os.fdopen(descriptor, "w", encoding="ascii") as handle:
                handle.write(f"pid={os.getpid()} at={time.time()} token={token}\n")
            break
        except FileExistsError:
            try:
                if time.time() - lock_path.stat().st_mtime > stale_after:
                    if not break_stale:
                        raise SystemExit(f"state lock may be stale: {path}; verify the owner stopped, then rerun with --break-stale-lock")
                    lock_path.unlink()
                    continue
            except FileNotFoundError:
                continue
            if time.monotonic() >= deadline:
                raise SystemExit(f"state is busy: {path}")
            time.sleep(0.05)
    try:
        yield
    finally:
        try:
            if f"token={token}" in lock_path.read_text(encoding="ascii", errors="ignore"):
                lock_path.unlink()
        except FileNotFoundError:
            pass


def touch(mapping: dict, key: str, limit: int) -> int:
    count = mapping.pop(key, 0) + 1
    mapping[key] = count
    while len(mapping) > limit:
        mapping.pop(next(iter(mapping)))
    return count


def cmd_init(args: argparse.Namespace) -> None:
    path = Path(args.state)
    with locked(path, break_stale=args.break_stale_lock):
        existed = path.exists()
        if existed and not args.force:
            raise SystemExit(f"state already exists: {path}; pass --force to replace")
        if existed and args.force and not args.confirm_reset_state:
            raise SystemExit("--force requires --confirm-reset-state because it replaces an existing checkpoint")
        timestamp = now()
        data = {
            "schema": SCHEMA,
            "task": scrub(args.task),
            "platform": args.platform,
            "owner": scrub(args.actor or ""),
            "stage": "G0-CONTRACT",
            "app": "",
            "window": "",
            "layout_epoch": 0,
            "checkpoint": "",
            "next_postcondition": "",
            "committed_side_effects": [],
            "pending_boundary": "",
            "retry": {"by_pair": {}, "by_signature": {}},
            "metrics": empty_metrics(),
            "events": [],
            "created_at": timestamp,
            "updated_at": timestamp,
        }
        write(path, data)
    print(json.dumps({"ok": True, "state": str(path), "stage": "G0-CONTRACT"}))


def cmd_set(args: argparse.Namespace) -> None:
    path = Path(args.state)
    with locked(path, break_stale=args.break_stale_lock):
        data = read(path)
        if args.stage and args.stage not in STAGES:
            raise SystemExit(f"invalid stage: {args.stage}")
        for key in ("stage", "app", "window", "checkpoint", "postcondition", "boundary", "actor"):
            value = getattr(args, key, None)
            if value is not None:
                target = {"postcondition": "next_postcondition", "boundary": "pending_boundary", "actor": "owner"}.get(key, key)
                data[target] = scrub(value)
        if args.bump_layout:
            data["layout_epoch"] += 1
        if args.side_effect:
            data["committed_side_effects"].append(scrub(args.side_effect))
            data["committed_side_effects"] = data["committed_side_effects"][-20:]
        write(path, data)
    print(json.dumps(compact(data), ensure_ascii=False))


def cmd_event(args: argparse.Namespace) -> None:
    path = Path(args.state)
    with locked(path, break_stale=args.break_stale_lock):
        data = read(path)
        event = {
            "at": now(),
            "actor": scrub(args.actor or data.get("owner", "")),
            "kind": args.kind,
            "summary": scrub(args.summary),
            "result": args.result,
        }
        if args.evidence:
            event["evidence"] = scrub(args.evidence)
        if args.roundtrip_ms is not None:
            event["roundtrip_ms"] = args.roundtrip_ms
        if args.observation_chars:
            event["observation_chars"] = args.observation_chars
        if args.compact_chars:
            event["compact_chars"] = args.compact_chars
        if args.model_roundtrips:
            event["model_roundtrips"] = args.model_roundtrips
        if args.human_intervention:
            event["human_intervention"] = True
        if args.capture != "none":
            event["capture"] = args.capture
        data["events"].append(event)
        data["events"] = data["events"][-200:]
        metrics = data["metrics"]
        metrics["events"] += 1
        metrics["actions"] += args.kind == "act"
        metrics["verifications"] += args.kind == "verify"
        metrics["verification_failures"] += args.kind == "verify" and args.result != "ok"
        metrics["recoveries"] += args.kind == "recover"
        metrics["observation_chars"] += args.observation_chars
        metrics["compact_chars"] += args.compact_chars
        metrics["model_roundtrips"] += args.model_roundtrips
        metrics["human_interventions"] += int(args.human_intervention)
        metrics["captures"][args.capture] += 1
        if args.roundtrip_ms is not None:
            metrics["tool_roundtrips"] += 1
            metrics["tool_duration_ms"] += args.roundtrip_ms
        write(path, data)
    print(json.dumps({"ok": True, "event_count": len(data["events"])}))


def cmd_guard(args: argparse.Namespace) -> None:
    path = Path(args.state)
    with locked(path, break_stale=args.break_stale_lock):
        data = read(path)
        signature = scrub(args.signature)
        strategy = scrub(args.strategy)
        pair = f"{signature}\u241f{strategy}"
        retry = data["retry"]
        same = touch(retry["by_pair"], pair, 40)
        total = touch(retry["by_signature"], signature, 20)
        decision = "retry" if same < args.max_same else "switch"
        if total >= args.max_total:
            decision = "stop"
        data["stage"] = "G3-RECOVER"
        write(path, data)
    print(json.dumps({"decision": decision, "same_strategy_failures": same, "total_failures": total}))


def cmd_resolve(args: argparse.Namespace) -> None:
    path = Path(args.state)
    with locked(path, break_stale=args.break_stale_lock):
        data = read(path)
        signature = scrub(args.signature)
        data["retry"]["by_signature"].pop(signature, None)
        prefix = signature + "\u241f"
        for key in list(data["retry"]["by_pair"]):
            if key.startswith(prefix):
                data["retry"]["by_pair"].pop(key, None)
        write(path, data)
    print(json.dumps({"ok": True, "resolved": signature}))


def tail(mapping: dict, limit: int = 8) -> dict:
    return dict(list(mapping.items())[-limit:])


def compact(data: dict) -> dict:
    return {
        "stage": data["stage"],
        "owner": data.get("owner", ""),
        "app": data["app"],
        "window": data["window"],
        "layout_epoch": data["layout_epoch"],
        "checkpoint": data["checkpoint"],
        "next_postcondition": data["next_postcondition"],
        "pending_boundary": data["pending_boundary"],
        "committed_side_effects": data["committed_side_effects"][-5:],
        "retry": {
            "by_pair": tail(data["retry"]["by_pair"]),
            "by_signature": tail(data["retry"]["by_signature"]),
        },
        "recent_events": data["events"][-4:],
    }


def cmd_compact(args: argparse.Namespace) -> None:
    print(json.dumps(compact(read(Path(args.state))), ensure_ascii=False, separators=(",", ":")))


def metric_summary(data: dict) -> dict:
    metrics = data["metrics"]
    roundtrips = metrics["tool_roundtrips"]
    model_roundtrips = metrics["model_roundtrips"]
    return {
        **metrics,
        "average_tool_roundtrip_ms": round(metrics["tool_duration_ms"] / roundtrips, 1) if roundtrips else None,
        "observation_chars_per_roundtrip": round(metrics["observation_chars"] / roundtrips, 1) if roundtrips else None,
        "compact_chars_per_model_roundtrip": round(metrics["compact_chars"] / model_roundtrips, 1) if model_roundtrips else None,
    }


def cmd_metrics(args: argparse.Namespace) -> None:
    print(json.dumps(metric_summary(read(Path(args.state))), ensure_ascii=False, indent=2))


def self_test() -> None:
    with tempfile.TemporaryDirectory() as directory:
        path = Path(directory) / "state.json"
        cmd_init(argparse.Namespace(state=str(path), task="demo token=abc owner=user@example.com", platform="windows", actor="agent-a", force=False, confirm_reset_state=False, break_stale_lock=False))
        assert "abc" not in read(path)["task"] and "user@example.com" not in read(path)["task"]
        assert len(scrub("x" * (MAX_STORED_CHARS + 1))) == MAX_STORED_CHARS
        event = argparse.Namespace(
            state=str(path), actor="agent-a", kind="verify", summary="button enabled", result="ok",
            evidence="enabled=true", roundtrip_ms=250, observation_chars=800, compact_chars=120,
            model_roundtrips=1, human_intervention=False, capture="structured", break_stale_lock=False
        )
        cmd_event(event)
        guard = argparse.Namespace(state=str(path), signature="missing-button", strategy="uia", max_same=2, max_total=5, break_stale_lock=False)
        cmd_guard(guard)
        cmd_guard(guard)
        assert read(path)["retry"]["by_signature"]["missing-button"] == 2
        cmd_resolve(argparse.Namespace(state=str(path), signature="missing-button", break_stale_lock=False))
        data = read(path)
        assert "missing-button" not in data["retry"]["by_signature"]
        assert metric_summary(data)["average_tool_roundtrip_ms"] == 250.0
        assert metric_summary(data)["compact_chars_per_model_roundtrip"] == 120.0
        assert not path.with_suffix(".json.lock").exists()
        stale_lock = path.with_suffix(".json.lock")
        stale_lock.write_text("pid=unknown token=old\n", encoding="ascii")
        os.utime(stale_lock, (time.time() - 120, time.time() - 120))
        try:
            with locked(path, stale_after=1):
                pass
        except SystemExit:
            pass
        else:
            raise AssertionError("stale lock was removed without explicit recovery")
        with locked(path, stale_after=1, break_stale=True):
            pass
        assert not stale_lock.exists()
        forced_new = Path(directory) / "forced-new.json"
        cmd_init(argparse.Namespace(state=str(forced_new), task="demo", platform="other", actor=None, force=True, confirm_reset_state=False, break_stale_lock=False))
        assert forced_new.exists()
        malformed = Path(directory) / "malformed.json"
        malformed.write_text("{", encoding="utf-8")
        try:
            read(malformed)
        except SystemExit as error:
            assert "not valid JSON" in str(error)
        else:
            raise AssertionError("malformed state was not rejected")
        wrong_root = Path(directory) / "wrong-root.json"
        wrong_root.write_text("[]", encoding="utf-8")
        try:
            read(wrong_root)
        except SystemExit as error:
            assert "root must be a JSON object" in str(error)
        else:
            raise AssertionError("non-object state was not rejected")
        wrong_retry = Path(directory) / "wrong-retry.json"
        wrong_retry.write_text(json.dumps({"schema": SCHEMA, "retry": []}), encoding="utf-8")
        try:
            read(wrong_retry)
        except SystemExit as error:
            assert "retry must be an object" in str(error)
        else:
            raise AssertionError("invalid retry state was not rejected")
    print("self-test: ok")


def parser() -> argparse.ArgumentParser:
    root = argparse.ArgumentParser(description=__doc__)
    root.add_argument("--self-test", action="store_true")
    root.add_argument("--break-stale-lock", action="store_true")
    sub = root.add_subparsers(dest="command")
    init = sub.add_parser("init")
    init.add_argument("--state", required=True)
    init.add_argument("--task", required=True)
    init.add_argument("--platform", choices=("windows", "macos", "linux", "browser", "other"), default="other")
    init.add_argument("--actor")
    init.add_argument("--force", action="store_true")
    init.add_argument("--confirm-reset-state", action="store_true")
    init.set_defaults(func=cmd_init)
    set_cmd = sub.add_parser("set")
    set_cmd.add_argument("--state", required=True)
    set_cmd.add_argument("--stage")
    set_cmd.add_argument("--app")
    set_cmd.add_argument("--window")
    set_cmd.add_argument("--checkpoint")
    set_cmd.add_argument("--postcondition")
    set_cmd.add_argument("--boundary")
    set_cmd.add_argument("--actor")
    set_cmd.add_argument("--side-effect")
    set_cmd.add_argument("--bump-layout", action="store_true")
    set_cmd.set_defaults(func=cmd_set)
    event = sub.add_parser("event")
    event.add_argument("--state", required=True)
    event.add_argument("--actor")
    event.add_argument("--kind", choices=("observe", "act", "verify", "recover", "risk"), required=True)
    event.add_argument("--summary", required=True)
    event.add_argument("--result", choices=("ok", "failed", "unknown"), required=True)
    event.add_argument("--evidence")
    event.add_argument("--roundtrip-ms", type=nonnegative_int)
    event.add_argument("--observation-chars", type=nonnegative_int, default=0)
    event.add_argument("--compact-chars", type=nonnegative_int, default=0)
    event.add_argument("--model-roundtrips", type=nonnegative_int, default=0)
    event.add_argument("--human-intervention", action="store_true")
    event.add_argument("--capture", choices=("none", "structured", "crop", "full", "all-displays"), default="none")
    event.set_defaults(func=cmd_event)
    guard = sub.add_parser("guard")
    guard.add_argument("--state", required=True)
    guard.add_argument("--signature", required=True)
    guard.add_argument("--strategy", required=True)
    guard.add_argument("--max-same", type=positive_int, default=2)
    guard.add_argument("--max-total", type=positive_int, default=5)
    guard.set_defaults(func=cmd_guard)
    resolve = sub.add_parser("resolve")
    resolve.add_argument("--state", required=True)
    resolve.add_argument("--signature", required=True)
    resolve.set_defaults(func=cmd_resolve)
    compact_cmd = sub.add_parser("compact")
    compact_cmd.add_argument("--state", required=True)
    compact_cmd.set_defaults(func=cmd_compact)
    metrics = sub.add_parser("metrics")
    metrics.add_argument("--state", required=True)
    metrics.set_defaults(func=cmd_metrics)
    return root


def main() -> None:
    args = parser().parse_args()
    if args.self_test:
        self_test()
    elif hasattr(args, "func"):
        args.func(args)
    else:
        parser().print_help()


if __name__ == "__main__":
    main()
