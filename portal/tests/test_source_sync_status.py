# Copyright (c) Microsoft. All rights reserved.

import json
import tempfile
import unittest
from pathlib import Path

from tools.source_sync_status import (
    SYNC_MANIFEST,
    effective_mappings,
    exact_drift,
    porcelain_paths,
    safe_relative,
)


class SourceSyncStatusTests(unittest.TestCase):
    def test_later_mapping_overrides_runtime_provenance_action(self) -> None:
        original = {
            "source": "web/src/config.js",
            "destination": "web/src/config.js",
            "action": "copied",
        }
        adapted = {**original, "action": "adapted"}

        self.assertEqual(
            {"web/src/config.js": adapted},
            effective_mappings([original, adapted]),
        )

    def test_safe_relative_rejects_parent_escape(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            with self.assertRaises(ValueError):
                safe_relative(Path(directory), "../outside")

    def test_exact_drift_accepts_identical_files(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory)
            source_file = source / "same.txt"
            source_file.write_text("same", encoding="utf-8")
            destination = Path(__file__).resolve().parents[1] / "same-test.txt"
            try:
                destination.write_text("same", encoding="utf-8")
                self.assertIsNone(
                    exact_drift(
                        source,
                        "WORKTREE",
                        {
                            "source": "same.txt",
                            "destination": "same-test.txt",
                            "action": "exact",
                        },
                    )
                )
            finally:
                destination.unlink(missing_ok=True)

    def test_non_exact_mapping_does_not_require_byte_identity(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            self.assertIsNone(
                exact_drift(
                    Path(directory),
                    "WORKTREE",
                    {
                        "source": "missing-source.py",
                        "destination": "missing-destination.py",
                        "action": "adapted",
                    },
                )
            )

    def test_porcelain_paths_preserves_both_sides_of_renames(self) -> None:
        self.assertEqual(
            {"new-name.py", "old-name.py", "regular.py"},
            porcelain_paths(
                b"R  new-name.py\0old-name.py\0 M regular.py\0"
            ),
        )

    def test_manifest_tracks_shared_mcp_source_review(self) -> None:
        manifest = json.loads(
            SYNC_MANIFEST.read_text(encoding="utf-8")
        )
        mcp = manifest["mcp_source"]
        self.assertEqual("docs/voice_agent/11_mcp_server", mcp["root"])
        self.assertIn("../shared_mcp", mcp["review_targets"])
        self.assertIn("templates.config.json", mcp["review_targets"])

    def test_manifest_tracks_handoff_authoring_surface(self) -> None:
        manifest = json.loads(
            SYNC_MANIFEST.read_text(encoding="utf-8")
        )
        self.assertEqual(
            "tests/voice-agent-tests/voice-agents-tests-dashboard/handoff_view",
            manifest["source"]["roots"]["handoff_view"],
        )
        mappings = {
            item["source"]: item
            for item in manifest["handoff_mappings"]
        }
        self.assertEqual(
            "adapted",
            mappings["static/handoff-core.mjs"]["action"],
        )
        self.assertEqual(
            "adapted",
            mappings["static/handoff.css"]["action"],
        )
        self.assertEqual(
            "static/handoff/handoff-app.js",
            mappings["static/handoff-app.js"]["destination"],
        )

    def test_manifest_tracks_template_inputs_and_public_sample_definitions(
        self,
    ) -> None:
        manifest = json.loads(
            SYNC_MANIFEST.read_text(encoding="utf-8")
        )
        mappings = {
            item["root"]: item
            for item in manifest["sample_mappings"]
        }
        self.assertEqual(
            "adapted",
            mappings["template_config"]["action"],
        )
        expected_actions = {
            "template_example1": "adapted",
            "template_example2": "exact",
        }
        for root, action in expected_actions.items():
            self.assertEqual(action, mappings[root]["action"])
            self.assertEqual(
                "voice_agent",
                mappings[root]["destination_root"],
            )

    def test_manifest_accepts_the_latest_template_pr_revision(self) -> None:
        manifest = json.loads(
            SYNC_MANIFEST.read_text(encoding="utf-8")
        )
        source = manifest["source"]
        self.assertEqual(
            "88185887035f63a6b81114d7b38305532ebb6ad0",
            source["base_commit"],
        )
        self.assertEqual(
            "refs/heads/agents/add-voice-agent-template-prototypes",
            source["accepted_ref"],
        )
        self.assertEqual("2026-09-17", source["accepted_on"])


if __name__ == "__main__":
    unittest.main()
