"""Crash-safe local ownership/result checkpoints; no network or business logic."""

import json
import os
import tempfile
from pathlib import Path
from typing import Any


def write_report(path: Path, report: dict[str, Any]) -> None:
    """Replace a report atomically so a process kill cannot leave partial JSON."""
    descriptor, temporary = tempfile.mkstemp(prefix="." + path.name + "-", dir=path.parent)
    try:
        with os.fdopen(descriptor, "w", encoding="utf-8") as stream:
            json.dump(report, stream, indent=2)
            stream.write("\n")
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, path)
    finally:
        Path(temporary).unlink(missing_ok=True)
