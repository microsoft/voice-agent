#!/usr/bin/env python3
"""Publish, verify, or run the voice agent cost advisor."""

from pathlib import Path
import sys

SAMPLES_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(SAMPLES_DIR))

from voice_agent_sdk_common import sample_cli  # noqa: E402


if __name__ == "__main__":
    sample_cli(
        Path(__file__).resolve().parent,
        mode="typed",
        # Flash runs MCP locally, where each tool is called {server_label}_{tool}; GPT Realtime runs it natively
        # under the tool's own name. One set of instructions cannot name both, so each model has its own file.
        variants={"realtime": "agent.json", "flash": "agent.flash.json"},
    )
