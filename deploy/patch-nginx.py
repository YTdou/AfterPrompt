#!/usr/bin/env python3
from __future__ import annotations

import os
import shutil
import sys
from datetime import datetime, timezone
from pathlib import Path


def fail(message: str) -> None:
    raise SystemExit(message)


if len(sys.argv) != 3:
    fail("usage: patch-nginx.py <nginx-server-config> <include-path>")

config_path = Path(sys.argv[1])
include_path = Path(sys.argv[2])
include_line = f"    include {include_path};"
anchor = "    # GPUnionGate is now the root site."

source = config_path.read_text(encoding="utf-8")
if include_line in source:
    print("UNCHANGED")
    raise SystemExit(0)

if source.count(anchor) != 1:
    fail(f"expected exactly one Nginx insertion anchor in {config_path}")

timestamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
backup_path = config_path.with_name(f"{config_path.name}.pre-last-mile-studio-{timestamp}")
shutil.copy2(config_path, backup_path)

replacement = (
    "    # Last Mile Studio routes are isolated in a reviewed snippet.\n"
    f"{include_line}\n\n"
    f"{anchor}"
)
updated = source.replace(anchor, replacement, 1)
temporary_path = config_path.with_name(f".{config_path.name}.last-mile-studio.tmp")
stat = config_path.stat()
temporary_path.write_text(updated, encoding="utf-8")
os.chmod(temporary_path, stat.st_mode)
os.chown(temporary_path, stat.st_uid, stat.st_gid)
os.replace(temporary_path, config_path)

print(backup_path)
