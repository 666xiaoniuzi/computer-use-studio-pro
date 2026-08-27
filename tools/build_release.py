#!/usr/bin/env python3
"""Build deterministic source and install ZIPs for Computer Use Studio Pro."""

from __future__ import annotations

import argparse
import hashlib
import os
from pathlib import Path, PurePosixPath
import re
import tempfile
import zipfile


FIXED_TIME = (1980, 1, 1, 0, 0, 0)
EXCLUDED_PARTS = {".git", "__pycache__", ".pytest_cache", ".mypy_cache"}
EXCLUDED_SUFFIXES = {".pyc", ".pyo", ".tmp"}


def version_from_manifest(skill: Path) -> str:
    text = (skill / "manifest.yaml").read_text(encoding="utf-8")
    match = re.search(r"^version:\s*([^\s#]+)", text, re.MULTILINE)
    if not match:
        raise RuntimeError("manifest.yaml has no version")
    return match.group(1)


def include_file(path: Path, root: Path) -> bool:
    rel = path.relative_to(root)
    if any(part in EXCLUDED_PARTS for part in rel.parts):
        return False
    if path.suffix.lower() in EXCLUDED_SUFFIXES:
        return False
    return path.is_file() and not path.is_symlink()


def deterministic_zip(output: Path, root: Path, archive_root: str) -> None:
    output.parent.mkdir(parents=True, exist_ok=True)
    fd, temp_name = tempfile.mkstemp(prefix=output.name + ".", suffix=".tmp", dir=output.parent)
    os.close(fd)
    temp = Path(temp_name)
    try:
        with zipfile.ZipFile(temp, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=9) as zf:
            for path in sorted((p for p in root.rglob("*") if include_file(p, root)), key=lambda p: p.relative_to(root).as_posix()):
                rel = PurePosixPath(archive_root) / PurePosixPath(path.relative_to(root).as_posix())
                info = zipfile.ZipInfo(rel.as_posix(), FIXED_TIME)
                info.compress_type = zipfile.ZIP_DEFLATED
                info.external_attr = 0o100644 << 16
                info.create_system = 3
                zf.writestr(info, path.read_bytes(), compress_type=zipfile.ZIP_DEFLATED, compresslevel=9)
        validate_zip(temp, archive_root)
        os.replace(temp, output)
    finally:
        temp.unlink(missing_ok=True)


def validate_zip(path: Path, archive_root: str) -> None:
    with zipfile.ZipFile(path) as zf:
        if zf.testzip() is not None:
            raise RuntimeError(f"CRC validation failed: {path}")
        names = [info.filename for info in zf.infolist() if not info.is_dir()]
        if len(names) != len({name.casefold() for name in names}):
            raise RuntimeError(f"Duplicate archive names: {path}")
        for name in names:
            pure = PurePosixPath(name)
            if pure.is_absolute() or ".." in pure.parts or pure.parts[0] != archive_root:
                raise RuntimeError(f"Unsafe archive path: {name}")
        skill_entries = [name for name in names if name.endswith("/SKILL.md")]
        if len(skill_entries) != 1:
            raise RuntimeError(f"Expected one SKILL.md, found {skill_entries}")


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest().upper()


def build(repo: Path, source_zip: Path, install_zip: Path, checksums: Path) -> None:
    repo = repo.resolve()
    skill = repo / "skills" / "computer-use-studio-pro"
    if not (repo / "README.md").is_file() or not (skill / "SKILL.md").is_file():
        raise RuntimeError(f"Unexpected repository layout: {repo}")
    version = version_from_manifest(skill)
    deterministic_zip(source_zip, repo, "computer-use-studio-pro-bundle")
    deterministic_zip(install_zip, skill, "computer-use-studio-pro")
    lines = [
        f"{sha256(source_zip)}  {source_zip.name}",
        f"{sha256(install_zip)}  {install_zip.name}",
    ]
    checksums.write_text("\n".join(lines) + "\n", encoding="ascii", newline="\n")
    print(f"version={version}")
    print(f"source={source_zip} bytes={source_zip.stat().st_size}")
    print(f"install={install_zip} bytes={install_zip.stat().st_size}")
    print(f"checksums={checksums}")


def self_test() -> None:
    with tempfile.TemporaryDirectory() as temp_dir:
        root = Path(temp_dir) / "repo"
        skill = root / "skills" / "computer-use-studio-pro"
        skill.mkdir(parents=True)
        (root / "README.md").write_text("demo\n", encoding="utf-8")
        (root / ".git").mkdir()
        (root / ".git" / "config").write_text("excluded\n", encoding="utf-8")
        (skill / "SKILL.md").write_text("---\nname: computer-use-studio-pro\ndescription: demo\n---\n", encoding="utf-8")
        (skill / "manifest.yaml").write_text("version: 9.9.9\n", encoding="utf-8")
        out = Path(temp_dir) / "out"
        source = out / "source.zip"
        install = out / "install.zip"
        sums = out / "SHA256SUMS.txt"
        build(root, source, install, sums)
        with zipfile.ZipFile(source) as zf:
            assert all("/.git/" not in name for name in zf.namelist())
        first = source.read_bytes()
        build(root, source, install, sums)
        assert first == source.read_bytes()
        print("self-test: ok")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repo", type=Path)
    parser.add_argument("--source-zip", type=Path)
    parser.add_argument("--install-zip", type=Path)
    parser.add_argument("--checksums", type=Path)
    parser.add_argument("--self-test", action="store_true")
    args = parser.parse_args()
    if args.self_test:
        self_test()
        return
    if not all((args.repo, args.source_zip, args.install_zip, args.checksums)):
        parser.error("--repo, --source-zip, --install-zip, and --checksums are required")
    build(args.repo, args.source_zip, args.install_zip, args.checksums)


if __name__ == "__main__":
    main()
