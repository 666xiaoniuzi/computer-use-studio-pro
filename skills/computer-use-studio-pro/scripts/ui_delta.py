#!/usr/bin/env python3
"""Emit a bounded, redacted delta between two JSON UI/accessibility trees."""

from __future__ import annotations

import argparse
import json
import re
import tempfile
from pathlib import Path
from typing import Any

FIELDS = ("role", "control_type", "name", "label", "description", "value", "enabled", "visible", "selected", "checked", "focused", "bounds", "rect")
IDENTITY = ("automation_id", "automationId", "selector", "path", "id")
SENSITIVE_ROLES = ("password", "secure text", "protected", "密码", "口令", "密钥")
SECRET = re.compile(r"(?i)(?:\b(password|passwd|secret|token|cookie|authorization|api[_-]?key|otp)\b|(密码|口令|令牌|密钥|验证码))\s*[:=：]\s*\S+")
BEARER = re.compile(r"(?i)\bbearer\s+[A-Za-z0-9._~+/=-]{8,}\b")
PREFIX_SECRET = re.compile(r"\b(?:sk|ghp|github_pat|xox[baprs])[-_][A-Za-z0-9_-]{8,}\b")
JWT_SECRET = re.compile(r"\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b")
AWS_ACCESS_KEY = re.compile(r"\b(?:AKIA|ASIA)[A-Z0-9]{16}\b")
EMAIL = re.compile(r"\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b", re.IGNORECASE)
PHONE = re.compile(r"(?<!\d)(?:\+?\d[\d -]{7,}\d)(?!\d)")


def clean_text(value: str, max_text: int) -> str:
    value = SECRET.sub(lambda match: (match.group(1) or match.group(2)) + "=[REDACTED]", value)
    value = BEARER.sub("Bearer [REDACTED]", value)
    value = PREFIX_SECRET.sub("[REDACTED]", value)
    value = JWT_SECRET.sub("[REDACTED_JWT]", value)
    value = AWS_ACCESS_KEY.sub("[REDACTED_AWS_KEY]", value)
    value = EMAIL.sub("[REDACTED_EMAIL]", value)
    value = PHONE.sub("[REDACTED_PHONE]", value)
    return value if len(value) <= max_text else value[: max_text - 1] + "…"


def clean_value(value: Any, max_text: int) -> Any:
    if isinstance(value, str):
        return clean_text(value, max_text)
    if isinstance(value, list):
        return [clean_value(item, max_text) for item in value[:8]]
    if isinstance(value, dict):
        return {clean_text(str(key), max_text): clean_value(item, max_text) for key, item in list(value.items())[:12]}
    return value


def truthy(value: Any) -> bool:
    if isinstance(value, str):
        return value.strip().lower() in {"1", "true", "yes", "on"}
    return bool(value)


def is_sensitive(node: dict) -> bool:
    text = " ".join(str(node.get(key, "")) for key in ("role", "control_type", "name", "label")).lower()
    return any(marker in text for marker in SENSITIVE_ROLES) or any(truthy(node.get(key)) for key in ("is_password", "password", "protected", "sensitive"))


def nodes(value: Any, trail: str = "$"):
    if isinstance(value, dict):
        if any(key in value for key in FIELDS + IDENTITY):
            yield trail, value
        for key, child in value.items():
            if isinstance(child, (dict, list)):
                yield from nodes(child, f"{trail}.{key}")
    elif isinstance(value, list):
        for index, child in enumerate(value):
            yield from nodes(child, f"{trail}[{index}]")


def node_identity(trail: str, node: dict, max_text: int, sensitive: bool = False) -> str:
    safe_trail = clean_text(trail, min(max_text, 240))
    if sensitive:
        role = clean_text(str(node.get("role", "")), 48)
        bounds = clean_text(str(node.get("bounds") or node.get("rect") or ""), 96)
        return f"sensitive:{role}|{bounds}|{safe_trail}"
    for key in IDENTITY:
        if node.get(key) not in (None, ""):
            return f"{key}:{clean_text(str(node[key]), min(max_text, 96))}"
    role = clean_text(str(node.get("role", "")), 48)
    name = clean_text(str(node.get("name") or node.get("label") or ""), min(max_text, 96))
    bounds = clean_text(str(node.get("bounds") or node.get("rect") or ""), 96)
    return f"fallback:{role}|{name}|{bounds}|{safe_trail}"


def compact_node(node: dict, max_text: int) -> dict:
    sensitive = is_sensitive(node)
    safe_sensitive_fields = {"role", "control_type", "enabled", "visible", "checked", "focused", "bounds", "rect"}
    result = {}
    for key in FIELDS:
        if key not in node or node[key] in (None, ""):
            continue
        result[key] = "[REDACTED]" if sensitive and key not in safe_sensitive_fields else clean_value(node[key], max_text)
    return result


def index(tree: Any, max_text: int) -> dict[str, dict]:
    result = {}
    for trail, node in nodes(tree):
        key = node_identity(trail, node, max_text, is_sensitive(node))
        if key in result:
            key = f"{key}@{clean_text(trail, min(max_text, 240))}"
        result[key] = compact_node(node, max_text)
    return result


def delta(before: Any, after: Any, limit: int, max_text: int) -> dict:
    old, new = index(before, max_text), index(after, max_text)
    added = [{"key": key, "node": new[key]} for key in sorted(new.keys() - old.keys())]
    removed = [{"key": key, "node": old[key]} for key in sorted(old.keys() - new.keys())]
    changed = []
    for key in sorted(old.keys() & new.keys()):
        fields = {
            name: {"from": old[key].get(name), "to": new[key].get(name)}
            for name in sorted(set(old[key]) | set(new[key]))
            if old[key].get(name) != new[key].get(name)
        }
        if fields:
            changed.append({"key": key, "fields": fields})
    total = len(added) + len(removed) + len(changed)
    budget = limit
    output_added = added[:budget]
    budget -= len(output_added)
    output_removed = removed[:budget]
    budget -= len(output_removed)
    output_changed = changed[:budget]
    return {
        "counts": {"before": len(old), "after": len(new), "added": len(added), "removed": len(removed), "changed": len(changed)},
        "truncated": total > limit,
        "added": output_added,
        "removed": output_removed,
        "changed": output_changed,
    }


def self_test() -> None:
    before = {"children": [{"automation_id": "save", "role": "button", "name": "Save", "enabled": False}]}
    after = {"children": [
        {"automation_id": "save", "role": "button", "name": "Save", "enabled": True},
        {"id": "pwd", "role": "password", "name": "Password: never-store-this", "value": "never-store-this"},
        {"id": "status", "role": "status", "name": "x" * 200},
        {"role": "button", "name": "Fallback", "metadata": {"user@example.com": "token=abc123456789"}},
    ]}
    result = delta(before, after, 10, 40)
    assert result["counts"] == {"before": 1, "after": 4, "added": 3, "removed": 0, "changed": 1}
    assert "never-store-this" not in json.dumps(result)
    assert "user@example.com" not in json.dumps(result)
    assert "abc123456789" not in json.dumps(result)
    assert result["changed"][0]["fields"]["enabled"]["to"] is True
    assert "…" in json.dumps(result, ensure_ascii=False)
    with tempfile.TemporaryDirectory() as directory:
        path = Path(directory) / "result.json"
        path.write_text(json.dumps(result), encoding="utf-8")
        assert json.loads(path.read_text(encoding="utf-8"))["truncated"] is False
    print("self-test: ok")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("before", nargs="?")
    parser.add_argument("after", nargs="?")
    parser.add_argument("--limit", type=int, default=40)
    parser.add_argument("--max-text", type=int, default=160)
    parser.add_argument("--pretty", action="store_true")
    parser.add_argument("--self-test", action="store_true")
    args = parser.parse_args()
    if args.self_test:
        self_test()
        return
    if not args.before or not args.after:
        parser.error("before and after JSON files are required")
    if args.limit < 1 or args.max_text < 16:
        parser.error("--limit must be positive and --max-text must be at least 16")
    before = json.loads(Path(args.before).read_text(encoding="utf-8"))
    after = json.loads(Path(args.after).read_text(encoding="utf-8"))
    result = delta(before, after, args.limit, args.max_text)
    print(json.dumps(result, ensure_ascii=False, indent=2 if args.pretty else None, separators=None if args.pretty else (",", ":")))


if __name__ == "__main__":
    main()
