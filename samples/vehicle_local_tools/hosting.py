"""Persistent admission limits for the anonymous, single-instance demo."""

from contextlib import closing
from pathlib import Path
import sqlite3
import time
from urllib.parse import urlsplit


def public_origin(value: str) -> str:
    parsed = urlsplit(value)
    if (
        parsed.scheme != "https" or not parsed.hostname
        or parsed.username or parsed.password or parsed.port not in (None, 443)
        or parsed.path or parsed.query or parsed.fragment
        or parsed.netloc != parsed.hostname
    ):
        raise ValueError("PUBLIC_ORIGIN must be an HTTPS origin without a path or port.")
    return value


class PublicDemoLimits:
    def __init__(self, path: Path, voice_starts: int = 20, manual_actions: int = 120) -> None:
        if voice_starts <= 0 or manual_actions <= 0:
            raise ValueError("Public demo admission limits must be positive.")
        self.path = path
        self.voice_starts = voice_starts
        self.manual_actions = manual_actions
        path.parent.mkdir(parents=True, exist_ok=True)
        with closing(sqlite3.connect(path)) as database, database:
            database.execute("CREATE TABLE IF NOT EXISTS admissions (kind TEXT, started REAL)")
            database.execute("CREATE INDEX IF NOT EXISTS admissions_kind_time ON admissions (kind, started)")

    def admit(self, kind: str) -> bool:
        if kind not in {"voice", "manual"}:
            raise ValueError("Unknown public demo admission type.")
        window = 86400 if kind == "voice" else 60
        limit = self.voice_starts if kind == "voice" else self.manual_actions
        now = time.time()
        with closing(sqlite3.connect(self.path)) as database, database:
            database.execute("BEGIN IMMEDIATE")
            database.execute("DELETE FROM admissions WHERE kind = ? AND started <= ?", (kind, now - window))
            count = database.execute("SELECT COUNT(*) FROM admissions WHERE kind = ?", (kind,)).fetchone()[0]
            if count >= limit:
                return False
            database.execute("INSERT INTO admissions VALUES (?, ?)", (kind, now))
        return True
