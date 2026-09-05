#!/usr/bin/env python3
"""Replace and verify text in an OOXML copy without opening Office dialogs."""

from __future__ import annotations

import argparse
from bisect import bisect_right
from html import unescape
import json
import os
import re
import tempfile
import time
import zipfile
from pathlib import Path
from xml.sax.saxutils import escape
from xml.etree import ElementTree

OOXML_SUFFIXES = {".pptx", ".docx", ".xlsx", ".pptm", ".docm", ".xlsm"}
TEXT_PARTS = (".xml",)
TEXT_NODE = re.compile(
    r"(?P<open><(?P<tag>(?:[A-Za-z_][\w.-]*:)?t)(?:\s[^>]*)?>)(?P<value>.*?)(?P<close></(?P=tag)\s*>)",
    re.DOTALL,
)
TEXT_CONTAINER = re.compile(
    r"<(?P<tag>(?:[A-Za-z_][\w.-]*:)?(?:p|si|is))(?:\s[^>]*)?>.*?</(?P=tag)\s*>",
    re.DOTALL,
)
XML_ENCODING = re.compile(br"<\?xml[^>]*\bencoding=[\"']([^\"']+)[\"']", re.IGNORECASE)
TEXT_GROUPS = {"p", "si", "is"}
MAX_PARTS = 10_000
MAX_MEMBER_BYTES = 256 * 1024 * 1024
MAX_UNCOMPRESSED_BYTES = 1024 * 1024 * 1024
MAX_COMPRESSION_RATIO = 200


def pairs(values: list[str]) -> list[tuple[str, str]]:
    result = []
    seen = set()
    for value in values:
        if "=" not in value:
            raise SystemExit(f"invalid replacement (expected OLD=NEW): {value!r}")
        old, new = value.split("=", 1)
        if not old:
            raise SystemExit("replacement OLD text cannot be empty")
        if old in seen:
            raise SystemExit(f"duplicate replacement OLD text: {old!r}")
        seen.add(old)
        result.append((old, new))
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
            if info.flag_bits & 0x1:
                raise SystemExit(f"encrypted OOXML part is not supported: {info.filename}")
            if info.file_size > MAX_MEMBER_BYTES:
                raise SystemExit(f"OOXML part is too large: {info.filename}")
            if info.file_size and not info.compress_size:
                raise SystemExit(f"OOXML part has an invalid compressed size: {info.filename}")
            if info.compress_size and info.file_size / info.compress_size > MAX_COMPRESSION_RATIO:
                raise SystemExit(f"OOXML part has an unsafe compression ratio: {info.filename}")
            total += info.file_size
            if total > MAX_UNCOMPRESSED_BYTES:
                raise SystemExit("OOXML package is too large to process safely")


def local_name(tag: str) -> str:
    return tag.rsplit("}", 1)[-1].split(":", 1)[-1]


def text_groups(data: bytes, filename: str) -> list[str]:
    try:
        root = ElementTree.fromstring(data)
    except ElementTree.ParseError as error:
        raise SystemExit(f"invalid XML part {filename}: {error}") from error

    groups: list[str] = []

    def walk(element: ElementTree.Element) -> None:
        name = local_name(element.tag)
        if name in TEXT_GROUPS:
            value = "".join(
                child.text or ""
                for child in element.iter()
                if local_name(child.tag) == "t"
            )
            if value:
                groups.append(value)
            return
        if name == "t" and element.text:
            groups.append(element.text)
            return
        for child in element:
            walk(child)

    walk(root)
    return groups


def xml_text(path: Path) -> str:
    validate_input(path)
    chunks = []
    with zipfile.ZipFile(path, "r") as package:
        for info in package.infolist():
            if info.filename.lower().endswith(TEXT_PARTS):
                chunks.extend(text_groups(package.read(info), info.filename))
    return "\n".join(chunks)


def verify(path: Path, expected: list[str], forbidden: list[str]) -> dict:
    content = xml_text(path)
    missing = [value for value in expected if value not in content]
    remaining = [value for value in forbidden if value in content]
    return {
        "ok": not missing and not remaining,
        "missing_count": len(missing),
        "forbidden_count": len(remaining),
        "missing": missing,
        "remaining": remaining,
    }


def xml_codec(data: bytes) -> str:
    if data.startswith(b"\xef\xbb\xbf"):
        return "utf-8-sig"
    if data.startswith((b"\xff\xfe", b"\xfe\xff")):
        return "utf-16"
    match = XML_ENCODING.search(data[:256])
    return match.group(1).decode("ascii") if match else "utf-8"


def decode_xml(data: bytes, filename: str) -> tuple[str, str]:
    codec = xml_codec(data)
    try:
        return data.decode(codec), codec
    except (LookupError, UnicodeDecodeError) as error:
        raise SystemExit(f"cannot decode XML part {filename} with {codec}: {error}") from error


def replace_text_nodes(text: str, replacements: list[tuple[str, str]], counts: list[int]) -> str:
    """Replace logical text across formatted OOXML runs while retaining run markup."""
    pattern = re.compile("|".join(re.escape(old) for old, _ in sorted(replacements, key=lambda pair: len(pair[0]), reverse=True)))
    by_old = {old: (index, new) for index, (old, new) in enumerate(replacements)}

    def rewritten_open(open_tag: str, value: str) -> str:
        if value and (value[0].isspace() or value[-1].isspace()) and "xml:space" not in open_tag:
            return open_tag[:-1] + ' xml:space="preserve">'
        return open_tag

    def rewrite_container(container: str) -> str:
        nodes = list(TEXT_NODE.finditer(container))
        if not nodes:
            return container
        values = [unescape(node.group("value")) for node in nodes]
        logical = "".join(values)
        matches = list(pattern.finditer(logical))
        if not matches:
            return container

        starts = []
        position = 0
        for value in values:
            starts.append(position)
            position += len(value)
        ends = starts[1:] + [len(logical)]
        output = [""] * len(nodes)

        def append_original(start: int, end: int) -> None:
            if end <= start:
                return
            first = max(0, bisect_right(starts, start) - 1)
            for node_index in range(first, len(nodes)):
                left = max(start, starts[node_index])
                right = min(end, ends[node_index])
                if right > left:
                    output[node_index] += logical[left:right]
                if ends[node_index] >= end:
                    break

        cursor = 0
        for found in matches:
            append_original(cursor, found.start())
            index, new = by_old[found.group(0)]
            target_node = max(0, min(len(nodes) - 1, bisect_right(starts, found.start()) - 1))
            output[target_node] += new
            counts[index] += 1
            cursor = found.end()
        append_original(cursor, len(logical))

        pieces = []
        cursor = 0
        for node, value in zip(nodes, output):
            pieces.append(container[cursor:node.start()])
            pieces.append(rewritten_open(node.group("open"), value) + escape(value) + node.group("close"))
            cursor = node.end()
        pieces.append(container[cursor:])
        return "".join(pieces)

    pieces = []
    cursor = 0
    for container in TEXT_CONTAINER.finditer(text):
        # Standalone text nodes outside paragraphs/shared strings retain the old
        # single-node behavior; container nodes gain cross-run replacement.
        prefix = text[cursor:container.start()]
        pieces.append(TEXT_NODE.sub(lambda match: rewrite_container(match.group(0)), prefix))
        pieces.append(rewrite_container(container.group(0)))
        cursor = container.end()
    pieces.append(TEXT_NODE.sub(lambda match: rewrite_container(match.group(0)), text[cursor:]))
    return "".join(pieces)


def replace_copy(source: Path, output: Path, replacements: list[tuple[str, str]], require_all: bool, overwrite: bool = False) -> dict:
    validate_input(source)
    if not replacements:
        raise SystemExit("at least one replacement is required")
    if source.resolve() == output.resolve():
        raise SystemExit("write to a separate output copy; in-place replacement is intentionally disabled")
    if output.suffix.lower() != source.suffix.lower():
        raise SystemExit("output must use the same OOXML extension as the input")
    if output.exists() and not overwrite:
        raise SystemExit("output already exists; choose a new path or pass --overwrite after confirmation")
    output.parent.mkdir(parents=True, exist_ok=True)
    counts = [0] * len(replacements)
    descriptor, temporary_name = tempfile.mkstemp(prefix=output.name + ".", suffix=".tmp", dir=output.parent)
    os.close(descriptor)
    temporary = Path(temporary_name)
    try:
        with zipfile.ZipFile(source, "r") as incoming, zipfile.ZipFile(temporary, "w") as outgoing:
            outgoing.comment = incoming.comment
            for info in incoming.infolist():
                data = incoming.read(info)
                if info.filename.lower().endswith(TEXT_PARTS):
                    text, codec = decode_xml(data, info.filename)
                    data = replace_text_nodes(text, replacements, counts).encode(codec)
                outgoing.writestr(info, data)
        if require_all and any(count == 0 for count in counts):
            visible = xml_text(source)
            split_across_nodes = [old for (old, _), count in zip(replacements, counts) if count == 0 and old in visible]
            hint = f"; text spans multiple formatted nodes: {split_across_nodes!r}" if split_across_nodes else ""
            raise SystemExit(f"required replacement was not found in one text node; counts={counts}{hint}")
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
            package.writestr("ppt/slides/slide1.xml", '<p:sld xmlns:p="urn:p" xmlns:a="urn:a"><a:p><a:t>组会汇报</a:t><a:t>A&amp;B</a:t></a:p></p:sld>')
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
            package.writestr("ppt/slides/slide1.xml", '<p:sld xmlns:p="urn:p" xmlns:a="urn:a"><a:p><a:t>data</a:t></a:p></p:sld>')
        replace_copy(tag_source, tag_output, pairs(["a=Z"]), True)
        with zipfile.ZipFile(tag_output, "r") as package:
            assert b"<a:t>dZtZ</a:t>" in package.read("ppt/slides/slide1.xml")
        cascade_source, cascade_output = root / "cascade-source.pptx", root / "cascade-output.pptx"
        with zipfile.ZipFile(cascade_source, "w") as package:
            package.writestr("[Content_Types].xml", "<Types/>")
            package.writestr("ppt/slides/slide1.xml", '<p:sld xmlns:p="urn:p" xmlns:a="urn:a"><a:p><a:t>A B</a:t></a:p></p:sld>')
        cascade = replace_copy(cascade_source, cascade_output, pairs(["A=B", "B=C"]), True)
        assert cascade["replacement_counts"] == [1, 1]
        assert verify(cascade_output, ["B C"], ["A"])["ok"]
        split_source, split_output = root / "split-source.pptx", root / "split-output.pptx"
        with zipfile.ZipFile(split_source, "w") as package:
            package.writestr("[Content_Types].xml", "<Types/>")
            package.writestr("ppt/slides/slide1.xml", '<p:sld xmlns:p="urn:p" xmlns:a="urn:a"><a:p><a:t>Hello </a:t><a:t>world</a:t></a:p></p:sld>')
        assert verify(split_source, ["Hello world"], [])["ok"]
        split_result = replace_copy(split_source, split_output, pairs(["Hello world=Hi"]), True)
        assert split_result["replacement_counts"] == [1]
        assert verify(split_output, ["Hi"], ["Hello world"])["ok"]
        with zipfile.ZipFile(split_output, "r") as package:
            split_xml = package.read("ppt/slides/slide1.xml")
            assert split_xml.count(b"<a:t") == 2 and b"<a:t>Hi</a:t>" in split_xml
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
        result["ok"] = result["verification"]["ok"]
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
