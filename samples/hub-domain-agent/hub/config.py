"""Hub-only configuration and pinned specialist references."""

from __future__ import annotations

import os
import re
from dataclasses import dataclass

from common.config import Config


@dataclass(frozen=True)
class DomainReference:
    name: str
    version: str


@dataclass(frozen=True)
class HubConfig(Config):
    domains: dict[str, DomainReference]

    @classmethod
    def from_env(cls) -> HubConfig:
        base = Config.from_env()
        domains = {}
        for role in ("billing", "booking"):
            name = os.environ[role.upper() + "_DOMAIN_AGENT"]
            version = os.environ[role.upper() + "_DOMAIN_VERSION"]
            if not re.fullmatch(r"[a-zA-Z0-9][a-zA-Z0-9-]{0,62}", name) or not version.isdecimal():
                raise ValueError("Domain agent names and pinned numeric versions are required")
            domains[role] = DomainReference(name, version)
        return cls(base.endpoint, base.model, domains)
