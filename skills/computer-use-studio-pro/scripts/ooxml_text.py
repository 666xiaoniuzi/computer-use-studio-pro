#!/usr/bin/env python3
"""Replace and verify text in an OOXML copy without opening Office dialogs."""

from __future__ import annotations

import argparse
import json
import os
import tempfile
import time
import zipfile
from pathlib import Path
from xml.sax.saxutils import escape
import re

OOXML_SUFFIXES = {".pptx", ".docx", ".xlsx", ".pptm", ".docm", ".xlsm"}
TEXT_PARTS = (".xml",)
TEXT_NODE = re.compile(
    r"(?P<open><(?P<tag>(?:[A-Za-z_][\w.-]*:)?t)(?:\s[^>]*)?>)(?P<value>.*?)(?P<close></(?P=tag)\s*>)",
    re.DOTALL,
)
MAX_PARTS = 10_000
MAX_MEMBER_BYTES = 256 * 1024 * 1024
MAX_UNCOMPRESSED_BYTES = 1024 * 1024 * 1024
MAX_COMPRESSION_RATIO = 200


def pairs(values: list[str]) -> list[tuple[str, str]]:
    result = []
    for value in values:
        if "=" not in value:
            raise SystemExit(f"invalid replacement (expected OLD=NEW): {value!r}")
        old, new = value.split("=", 1)
        if not old:
            raise SystemExit("replacement OLD text cannot be empty")
        result.append((escape(old), escape(new)))
    return result


def validate_input(path: Path) -> None:
    if path.suffix.lower() not in OOXML_SUFFIXES:
        raise SystemExit(f"unsupported OOXML extension: {path.suffix}")
    if not path.is_file() or not zipfile.is_zipfile(path):
        raise SystemExit(f"not a readable OOXML package: {path}")
    with zipfile.ZipFile(path, "r") as package:
        infos = package.infolist()
        if len(infos) > MAX_PARTS:
            raise SystemExit(f"OOXML package has too many parts: {len(infos)}")
        total = 0
        for info in infos:
            if info.file_size > MAX_MEMBER_BYTES:
                raise SystemExit(f"OOXML part is too large: {info.filename}")
            if info.compress_size and info.file_size / info.compress_size > MAX_COMPRESSION_RATIO:
                raise SystemExit(f"OOXML part has an unsafe compression ratio: {info.filename}")
            total += info.file_size
            if total > MAX_UNCOMPRESSED_BYTES:
                raise SystemExit("OOXML package is too large to process safely")


def xml_text(path: Path) -> str:
    validate_input(path)
    chunks = []
    with zipfile.ZipFile(path, "r") as package:
        for info in package.infolist():
            if info.filename.lower().endswith(TEXT_PARTS):
                chunks.append(package.read(info).decode("utf-8"))
    return "\n".join(chunks)


def verify(path: Path, expected: list[str], forbidden: list[str]) -> dict:
    content = xml_text(path)
    missing = [value for value in expected if escape(value) not in content]
    remaining = [value for value in forbidden if escape(value) in content]
    return {"ok": not missing and not remaining, "missing_count": len(missing), "forbidden_count": len(remaining)}


def replace_text_nodes(text: str, replacements: list[tuple[str, str]], counts: list[int]) -> str:
    def rewrite(match: re.Match[str]) -> str:
        value = match.group("value")
        for index, (old, new) in enumerate(replacements):
            count = value.count(old)
            if count:
                value = value.replace(old, new)
                counts[index] += count
        return match.group("open") + value + match.group("close")

    return TEXT_NODE.sub(rewrite, text)


def replace_copy(source: Path, output: Path, replacements: list[tuple[str, str]], require_all: bool, overwrite: bool = False) -> dict:
    validate_input(source)
    if source.resolve() == output.resolve():
        raise SystemExit("write to a separate output copy; in-place replacement is intentionally disabled")
    if output.exists() and not overwrite:
        raise SystemExit("output already exists; choose a new path or pass --overwrite after confirmation")
    output.parent.mkdir(parents=True, exist_ok=True)
    counts = [0] * len(replacements)
    descriptor, temporary_name = tempfile.mkstemp(prefix=output.name + ".", suffix=".tmp", dir=output.parent)
    os.close(descriptor)
    temporary = Path(temporary_name)
    try:
        with zipfile.ZipFile(source, "r") as incoming, zipfile.ZipFile(temporary, "w") as outgoing:
            for info in incoming.infolist():
                data = incoming.read(info)
                if info.filename.lower().endswith(TEXT_PARTS):
                    text = data.decode("utf-8")
                    data = replace_text_nodes(text, replacements, counts).encode("utf-8")
                outgoing.writestr(info, data)
        if require_all and any(count == 0 for count in counts):
            raise SystemExit(f"required replacement was not found; counts={counts}")
        os.replace(temporary, output)
    finally:
        if temporary.exists():
            temporary.unlink()
    return {"ok": True, "replacement_counts": counts, "bytes": output.stat().st_size}


def self_test() -> None:
    with tempfile.TemporaryDirectory() as directory:
        root = Path(directory)
        source, output = root / "source.pptx", root / "output.pptx"
        with zipfile.ZipFile(source, "w") as package:
            package.writestr("[Content_Types].xml", "<Types/>")
            package.writestr("ppt/slides/slide1.xml", "<p:sld><a:t>组会汇报</a:t><a:t>A&amp;B</a:t></p:sld>")
            package.writestr("ppt/media/image.bin", b"\x00\x01\x02")
        result = replace_copy(source, output, pairs(["组会汇报=论文答辩", "A&B=Q&A"]), True)
        assert result["replacement_counts"] == [1, 1]
        assert verify(output, ["论文答辩", "Q&A"], ["组会汇报", "A&B"])["ok"]
        with zipfile.ZipFile(output, "r") as package:
            assert package.read("ppt/media/image.bin") == b"\x00\x01\x02"
        try:
            replace_copy(source, output, pairs(["A&B=again"]), True)
        except SystemExit:
            pass
        else:
            raise AssertionError("existing output overwrite was not rejected")
        tag_source, tag_output = root / "tag-source.pptx", root / "tag-output.pptx"
        with zipfile.ZipFile(tag_source, "w") as package:
            package.writestr("[Content_Types].xml", "<Types/>")
            package.writestr("ppt/slides/slide1.xml", "<p:sld><a:t>data</a:t></p:sld>")
        replace_copy(tag_source, tag_output, pairs(["a=Z"]), True)
        with zipfile.ZipFile(tag_output, "r") as package:
            assert b"<a:t>dZtZ</a:t>" in package.read("ppt/slides/slide1.xml")
    print("self-test: ok")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--self-test", action="store_true")
    sub = parser.add_subparsers(dest="command")
    replace_parser = sub.add_parser("replace")
    replace_parser.add_argument("input")
    replace_parser.add_argument("output")
    replace_parser.add_argument("--replace", action="append", default=[], metavar="OLD=NEW")
    replace_parser.add_argument("--overwrite", action="store_true")
    replace_parser.add_argument("--allow-missing", action="store_true", help="allow a requested replacement to be absent")
    replace_parser.add_argument("--expect", action="append", default=[])
    replace_parser.add_argument("--forbid", action="append", default=[])
    verify_parser = sub.add_parser("verify")
    verify_parser.add_argument("input")
    verify_parser.add_argument("--expect", action="append", default=[])
    verify_parser.add_argument("--forbid", action="append", default=[])
    args = parser.parse_args()
    if args.self_test:
        self_test()
        return
    if args.command == "replace":
        if not args.replace:
            parser.error("at least one --replace OLD=NEW is required")
        if not args.expect and not args.forbid:
            parser.error("replace requires at least one --expect or --forbid verification")
        started = time.monotonic()
        result = replace_copy(Path(args.input), Path(args.output), pairs(args.replace), not args.allow_missing, args.overwrite)
        result["verification"] = verify(Path(args.output), args.expect, args.forbid)
        result["elapsed_ms"] = round((time.monotonic() - started) * 1000)
        print(json.dumps(result, ensure_ascii=False))
        if not result["verification"]["ok"]:
            raise SystemExit(2)
        return
    if args.command == "verify":
        result = verify(Path(args.input), args.expect, args.forbid)
        print(json.dumps(result, ensure_ascii=False))
        if not result["ok"]:
            raise SystemExit(2)
        return
    parser.print_help()


if __name__ == "__main__":
    main()
