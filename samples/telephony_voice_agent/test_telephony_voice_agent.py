"""Offline unit tests for the Voice Agent telephony, system tools, and outbound calling sample."""

from __future__ import annotations

import io
import json
from pathlib import Path
import tempfile
import unittest
from contextlib import redirect_stdout
from unittest.mock import MagicMock, patch

from azure.core import MatchConditions

import telephony_voice_agent as sample

ENDPOINT = "https://contoso.services.ai.azure.com/api/projects/clinic"
DEFAULT_ENDPOINT = "https://contoso.services.ai.azure.com/api/projects/_project"
SAMPLE_DIR = Path(__file__).resolve().parent


class TelephonyVoiceAgentSampleTests(unittest.TestCase):
    def test_validate_endpoint_accepts_named_and_default_project(self) -> None:
        self.assertEqual(sample.validate_endpoint(ENDPOINT + "/"), ENDPOINT)
        self.assertEqual(sample.validate_endpoint(DEFAULT_ENDPOINT), DEFAULT_ENDPOINT)

    def test_validate_endpoint_rejects_malformed_urls(self) -> None:
        for bad in (
            "",
            "http://contoso.services.ai.azure.com/api/projects/clinic",
            "https://evil.example.com/api/projects/clinic",
            "https://contoso.services.ai.azure.com/api/projects/_project/extra",
            "https://contoso.services.ai.azure.com/api/projects/clinic?api-version=v1",
            "https://user@contoso.services.ai.azure.com/api/projects/clinic",
        ):
            with self.subTest(bad=bad), self.assertRaises(ValueError):
                sample.validate_endpoint(bad)

    def test_create_dry_run_builds_live_definition_with_shared_system_tools(self) -> None:
        with patch.object(sample, "open_client") as client_factory:
            result = sample.run_cli(
                [
                    "create",
                    "--agent-name",
                    "contoso-clinic-voice",
                    "--model",
                    "gpt-live-1",
                    "--responses-model",
                    "gpt-4.1",
                    "--transfer-destination",
                    "+14255550199",
                    "--dry-run",
                ]
            )
            client_factory.assert_not_called()

        defn = result["definition"]
        self.assertEqual(defn["kind"], "voice")
        self.assertEqual(defn["sub_protocol"], "live")
        self.assertEqual(defn["delegation"]["type"], "responses")
        self.assertIn("customer_name", defn["structured_inputs"])
        self.assertEqual(defn["greeting"]["type"], "template")

        tool_names = [tool["name"] for tool in defn["tools"]]
        self.assertEqual(
            tool_names,
            ["end_conversation", "collect_dtmf", "send_dtmf", "send_sms", "transfer"],
        )
        transfer_tool = defn["tools"][-1]
        self.assertEqual(transfer_tool["type"], "system")
        self.assertEqual(transfer_tool["targets"][0]["name"], "scheduling_desk")
        self.assertEqual(transfer_tool["targets"][0]["routing"]["ring_timeout_seconds"], 20)

    def test_transfer_destination_supports_sip_and_teams_targets(self) -> None:
        sip_dest = sample.parse_transfer_destination("sips:queue@sbc.contoso.com").as_dict()
        self.assertEqual(sip_dest, {"type": "sip", "value": "sips:queue@sbc.contoso.com"})

        teams_dest = sample.parse_transfer_destination(
            "teams:11111111-2222-3333-4444-555555555555"
        ).as_dict()
        self.assertEqual(
            teams_dest,
            {"type": "teams", "value": "11111111-2222-3333-4444-555555555555"},
        )

    def test_bind_dry_run_supports_twilio_teams_and_sip(self) -> None:
        twilio = sample.run_cli(
            [
                "bind",
                "--provider",
                "twilio",
                "--connection-name",
                "contoso-twilio",
                "--phone-number",
                "+14255550100",
                "--dry-run",
            ]
        )["binding"]
        self.assertEqual(twilio["provider"], "twilio")
        self.assertEqual(twilio["phone_number"], "+14255550100")

        teams = sample.run_cli(
            [
                "bind",
                "--provider",
                "teams",
                "--connection-name",
                "contoso-acs",
                "--resource-account-id",
                "11111111-2222-3333-4444-555555555555",
                "--dry-run",
            ]
        )["binding"]
        self.assertEqual(teams["provider"], "teams_phone_extensibility")
        self.assertEqual(
            teams["resource_account_object_id"],
            "11111111-2222-3333-4444-555555555555",
        )

        sip = sample.run_cli(
            [
                "bind",
                "--provider",
                "sip",
                "--connection-name",
                "contoso-sip",
                "--allowed-caller",
                "+14255550100",
                "--dry-run",
            ]
        )["binding"]
        self.assertEqual(sip["provider"], "sip")
        self.assertEqual(sip["allowed_calling_numbers"], ["+14255550100"])

    def test_call_dry_run_builds_outbound_call_job(self) -> None:
        result = sample.run_cli(
            [
                "call",
                "--connection-name",
                "contoso-twilio",
                "--source",
                "+14255550100",
                "--to",
                "+14255550123",
                "--customer-name",
                "Alex",
                "--idempotency-key",
                "fixed-key-1",
                "--dry-run",
            ]
        )
        self.assertEqual(result["idempotency_key"], "fixed-key-1")
        self.assertEqual(result["job"]["source"], {"type": "phone_number", "value": "+14255550100"})
        self.assertEqual(result["job"]["destination"], {"type": "phone_number", "value": "+14255550123"})
        self.assertEqual(result["job"]["structured_inputs"]["customer_name"], "Alex")

    def test_campaign_dry_run_supports_inline_recipients_and_dataset(self) -> None:
        inline = sample.run_cli(
            [
                "campaign",
                "--campaign-name",
                "tuesday-reminders",
                "--connection-name",
                "contoso-twilio",
                "--source",
                "+14255550100",
                "--recipients-file",
                str(SAMPLE_DIR / "recipients.example.json"),
                "--dry-run",
            ]
        )["campaign"]
        self.assertEqual(len(inline["recipients"]), 2)
        self.assertEqual(inline["retry_policy"]["type"], "fixed_interval")
        self.assertEqual(inline["retry_policy"]["interval"], 900)

        dataset = sample.run_cli(
            [
                "campaign",
                "--campaign-name",
                "dataset-reminders",
                "--connection-name",
                "contoso-twilio",
                "--source",
                "+14255550100",
                "--dataset-name",
                "patients-tuesday",
                "--dataset-version",
                "1",
                "--dry-run",
            ]
        )["campaign"]
        self.assertEqual(dataset["recipient_dataset"], {"name": "patients-tuesday", "version": "1"})

        with self.assertRaises(ValueError):
            sample.run_cli(
                [
                    "campaign",
                    "--campaign-name",
                    "invalid-both",
                    "--connection-name",
                    "contoso-twilio",
                    "--source",
                    "+14255550100",
                    "--recipients-file",
                    str(SAMPLE_DIR / "recipients.example.json"),
                    "--dataset-name",
                    "patients-tuesday",
                    "--dry-run",
                ]
            )

    def test_live_operations_invoke_projects_sdk_methods_with_etag_guards(self) -> None:
        cred = MagicMock()
        project = MagicMock()
        cred.__enter__.return_value = cred
        project.__enter__.return_value = project

        item = MagicMock()
        item.id = "twilio:14255550100"
        item.etag = '"etag-1"'
        project.beta.voice_agents.telephony.list_bindings.return_value = [item]

        queued_job = MagicMock()
        queued_job.as_dict.return_value = {"id": "job-1", "status": "queued"}
        project.beta.voice_agents.telephony.create_call_job.return_value = queued_job

        with patch.object(sample, "open_client", return_value=(cred, project)):
            deleted = sample.run_cli(
                [
                    "unbind",
                    "--project-endpoint",
                    ENDPOINT,
                    "--agent-name",
                    "contoso-clinic-voice",
                    "--binding-id",
                    "twilio:14255550100",
                ]
            )
            self.assertEqual(deleted, {"deleted_binding_id": "twilio:14255550100"})
            project.beta.voice_agents.telephony.delete_binding.assert_called_once_with(
                "contoso-clinic-voice",
                "twilio:14255550100",
                etag='"etag-1"',
                match_condition=MatchConditions.IfNotModified,
            )

            with redirect_stdout(io.StringIO()) as out:
                sample.main(
                    [
                        "call",
                        "--project-endpoint",
                        ENDPOINT,
                        "--agent-name",
                        "contoso-clinic-voice",
                        "--connection-name",
                        "contoso-twilio",
                        "--source",
                        "+14255550100",
                        "--to",
                        "+14255550123",
                        "--idempotency-key",
                        "idem-123",
                    ]
                )
            self.assertEqual(json.loads(out.getvalue())["id"], "job-1")
            project.beta.voice_agents.telephony.create_call_job.assert_called_once()

    def test_recipients_validation_rejects_empty_or_invalid_entries(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            bad_path = Path(tmp) / "bad.json"
            bad_path.write_text("[]", encoding="utf-8")
            with self.assertRaises(ValueError):
                sample.load_recipients(str(bad_path))


if __name__ == "__main__":
    unittest.main()
