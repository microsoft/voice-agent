"""Shared project/model configuration; no Hub or specialist selection."""

from __future__ import annotations

import os
import re
from dataclasses import dataclass
from urllib.parse import urlsplit


def project_endpoint(value: str) -> str:
    """Validate the project URL before sending any credentials."""
    parsed = urlsplit(value)
    if (
        parsed.scheme != "https"
        or not parsed.hostname
        or parsed.username
        or parsed.password
        or parsed.query
        or parsed.fragment
        or not re.fullmatch(r"/api/projects/[^/]+/?", parsed.path)
    ):
        raise ValueError("PROJECT_ENDPOINT must be an HTTPS Foundry /api/projects/<project> URL")
    return value.rstrip("/")


@dataclass(frozen=True)
class Config:
    endpoint: str
    model: str

    @classmethod
    def from_env(cls) -> Config:
        return cls(project_endpoint(os.environ["PROJECT_ENDPOINT"]), os.environ["MODEL_DEPLOYMENT"])
