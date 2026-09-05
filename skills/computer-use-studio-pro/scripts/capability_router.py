#!/usr/bin/env python3
"""Map a host tool inventory to the cheapest Computer Use routes without calling tools."""

from __future__ import annotations

import argparse
import json
import re


PATTERNS = {
    "connector_api": re.compile(r"(?:connector|mcp|api|drive|gmail|calendar|notion|slack)", re.I),
    "filesystem": re.compile(r"(?:file|filesystem|read|write|exec|shell|command)", re.I),
    "browser_dom": re.compile(r"(?:browser|playwright|puppeteer|dom|page|tab)", re.I),
    "accessibility": re.compile(r"(?:accessibility|uia|ax|computer|window_state)", re.I),
    "window_lifecycle": re.compile(r"(?:list_windows|window_list|list_apps)", re.I),
    "vision": re.compile(r"(?:screenshot|screen|vision|ocr|image)", re.I),
    "input": re.compile(r"(?:click|type|press|keyboard|mouse|computer|input)", re.I),
}


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


def self_test() -> None:
    result = classify(["browser_dom_click", "list_windows", "filesystem_read", "screenshot"])
    assert result["routes"]["browser"] == "browser_dom"
    assert result["routes"]["window_wait"] == "window_lifecycle"
    assert result["latency_contract"]["inventory_calls"] == 0
    print("self-test: ok")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("tools", nargs="*")
    parser.add_argument("--json", help="JSON array of host tool names")
    parser.add_argument("--self-test", action="store_true")
    args = parser.parse_args()
    if args.self_test:
        self_test()
        return
    names = json.loads(args.json) if args.json else args.tools
    if not isinstance(names, list):
        parser.error("--json must contain an array")
    print(json.dumps(classify(names), ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
