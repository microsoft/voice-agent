"""Offline paper-agent SDK contracts; these do not test model routing accuracy."""

from __future__ import annotations

import importlib.util
import io
import json
import os
import sys
import unittest
from contextlib import redirect_stderr, redirect_stdout
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from azure.core.exceptions import HttpResponseError, ResourceNotFoundError

SAMPLE = Path(__file__).resolve().parents[1] / "samples" / "subagent" / "paper-agent"
ENVIRONMENT = {
    "PROJECT_ENDPOINT": "https://sample.services.ai.azure.com/api/projects/sample",
    "SUBAGENT_MODEL_DEPLOYMENT": "paper-model",
    "VOICE_MODEL_DEPLOYMENT": "gpt-realtime",
    "VOICE_NAME": "en-US-AvaNeural",
}


def load_script(name):
    spec = importlib.util.spec_from_file_location(f"paper_agent_{name}", SAMPLE / f"{name}.py")
    module = importlib.util.module_from_spec(spec)
    with patch.object(sys, "path", [str(SAMPLE), *sys.path]), patch.dict(sys.modules):
        sys.modules.pop("sample_utils", None)
        spec.loader.exec_module(module)
    return module


class PaperAgentTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.create = load_script("create_agents")
        cls.delete = load_script("delete_agents")

    def setUp(self):
        environment = patch.dict(os.environ, ENVIRONMENT, clear=True)
        environment.start()
        self.addCleanup(environment.stop)
        for module in (self.create, self.delete):
            dotenv = patch.object(module, "load_dotenv")
            dotenv.start()
            self.addCleanup(dotenv.stop)
        self.output = io.StringIO()
        output = redirect_stdout(self.output)
        output.__enter__()
        self.addCleanup(output.__exit__, None, None, None)

    def test_sdk_serialization_keeps_search_on_specialist_and_disables_auto_ack(self):
        specialist = self.create.prompt_definition("paper-model").as_dict()
        frontend = self.create.voice_definition(
            "gpt-realtime", "paper-specialist-test", "en-US-AvaNeural"
        ).as_dict()
        self.assertEqual(specialist["kind"], "prompt")
        self.assertEqual(specialist["model"], "paper-model")
        self.assertEqual(specialist["tools"], [{"type": "web_search"}])
        self.assertEqual(frontend["kind"], "voice")
        self.assertFalse(frontend.get("tools"))
        config = frontend["subagent_config"]
        self.assertEqual(config["subagent_type"], "delegate")
        self.assertEqual(len(config["subagents"]), 1)
        reference = config["subagents"][0]
        self.assertEqual(reference["agent_name"], "paper-specialist-test")
        self.assertEqual(reference["response_policy"], {"immediate_ack": False})
        for direction in ("input", "output"):
            self.assertEqual(frontend["audio"][direction]["format"], {
                "type": "audio/pcm", "rate": 24000,
            })
        self.assertEqual(frontend["output_modalities"], ["audio"])

    def test_dry_run_does_not_require_endpoint_or_authenticate(self):
        del os.environ["PROJECT_ENDPOINT"]
        with (
            patch.object(sys, "argv", ["create_agents.py", "--dry-run"]),
            patch.object(self.create, "DefaultAzureCredential") as credential,
            patch.object(self.create, "AIProjectClient") as client,
        ):
            self.create.main()
        payload = json.loads(self.output.getvalue())
        referenced_name = payload["voice_definition"]["subagent_config"]["subagents"][0]["agent_name"]
        self.assertEqual(referenced_name, payload["subagent_name"])
        self.assertNotEqual(payload["voice_agent_name"], payload["subagent_name"])
        credential.assert_not_called()
        client.assert_not_called()

    def test_missing_deployment_fails_before_authentication(self):
        os.environ["SUBAGENT_MODEL_DEPLOYMENT"] = " "
        with (
            patch.object(sys, "argv", ["create_agents.py"]),
            patch.object(self.create, "DefaultAzureCredential") as credential,
            self.assertRaisesRegex(ValueError, "SUBAGENT_MODEL_DEPLOYMENT is required"),
        ):
            self.create.main()
        credential.assert_not_called()

    def test_invalid_endpoint_fails_before_authentication(self):
        os.environ["PROJECT_ENDPOINT"] = "http://example.invalid"
        with (
            patch.object(sys, "argv", ["create_agents.py"]),
            patch.object(self.create, "DefaultAzureCredential") as credential,
            self.assertRaisesRegex(ValueError, "HTTPS endpoint"),
        ):
            self.create.main()
        credential.assert_not_called()

    def create_with_client(self, project):
        with (
            patch.object(sys, "argv", ["create_agents.py"]),
            patch.object(self.create, "DefaultAzureCredential"),
            patch.object(self.create, "AIProjectClient") as client,
        ):
            client.return_value.__enter__.return_value = project
            self.create.main()
        self.assertTrue(client.call_args.kwargs["allow_preview"])
        self.assertEqual(client.call_args.kwargs["endpoint"], ENVIRONMENT["PROJECT_ENDPOINT"])

    def test_creation_orders_specialist_before_referencing_frontend(self):
        project = MagicMock()
        project.agents.create_version.side_effect = (
            lambda **kwargs: SimpleNamespace(name=kwargs["agent_name"], version="1")
        )
        self.create_with_client(project)
        specialist, frontend = project.agents.create_version.call_args_list
        specialist_name = specialist.kwargs["agent_name"]
        voice_name = frontend.kwargs["agent_name"]
        self.assertEqual(specialist.kwargs["definition"].as_dict()["kind"], "prompt")
        reference = frontend.kwargs["definition"].as_dict()["subagent_config"]["subagents"][0]
        self.assertEqual(reference["agent_name"], specialist_name)
        self.assertIn(f"--voice-agent-name {voice_name}", self.output.getvalue())
        self.assertIn(f"--subagent-name {specialist_name}", self.output.getvalue())

    def test_partial_creation_failure_propagates_with_explicit_cleanup(self):
        project = MagicMock()
        failure = HttpResponseError(message="Voice creation denied")
        project.agents.create_version.side_effect = [
            SimpleNamespace(name="paper-specialist-test", version="1"),
            failure,
        ]
        with redirect_stderr(io.StringIO()) as errors, self.assertRaises(HttpResponseError) as raised:
            self.create_with_client(project)
        self.assertIs(raised.exception, failure)
        self.assertIn("one or both agents may exist", errors.getvalue())
        self.assertIn("delete_agents.py --voice-agent-name paper-voice-", errors.getvalue())
        self.assertIn("--subagent-name paper-specialist-", errors.getvalue())
        project.agents.delete.assert_not_called()

    def delete_with_client(self, project):
        with (
            patch.object(sys, "argv", [
                "delete_agents.py", "--voice-agent-name", "paper-voice-test",
                "--subagent-name", "paper-specialist-test",
            ]),
            patch.object(self.delete, "DefaultAzureCredential"),
            patch.object(self.delete, "AIProjectClient") as client,
        ):
            client.return_value.__enter__.return_value = project
            self.delete.main()

    def test_cleanup_continues_when_voice_agent_is_already_deleted(self):
        project = MagicMock()
        project.agents.delete.side_effect = [ResourceNotFoundError(message="Missing"), None]
        self.delete_with_client(project)
        self.assertEqual(
            [call.kwargs["agent_name"] for call in project.agents.delete.call_args_list],
            ["paper-voice-test", "paper-specialist-test"],
        )
        self.assertIn("Agent already deleted: paper-voice-test", self.output.getvalue())
        self.assertIn("Deleted agent: paper-specialist-test", self.output.getvalue())

    def test_cleanup_does_not_hide_permission_errors(self):
        project = MagicMock()
        project.agents.delete.side_effect = HttpResponseError(message="Forbidden")
        with self.assertRaisesRegex(HttpResponseError, "Forbidden"):
            self.delete_with_client(project)
        project.agents.delete.assert_called_once_with(agent_name="paper-voice-test")
        self.assertNotIn("Deleted agent:", self.output.getvalue())


if __name__ == "__main__":
    unittest.main()
