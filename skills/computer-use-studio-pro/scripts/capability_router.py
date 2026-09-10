#!/usr/bin/env python3
"""Map a host tool inventory to the cheapest Computer Use routes without calling tools."""

from __future__ import annotations

import argparse
import json
import re


PATTERNS = {
    "connector_api": re.compile(r"(?:connector|mcp|api|drive|gmail|calendar|notion|slack)", re.I),
    "filesystem": re.compile(r"(?:file|filesystem|read|write|exec|shell|command)", re.I),
    "terminal": re.compile(r"(?:exec|shell|command|terminal|powershell|cmd)", re.I),
    "browser_dom": re.compile(r"(?:browser|playwright|puppeteer|dom|page|tab)", re.I),
    "accessibility": re.compile(r"(?:accessibility|uia|ax|computer|window_state)", re.I),
    "window_lifecycle": re.compile(r"(?:list_windows|window_list|list_apps)", re.I),
    "vision": re.compile(r"(?:screenshot|screen|vision|ocr|image)", re.I),
    "input": re.compile(r"(?:click|type|press|keyboard|mouse|computer|input)", re.I),
}

GUI_EXECUTION_OPERATIONS = {
    "browser-login", "document-edit", "peripheral-setup", "visual-workflow", "user-flow", "desktop-settings",
}
DESKTOP_TARGETS = {"desktop-app", "browser", "office", "pdf", "peripheral", "model-selector"}


def classify(tool_names: list[str]) -> dict:
    normalized = sorted({str(name).strip() for name in tool_names if str(name).strip()})
    capabilities = {
        category: [name for name in normalized if pattern.search(name)]
        for category, pattern in PATTERNS.items()
    }
    routes = {
        "structured_data": "connector_api" if capabilities["connector_api"] else "filesystem" if capabilities["filesystem"] else None,
        "browser": "browser_dom" if capabilities["browser_dom"] else "accessibility" if capabilities["accessibility"] else "vision" if capabilities["vision"] else None,
        "desktop": "accessibility" if capabilities["accessibility"] else "vision" if capabilities["vision"] and capabilities["input"] else None,
        "window_wait": "window_lifecycle" if capabilities["window_lifecycle"] else "accessibility" if capabilities["accessibility"] else None,
    }
    return {
        "ok": any(routes.values()),
        "tools": normalized,
        "capabilities": capabilities,
        "routes": routes,
        "latency_contract": {
            "inventory_calls": 0,
            "normal_path_extra_model_roundtrips": 0,
            "selection": "connector/file -> DOM/accessibility -> vision/coordinates",
        },
    }


def select_interaction_route(
    tool_names: list[str],
    *,
    operation: str = "diagnose",
    target_kind: str = "system",
    preferred: str = "auto",
    requires_interactive_ui: bool = False,
    requires_visual_acceptance: bool = False,
    requires_user_workflow: bool = False,
) -> dict:
    """Choose structured/terminal/GUI/hybrid from an existing tool-name inventory."""
    mapped = classify(tool_names)
    operation = str(operation).strip().lower()
    target_kind = str(target_kind).strip().lower()
    preferred = str(preferred).strip().lower()
    if preferred not in {"auto", "structured", "terminal", "gui"}:
        raise ValueError("unsupported preferred interface")
    available = {
        "structured": bool(mapped["capabilities"]["connector_api"] or mapped["capabilities"]["filesystem"]),
        "terminal": bool(mapped["capabilities"]["terminal"]),
        "gui": bool(mapped["routes"]["desktop"] or mapped["routes"]["browser"]),
    }
    needs_gui_execution = requires_interactive_ui or operation in GUI_EXECUTION_OPERATIONS or preferred == "gui"
    needs_gui_acceptance = requires_visual_acceptance or requires_user_workflow or target_kind in DESKTOP_TARGETS
    execution = next((name for name in ("structured", "terminal", "gui") if available[name]), None)
    if preferred != "auto" and available[preferred]:
        execution = preferred
    if needs_gui_execution:
        execution = "gui" if available["gui"] else None
    acceptance = ("gui" if available["gui"] else None) if needs_gui_acceptance else execution
    route = execution if execution == acceptance else "hybrid" if execution and acceptance else None
    return {
        "ok": route is not None,
        "route": route,
        "execution": execution,
        "acceptance": acceptance,
        "operation": operation,
        "target_kind": target_kind,
        "metrics": {"capability_probes": 0, "state_captures": 0, "network_requests": 0, "model_roundtrips": 0},
    }


def self_test() -> None:
    result = classify(["browser_dom_click", "list_windows", "filesystem_read", "screenshot"])
    assert result["routes"]["browser"] == "browser_dom"
    assert result["routes"]["window_wait"] == "window_lifecycle"
    assert result["latency_contract"]["inventory_calls"] == 0
    tools = ["connector_api", "powershell_exec", "accessibility_click"]
    desktop = select_interaction_route(tools, operation="install", target_kind="desktop-app")
    cli = select_interaction_route(tools, operation="configure", target_kind="cli-tool")
    visual = select_interaction_route(tools, operation="document-edit", target_kind="office")
    assert (desktop["route"], desktop["execution"], desktop["acceptance"]) == ("hybrid", "structured", "gui")
    assert cli["route"] == "structured"
    assert visual["route"] == "gui"
    assert desktop["metrics"]["model_roundtrips"] == 0
    print("self-test: ok")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("tools", nargs="*")
    parser.add_argument("--json", help="JSON array of host tool names")
    parser.add_argument("--self-test", action="store_true")
    parser.add_argument("--operation")
    parser.add_argument("--target-kind", default="system")
    args = parser.parse_args()
    if args.self_test:
        self_test()
        return
    names = json.loads(args.json) if args.json else args.tools
    if not isinstance(names, list):
        parser.error("--json must contain an array")
    result = select_interaction_route(names, operation=args.operation, target_kind=args.target_kind) if args.operation else classify(names)
    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
