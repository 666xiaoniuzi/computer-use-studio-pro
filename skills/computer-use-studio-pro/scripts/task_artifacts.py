#!/usr/bin/env python3
"""Track and clean task-created local artifacts inside one task-owned root."""

from __future__ import annotations

import argparse
from contextlib import contextmanager
import json
import os
from pathlib import Path
import re
import secrets
import shutil
import tempfile
import time


CLASSES = {"temporary", "unrelated", "rollback", "deliverable"}
TASK_ID = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_-]{2,63}$")
STATE_VERSION = 2


def atomic_write(path: Path, data: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, temp_name = tempfile.mkstemp(prefix=path.name + ".", suffix=".tmp", dir=path.parent)
    os.close(fd)
    temp = Path(temp_name)
    try:
        temp.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8", newline="\n")
        os.replace(temp, path)
    finally:
        temp.unlink(missing_ok=True)


def validate_state(data: object, path: Path) -> dict:
    if not isinstance(data, dict):
        raise ValueError(f"ledger root must be an object: {path}")
    if data.get("version") not in {1, STATE_VERSION}:
        raise ValueError(f"unsupported ledger version: {data.get('version')!r}")
    if not isinstance(data.get("task_id"), str) or not TASK_ID.fullmatch(data["task_id"]):
        raise ValueError("ledger task_id is invalid")
    if not isinstance(data.get("local_root"), str) or not data["local_root"]:
        raise ValueError("ledger local_root is invalid")
    if not isinstance(data.get("artifacts"), list):
        raise ValueError("ledger artifacts must be a list")
    for item in data["artifacts"]:
        if not isinstance(item, dict):
            raise ValueError("ledger artifact must be an object")
        if item.get("side") not in {"local", "remote"} or item.get("classification") not in CLASSES:
            raise ValueError("ledger artifact side or classification is invalid")
        if not isinstance(item.get("path"), str) or not item["path"]:
            raise ValueError("ledger artifact path is invalid")
        if not isinstance(item.get("created_by_task"), bool) or not isinstance(item.get("existed_before"), bool):
            raise ValueError("ledger artifact ownership flags are invalid")
    data["version"] = STATE_VERSION
    data.setdefault("cleanup", {"status": "active", "cleaned": 0, "kept": 0, "pending": []})
    return data


def load(path: Path) -> dict:
    return validate_state(json.loads(path.read_text(encoding="utf-8")), path)


@contextmanager
def ledger_lock(path: Path, timeout: float = 5.0, stale_after: float = 60.0):
    path.parent.mkdir(parents=True, exist_ok=True)
    lock_path = path.with_suffix(path.suffix + ".lock")
    token = secrets.token_hex(16)
    deadline = time.monotonic() + timeout
    while True:
        try:
            descriptor = os.open(lock_path, os.O_CREAT | os.O_EXCL | os.O_WRONLY)
            with os.fdopen(descriptor, "w", encoding="ascii") as handle:
                handle.write(f"pid={os.getpid()} at={time.time()} token={token}\n")
            break
        except FileExistsError:
            if time.time() - lock_path.stat().st_mtime > stale_after:
                raise RuntimeError(f"ledger lock may be stale: {lock_path}")
            if time.monotonic() >= deadline:
                raise RuntimeError(f"ledger is busy: {path}")
            time.sleep(0.05)
    try:
        yield
    finally:
        try:
            if f"token={token}" in lock_path.read_text(encoding="ascii", errors="ignore"):
                lock_path.unlink()
        except FileNotFoundError:
            pass


def is_within(path: Path, root: Path) -> bool:
    try:
        path.relative_to(root)
        return True
    except ValueError:
        return False


def validate_root(root: Path, task_id: str) -> Path:
    resolved = root.resolve(strict=False)
    if not TASK_ID.fullmatch(task_id):
        raise ValueError("task_id must use 3-64 letters, digits, underscores, or hyphens")
    if resolved.name.casefold() != task_id.casefold():
        raise ValueError("local_root must end with the exact task_id")
    if resolved.parent == resolved or resolved.parent.parent == resolved.parent:
        raise ValueError("local_root is too broad")
    return resolved


def init_state(state_path: Path, task_id: str, local_root: Path) -> dict:
    root = validate_root(local_root, task_id)
    state_resolved = state_path.resolve(strict=False)
    if is_within(state_resolved, root):
        raise ValueError("state file must stay outside the task artifact root")
    with ledger_lock(state_path):
        if state_path.exists():
            raise ValueError(f"ledger already exists: {state_path}")
        root.mkdir(parents=True, exist_ok=True)
        state = {
            "version": STATE_VERSION,
            "task_id": task_id,
            "local_root": str(root),
            "artifacts": [],
            "cleanup": {"status": "active", "cleaned": 0, "kept": 0, "pending": []},
        }
        atomic_write(state_path, state)
    return state


def add_artifact(state_path: Path, path_text: str, side: str, classification: str, purpose: str, existed_before: bool) -> dict:
    with ledger_lock(state_path):
        state = load(state_path)
        if classification not in CLASSES:
            raise ValueError(f"unsupported classification: {classification}")
        if side not in {"local", "remote"}:
            raise ValueError(f"unsupported side: {side}")
        if side == "local":
            root = Path(state["local_root"]).resolve(strict=False)
            artifact_path = Path(path_text).resolve(strict=False)
            if artifact_path == root:
                raise ValueError("an artifact path cannot be the task root itself")
            protected_external = existed_before or classification == "deliverable"
            if not protected_external and not is_within(artifact_path, root):
                raise ValueError("task-created cleanup candidates must stay under local_root")
            stored_path = str(artifact_path)
        else:
            stored_path = str(path_text)
        if any(item["side"] == side and item["path"].casefold() == stored_path.casefold() for item in state["artifacts"]):
            raise ValueError("artifact path is already tracked")
        item = {
            "side": side,
            "path": stored_path,
            "classification": classification,
            "purpose": purpose,
            "created_by_task": not existed_before,
            "existed_before": existed_before,
            "cleanup_state": "active",
        }
        state["artifacts"].append(item)
        atomic_write(state_path, state)
    return item


def cleanup_local(state_path: Path, task_id: str, expected_root: Path, task_verified: bool, remove_state: bool = False) -> dict:
    with ledger_lock(state_path):
        return _cleanup_local_locked(state_path, task_id, expected_root, task_verified, remove_state)


def _cleanup_local_locked(state_path: Path, task_id: str, expected_root: Path, task_verified: bool, remove_state: bool) -> dict:
    state = load(state_path)
    if state.get("task_id") != task_id:
        raise ValueError("task_id does not match the ledger")
    root = validate_root(Path(state["local_root"]), task_id)
    supplied_root = validate_root(expected_root, task_id)
    if supplied_root != root:
        raise ValueError("local_root does not match the ledger")
    preserved = []
    candidates = []
    pending = []
    for item in state["artifacts"]:
        if item["side"] != "local":
            continue
        path = Path(item["path"]).resolve(strict=False)
        deletable_class = item["classification"] in {"temporary", "unrelated"} or (
            item["classification"] == "rollback" and task_verified
        )
        if item["created_by_task"] and not item["existed_before"] and deletable_class:
            if not is_within(path, root) or path == root:
                item["cleanup_state"] = "pending"
                pending.append({"path": str(path), "error": "CleanupCandidateOutsideTaskRoot"})
                preserved.append(path)
                continue
            candidates.append((path, item))
        else:
            item["cleanup_state"] = "kept"
            preserved.append(path)

    cleaned = 0
    for path, item in sorted(candidates, key=lambda pair: len(pair[0].parts), reverse=True):
        if path.is_dir() and any(is_within(keep, path) for keep in preserved):
            item["cleanup_state"] = "pending"
            pending.append({"path": str(path), "error": "ContainsPreservedContent"})
            preserved.append(path)
            continue
        try:
            if path.is_dir():
                resolved = path.resolve(strict=False)
                if resolved == root or not is_within(resolved, root):
                    raise ValueError("recursive target escaped the task-owned root")
                shutil.rmtree(resolved)
            else:
                path.unlink(missing_ok=True)
            if path.exists():
                raise OSError("cleanup target still exists")
            item["cleanup_state"] = "cleaned"
            cleaned += 1
        except Exception as error:
            item["cleanup_state"] = "pending"
            pending.append({"path": str(path), "error": type(error).__name__})

    if root.exists():
        remaining = sorted(root.iterdir(), key=lambda value: value.name.casefold())
        for path in remaining[:100]:
            pending.append({"path": str(path), "error": "UntrackedOrPreservedContent"})
        if not remaining:
            try:
                root.rmdir()
            except OSError as error:
                pending.append({"path": str(root), "error": type(error).__name__})
        elif len(remaining) > 100:
            pending.append({"path": str(root), "error": f"AdditionalRemainingEntries:{len(remaining) - 100}"})
    if root.exists() and not any(item["path"] == str(root) for item in pending):
        pending.append({"path": str(root), "error": "TaskRootStillExists"})
    unique_pending = []
    seen_pending = set()
    for item in pending:
        key = (item["path"].casefold(), item["error"])
        if key not in seen_pending:
            seen_pending.add(key)
            unique_pending.append(item)
    pending = unique_pending
    kept = sum(1 for item in state["artifacts"] if item["side"] == "local" and item["cleanup_state"] == "kept")
    status = "verified" if not pending else "cleanup_pending"
    state["cleanup"] = {"status": status, "cleaned": cleaned, "kept": kept, "pending": pending}
    atomic_write(state_path, state)
    summary = dict(state["cleanup"])
    if remove_state and not pending:
        state_path.unlink(missing_ok=True)
        summary["state_removed"] = True
    return summary


def self_test() -> None:
    with tempfile.TemporaryDirectory() as temp_dir:
        base = Path(temp_dir)
        task_id = "task-123"
        root = base / "artifacts" / task_id
        state_path = base / "ledger" / f"{task_id}.json"
        init_state(state_path, task_id, root)
        scratch = root / "scratch.txt"
        abandoned = root / "abandoned.tmp"
        rollback = root / "rollback.bak"
        deliverable = base / "results" / "result.txt"
        for path in (scratch, abandoned, rollback, deliverable):
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(path.name, encoding="utf-8")
        add_artifact(state_path, str(scratch), "local", "temporary", "scratch", False)
        add_artifact(state_path, str(abandoned), "local", "unrelated", "failed attempt", False)
        add_artifact(state_path, str(rollback), "local", "rollback", "restore point", False)
        add_artifact(state_path, str(deliverable), "local", "deliverable", "requested output", False)
        outside_rejected = False
        try:
            add_artifact(state_path, str(base / "outside.txt"), "local", "temporary", "outside", False)
        except ValueError:
            outside_rejected = True
        assert outside_rejected
        summary = cleanup_local(state_path, task_id, root, task_verified=True)
        assert summary["status"] == "verified" and summary["cleaned"] == 3
        assert not scratch.exists() and not abandoned.exists() and not rollback.exists()
        assert deliverable.exists() and not root.exists()
        task_id_2 = "task-456"
        root_2 = base / "artifacts" / task_id_2
        state_2 = base / "ledger" / f"{task_id_2}.json"
        init_state(state_2, task_id_2, root_2)
        tracked = root_2 / "tracked.tmp"
        untracked = root_2 / "untracked.tmp"
        tracked.write_text("tracked", encoding="utf-8")
        untracked.write_text("untracked", encoding="utf-8")
        add_artifact(state_2, str(tracked), "local", "temporary", "tracked", False)
        incomplete = cleanup_local(state_2, task_id_2, root_2, task_verified=True)
        assert incomplete["status"] == "cleanup_pending"
        assert not tracked.exists() and untracked.exists() and root_2.exists()
        mismatch_rejected = False
        try:
            cleanup_local(state_2, task_id_2, base / "other" / task_id_2, task_verified=True)
        except ValueError:
            mismatch_rejected = True
        assert mismatch_rejected
        print("self-test: ok")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--self-test", action="store_true")
    sub = parser.add_subparsers(dest="command")

    init = sub.add_parser("init")
    init.add_argument("--state", type=Path, required=True)
    init.add_argument("--task-id", required=True)
    init.add_argument("--local-root", type=Path, required=True)

    add = sub.add_parser("add")
    add.add_argument("--state", type=Path, required=True)
    add.add_argument("--path", required=True)
    add.add_argument("--side", choices=["local", "remote"], required=True)
    add.add_argument("--class", dest="classification", choices=sorted(CLASSES), required=True)
    add.add_argument("--purpose", required=True)
    add.add_argument("--existed-before", choices=["true", "false"], required=True)

    plan = sub.add_parser("plan")
    plan.add_argument("--state", type=Path, required=True)

    cleanup = sub.add_parser("cleanup-local")
    cleanup.add_argument("--state", type=Path, required=True)
    cleanup.add_argument("--task-id", required=True)
    cleanup.add_argument("--local-root", type=Path, required=True)
    cleanup.add_argument("--task-verified", action="store_true")
    cleanup.add_argument("--remove-state", action="store_true")

    args = parser.parse_args()
    if args.self_test:
        self_test()
    elif args.command == "init":
        print(json.dumps(init_state(args.state, args.task_id, args.local_root), ensure_ascii=False))
    elif args.command == "add":
        print(json.dumps(add_artifact(args.state, args.path, args.side, args.classification, args.purpose, args.existed_before == "true"), ensure_ascii=False))
    elif args.command == "plan":
        print(json.dumps(load(args.state), ensure_ascii=False, indent=2))
    elif args.command == "cleanup-local":
        print(json.dumps(cleanup_local(args.state, args.task_id, args.local_root, args.task_verified, args.remove_state), ensure_ascii=False))
    else:
        parser.print_help()


if __name__ == "__main__":
    main()
