#!/usr/bin/env python3
"""Build Ren's deterministic Chrome Web Store ZIP from runtime files only."""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile, ZipInfo


ROOT = Path(__file__).resolve().parent.parent
RUNTIME_FILES = (
    "THIRD_PARTY_NOTICES.txt",
    "background.js",
    "editor.js",
    "icons/icon16.png",
    "icons/icon32.png",
    "icons/icon48.png",
    "icons/icon128.png",
    "icons/ren.svg",
    "manifest.json",
    "sidepanel.html",
    "sidepanel.js",
    "settings.js",
    "storage.js",
    "styles.css",
)


def write_entry(archive: ZipFile, relative_path: str) -> None:
    source = ROOT / relative_path
    if not source.is_file():
        raise FileNotFoundError(f"Required runtime file is missing: {relative_path}")

    entry = ZipInfo(relative_path, date_time=(1980, 1, 1, 0, 0, 0))
    entry.compress_type = ZIP_DEFLATED
    entry.external_attr = 0o100644 << 16
    archive.writestr(entry, source.read_bytes(), compresslevel=9)


def build_archive(output: Path) -> None:
    output.parent.mkdir(parents=True, exist_ok=True)
    with ZipFile(output, "w") as archive:
        for relative_path in sorted(RUNTIME_FILES):
            write_entry(archive, relative_path)


def main() -> None:
    manifest = json.loads((ROOT / "manifest.json").read_text(encoding="utf-8"))
    default_output = ROOT / "dist" / f"ren-v{manifest['version']}.zip"
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("output", nargs="?", type=Path, default=default_output)
    args = parser.parse_args()

    output = args.output.resolve()
    build_archive(output)

    print(f"Built {output.name} ({output.stat().st_size} bytes, {len(RUNTIME_FILES)} files)")


if __name__ == "__main__":
    main()
