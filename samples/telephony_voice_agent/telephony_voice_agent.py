"""Create a phone-ready Foundry Voice Agent, bind telephony channels, and place outbound calls or campaigns."""

from __future__ import annotations

import argparse
from datetime import timedelta
import json
import os
from pathlib import Path
import re
import sys
from typing import Any
from urllib.parse import urlsplit
from uuid import UUID, uuid4

from azure.ai.projects import AIProjectClient
from azure.ai.projects import models as m
from azure.core import MatchConditions
from azure.core.exceptions import HttpResponseError
from azure.identity import DefaultAzureCredential
from dotenv import load_dotenv

E164_PATTERN = re.compile(r"^\+[1-9]\d{6,14}$")
NAME_PATTERN = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_-]{0,62}$")


def validate_endpoint(value: str | None) -> str:
    """Validate the Foundry project endpoint, including the _project default-project alias."""
    cleaned = (value or "").strip().rstrip("/")
    message = "Set PROJECT_ENDPOINT to https://<resource>.services.ai.azure.com/api/projects/<project>."
    try:
        parsed = urlsplit(cleaned)
        port = parsed.port
    except ValueError:
        raise ValueError(message) from None
    if (
        any(ch.isspace() or ord(ch) < 32 for ch in cleaned)
        or parsed.scheme != "https"
        or not re.fullmatch(r"[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.services\.ai\.azure\.com", parsed.hostname or "")
        or port not in (None, 443)
        or parsed.username is not None
        or parsed.password is not None
        or "?" in cleaned
        or "#" in cleaned
        or not re.fullmatch(r"/api/projects/(?:_project|[A-Za-z0-9][A-Za-z0-9_-]*)", parsed.path)
    ):
        raise ValueError(message)
    return f"https://{parsed.hostname}{parsed.path}"


def validate_name(value: str | None, flag: str) -> str:
    if not value or not NAME_PATTERN.fullmatch(value):
        raise ValueError(f"Set {flag} to 1-63 letters, digits, hyphens, or underscores, starting with a letter or digit.")
    return value


def validate_phone(value: str | None, flag: str) -> str:
    if not value or not E164_PATTERN.fullmatch(value.strip()):
        raise ValueError(f"Set {flag} to an E.164 phone number such as +14255550100.")
    return value.strip()


def validate_guid(value: str | None, flag: str) -> str:
    if not value:
        raise ValueError(f"Set {flag} to a Microsoft Teams resource-account object GUID.")
    try:
        return str(UUID(value.strip()))
    except ValueError:
        raise ValueError(f"Set {flag} to a valid GUID.") from None


def parse_address(kind: str, value: str, flag: str) -> m.TelephonyAddress:
    if kind == "phone_number":
        return m.PhoneNumber(value=validate_phone(value, flag))
    if kind == "teams":
        return m.TeamsAddress(value=validate_guid(value, flag))
    raise ValueError(f"Unsupported address type {kind!r}.")


def parse_transfer_destination(spec: str) -> m.VoiceAgentTransferDestination:
    raw = spec.strip()
    if raw.startswith(("sip:", "sips:")):
        return m.VoiceAgentTransferDestination(type="sip", value=raw)
    if raw.startswith("teams:"):
        guid = validate_guid(raw.removeprefix("teams:"), "--transfer-destination")
        return m.VoiceAgentTransferDestination(type="teams", value=guid)
    return m.VoiceAgentTransferDestination(
        type="phone_number",
        value=validate_phone(raw, "--transfer-destination"),
    )


def build_voice_definition(args: argparse.Namespace) -> m.VoiceAgentLiveDefinition:
    if not args.model or not args.model.strip():
        raise ValueError("Set --model (or GPT_LIVE_DEPLOYMENT) to your voice deployment name.")
    if not args.responses_model or not args.responses_model.strip():
        raise ValueError("Set --responses-model (or RESPONSES_DEPLOYMENT) to your Responses deployment name.")

    destination = parse_transfer_destination(args.transfer_destination)
    definition = m.VoiceAgentLiveDefinition(
        model_type="self_deployed",
        model=args.model.strip(),
        instructions=(
            "You are Contoso Clinic's phone assistant speaking with {{customer_name}}. "
            "Context: {{call_context}}. Speak in one or two short sentences, pause immediately if "
            "interrupted, and delegate scheduling questions. Use collect_dtmf when a caller enters "
            "a keypad verification code, use send_sms when they ask for directions or links by text, "
            "transfer to scheduling_desk when they ask for a coordinator, and finish with a brief "
            "spoken farewell and end_conversation."
        ),
        structured_inputs={
            "customer_name": m.StructuredInputDefinition(schema={"type": "string"}, default_value="there"),
            "opening_line": m.StructuredInputDefinition(
                schema={"type": "string"},
                default_value="How can I help with your appointment today?",
            ),
            "call_context": m.StructuredInputDefinition(
                schema={"type": "string"},
                default_value="Inbound clinic inquiry",
            ),
        },
        greeting=m.VoiceAgentTemplateGreetingConfig(
            text="Hello {{customer_name}}, this is Contoso Clinic's virtual assistant. {{opening_line}}"
        ),
        audio=m.LiveInitialSessionAudioParam(
            format=m.LiveSessionAudioFormatPCMParam(rate=24000),
            output=m.LiveInitialSessionAudioOutputParam(voice=args.voice.strip()),
        ),
        delegation=m.VoiceAgentLiveResponsesDelegation(
            responses=m.LiveResponsesDelegationSettingsInputParam(
                model=args.responses_model.strip(),
                instructions="Answer clinic scheduling, hours, and preparation questions concisely for phone delivery.",
            )
        ),
        store=args.store,
    )

    system_tools: list[dict[str, Any]] = [
        m.VoiceAgentEndConversationSystemTool().as_dict(),
        m.VoiceAgentCollectDtmfSystemTool().as_dict(),
    ]
    if args.enable_send_dtmf:
        system_tools.append(m.VoiceAgentSendDtmfSystemTool().as_dict())
    if args.enable_sms:
        system_tools.append(m.VoiceAgentSendSmsSystemTool().as_dict())
    system_tools.append(
        m.VoiceAgentTransferSystemTool(
            targets=[
                m.VoiceAgentTransferTarget(
                    name=validate_name(args.transfer_target_name, "--transfer-target-name"),
                    description="Human scheduling coordinator when the caller requests staff assistance.",
                    destinations=[destination],
                    routing=m.VoiceAgentTransferRouting(
                        strategy="sequential",
                        ring_timeout_seconds=timedelta(seconds=args.ring_timeout_seconds),
                    ),
                )
            ]
        ).as_dict()
    )
    definition["tools"] = system_tools
    return definition


def build_binding(args: argparse.Namespace) -> m.TelephonyBinding:
    connection = validate_name(args.connection_name, "--connection-name")
    if args.provider == "twilio":
        return m.TwilioTelephonyBinding(
            connection_name=connection,
            phone_number=validate_phone(args.phone_number, "--phone-number"),
            label=args.label,
        )
    if args.provider == "teams":
        return m.TeamsPhoneExtensibilityTelephonyBinding(
            connection_name=connection,
            resource_account_object_id=validate_guid(args.resource_account_id, "--resource-account-id"),
            phone_number=validate_phone(args.phone_number, "--phone-number") if args.phone_number else None,
            label=args.label,
        )
    if args.provider == "sip":
        callers = [validate_phone(item, "--allowed-caller") for item in (args.allowed_caller or [])]
        return m.SipTelephonyBinding(
            connection_name=connection,
            allowed_calling_numbers=callers or None,
            label=args.label,
        )
    raise ValueError("Choose --provider twilio, teams, or sip.")


def build_call_job(args: argparse.Namespace) -> m.TelephonyCallJobCreate:
    connection = validate_name(args.connection_name, "--connection-name")
    source = parse_address(args.source_type, args.source, "--source")
    destination = m.PhoneNumber(value=validate_phone(args.to, "--to"))
    return m.TelephonyCallJobCreate(
        connection_name=connection,
        source=source,
        destination=destination,
        purpose=args.purpose,
        structured_inputs={
            "customer_name": args.customer_name,
            "opening_line": args.opening_line,
            "call_context": args.call_context,
        },
    )


def load_recipients(path: str) -> list[m.TelephonyRecipient]:
    raw = json.loads(Path(path).read_text(encoding="utf-8"))
    if not isinstance(raw, list) or not (1 <= len(raw) <= 100):
        raise ValueError("Recipients file must be a JSON array with 1 to 100 entries.")
    recipients: list[m.TelephonyRecipient] = []
    for index, item in enumerate(raw):
        if not isinstance(item, dict):
            raise ValueError(f"Recipient entry {index} must be a JSON object.")
        phone = validate_phone(item.get("phone_number"), f"recipients[{index}].phone_number")
        inputs = item.get("structured_inputs")
        if inputs is not None and not isinstance(inputs, dict):
            raise ValueError(f"recipients[{index}].structured_inputs must be an object.")
        recipients.append(
            m.TelephonyRecipient(
                destination=m.PhoneNumber(value=phone),
                structured_inputs=inputs,
            )
        )
    return recipients


def build_campaign(args: argparse.Namespace) -> m.TelephonyCampaign:
    connection = validate_name(args.connection_name, "--connection-name")
    source = parse_address(args.source_type, args.source, "--source")
    if bool(args.recipients_file) == bool(args.dataset_name):
        raise ValueError("Supply exactly one of --recipients-file or --dataset-name.")
    recipients = load_recipients(args.recipients_file) if args.recipients_file else None
    dataset = (
        m.TelephonyCampaignDatasetReference(
            name=validate_name(args.dataset_name, "--dataset-name"),
            version=args.dataset_version,
        )
        if args.dataset_name
        else None
    )
    retry_policy = (
        m.FixedIntervalRetryPolicy(
            interval=timedelta(minutes=args.retry_interval_minutes),
            max_attempts=args.max_attempts,
        )
        if args.max_attempts > 1
        else None
    )
    return m.TelephonyCampaign(
        connection_name=connection,
        source=source,
        recipients=recipients,
        recipient_dataset=dataset,
        retry_policy=retry_policy,
    )


def open_client(endpoint: str) -> tuple[DefaultAzureCredential, AIProjectClient]:
    validated = validate_endpoint(endpoint)
    credential = DefaultAzureCredential()
    client = AIProjectClient(endpoint=validated, credential=credential, allow_preview=True)
    return credential, client


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)

    def add_common(target: argparse.ArgumentParser, *, dry_run: bool = True) -> None:
        target.add_argument("--project-endpoint", default=os.getenv("PROJECT_ENDPOINT"))
        target.add_argument("--agent-name", default=os.getenv("AGENT_NAME", "contoso-clinic-voice"))
        if dry_run:
            target.add_argument("--dry-run", action="store_true", help="Print the SDK payload without calling Azure")

    create = sub.add_parser("create", help="Create a phone-ready Voice Agent version with built-in system tools")
    add_common(create)
    create.add_argument("--model", default=os.getenv("GPT_LIVE_DEPLOYMENT", "gpt-live-1"))
    create.add_argument("--responses-model", default=os.getenv("RESPONSES_DEPLOYMENT", "gpt-4.1"))
    create.add_argument("--voice", default=os.getenv("VOICE", "marin"))
    create.add_argument("--transfer-target-name", default="scheduling_desk")
    create.add_argument(
        "--transfer-destination",
        default=os.getenv("TRANSFER_PHONE_NUMBER", "+14255550199"),
        help="E.164 number (+14255550199), sips: URI, or teams:<guid>",
    )
    create.add_argument("--ring-timeout-seconds", type=int, default=20)
    create.add_argument("--enable-sms", action=argparse.BooleanOptionalAction, default=True)
    create.add_argument("--enable-send-dtmf", action=argparse.BooleanOptionalAction, default=True)
    create.add_argument("--store", action=argparse.BooleanOptionalAction, default=True)

    bind = sub.add_parser("bind", help="Bind an inbound Twilio, Teams Phone, or Direct SIP channel")
    add_common(bind)
    bind.add_argument("--provider", choices=("twilio", "teams", "sip"), required=True)
    bind.add_argument("--connection-name", default=os.getenv("TELEPHONY_CONNECTION_NAME"))
    bind.add_argument("--phone-number", default=os.getenv("SOURCE_PHONE_NUMBER"))
    bind.add_argument("--resource-account-id", default=os.getenv("TEAMS_RESOURCE_ACCOUNT_ID"))
    bind.add_argument("--allowed-caller", action="append")
    bind.add_argument("--label", default="clinic-main-line")

    bindings = sub.add_parser("bindings", help="List inbound bindings for the Voice Agent")
    add_common(bindings, dry_run=False)

    unbind = sub.add_parser("unbind", help="Delete an inbound telephony binding using its current ETag")
    add_common(unbind)
    unbind.add_argument("--binding-id", required=True)

    call = sub.add_parser("call", help="Place a proactive outbound phone call with structured inputs")
    add_common(call)
    call.add_argument("--connection-name", default=os.getenv("TELEPHONY_CONNECTION_NAME"))
    call.add_argument("--source-type", choices=("phone_number", "teams"), default="phone_number")
    call.add_argument("--source", default=os.getenv("SOURCE_PHONE_NUMBER"))
    call.add_argument("--to", required=True, help="Recipient E.164 phone number")
    call.add_argument("--customer-name", default="Alex")
    call.add_argument(
        "--opening-line",
        default="I am calling to confirm your appointment tomorrow at 2:00 PM. Does that time still work?",
    )
    call.add_argument("--call-context", default="Outbound appointment reminder; confirm attendance or reschedule.")
    call.add_argument("--purpose", default="appointment_reminder")
    call.add_argument("--idempotency-key", default=None)

    job = sub.add_parser("job", help="Inspect an outbound call job")
    add_common(job, dry_run=False)
    job.add_argument("--job-id", required=True)

    campaign = sub.add_parser("campaign", help="Start an outbound calling campaign")
    add_common(campaign)
    campaign.add_argument("--campaign-name", required=True)
    campaign.add_argument("--connection-name", default=os.getenv("TELEPHONY_CONNECTION_NAME"))
    campaign.add_argument("--source-type", choices=("phone_number", "teams"), default="phone_number")
    campaign.add_argument("--source", default=os.getenv("SOURCE_PHONE_NUMBER"))
    campaign.add_argument("--recipients-file", default=None)
    campaign.add_argument("--dataset-name", default=None)
    campaign.add_argument("--dataset-version", default=None)
    campaign.add_argument("--max-attempts", type=int, default=2)
    campaign.add_argument("--retry-interval-minutes", type=int, default=15)
    campaign.add_argument("--wait", action="store_true", help="Wait for campaign preparation to complete")

    return parser


def run_cli(argv: list[str] | None = None) -> dict[str, Any]:
    args = build_parser().parse_args(argv)
    agent_name = validate_name(args.agent_name, "--agent-name")

    if args.command == "create":
        definition = build_voice_definition(args)
        if args.dry_run:
            return {"agent_name": agent_name, "definition": definition.as_dict()}
        credential, project = open_client(args.project_endpoint)
        with credential, project:
            created = project.agents.create_version(agent_name=agent_name, definition=definition)
            return {"name": created.name, "version": created.version}

    if args.command == "bind":
        binding = build_binding(args)
        if args.dry_run:
            return {"agent_name": agent_name, "binding": binding.as_dict()}
        credential, project = open_client(args.project_endpoint)
        with credential, project:
            created = project.beta.voice_agents.telephony.create_binding(agent_name, binding)
            return created.as_dict()

    if args.command == "bindings":
        credential, project = open_client(args.project_endpoint)
        with credential, project:
            items = [item.as_dict() for item in project.beta.voice_agents.telephony.list_bindings(agent_name, limit=20)]
            return {"agent_name": agent_name, "bindings": items}

    if args.command == "unbind":
        if not args.binding_id or not args.binding_id.strip():
            raise ValueError("Set --binding-id to the binding identifier to remove.")
        binding_id = args.binding_id.strip()
        if args.dry_run:
            return {"agent_name": agent_name, "delete_binding_id": binding_id}
        credential, project = open_client(args.project_endpoint)
        with credential, project:
            telephony = project.beta.voice_agents.telephony
            matched = next((b for b in telephony.list_bindings(agent_name, limit=100) if b.id == binding_id), None)
            if matched is None:
                raise RuntimeError(f"Binding {binding_id!r} was not found on agent {agent_name!r}.")
            telephony.delete_binding(
                agent_name,
                binding_id,
                etag=matched.etag,
                match_condition=MatchConditions.IfNotModified,
            )
            return {"deleted_binding_id": binding_id}

    if args.command == "call":
        call_job = build_call_job(args)
        key = args.idempotency_key or str(uuid4())
        if args.dry_run:
            return {"agent_name": agent_name, "idempotency_key": key, "job": call_job.as_dict()}
        credential, project = open_client(args.project_endpoint)
        with credential, project:
            queued = project.beta.voice_agents.telephony.create_call_job(
                agent_name,
                call_job,
                idempotency_key=key,
            )
            return queued.as_dict()

    if args.command == "job":
        credential, project = open_client(args.project_endpoint)
        with credential, project:
            found = project.beta.voice_agents.telephony.get_call_job(agent_name, args.job_id.strip())
            return found.as_dict()

    if args.command == "campaign":
        campaign_name = validate_name(args.campaign_name, "--campaign-name")
        campaign_body = build_campaign(args)
        if args.dry_run:
            return {
                "agent_name": agent_name,
                "campaign_name": campaign_name,
                "campaign": campaign_body.as_dict(),
            }
        credential, project = open_client(args.project_endpoint)
        with credential, project:
            poller = project.beta.voice_agents.campaigns.begin_create(
                agent_name,
                campaign_name,
                campaign_body,
            )
            if args.wait:
                return poller.result().as_dict()
            current = project.beta.voice_agents.campaigns.get(agent_name, campaign_name)
            return current.as_dict()

    raise ValueError(f"Unsupported command {args.command!r}.")


def main(argv: list[str] | None = None) -> None:
    load_dotenv()
    result = run_cli(argv)
    print(json.dumps(result, indent=2, ensure_ascii=False, default=str))


if __name__ == "__main__":
    try:
        main()
    except HttpResponseError as error:
        status = getattr(error, "status_code", "unknown")
        print(f"Error: Foundry returned HTTP {status}.", file=sys.stderr)
        raise SystemExit(1) from None
    except (ValueError, RuntimeError, OSError) as error:
        print(f"Error: {error}", file=sys.stderr)
        raise SystemExit(1) from None
