# Copyright (c) Microsoft. All rights reserved.
"""Generate the turn detection variants of three portal Templates.

Each variant is its base example's ``agent.json`` with the same workflow, prompts, tools and voice, and a
different audio input: speech start detection (``speech_start_detection`` with ``turn_taking_classifier``), Text EOU
based Decision (``end_of_utterance_detection.model = microsoft-decision-1``), streaming transcription with
an explicit language, and personal noise suppression. The root instructions gain a short note about how a
paused turn reaches a realtime model.

Usage::

    python samples/turn_detection/template_variants.py          # write the variants
    python samples/turn_detection/template_variants.py --check  # fail when a variant is out of date
"""
from __future__ import annotations

import argparse
import copy
import json
import sys
from dataclasses import dataclass
from pathlib import Path

SAMPLES = Path(__file__).resolve().parents[1]
VARIANT_FILE = "agent.turn_detection.json"

ENGLISH_ACKNOWLEDGEMENTS = [
    "mm-hmm", "mhm", "uh-huh", "mm", "hmm", "yeah", "yes", "yep", "okay", "ok", "right", "sure", "i see",
    "got it", "okay i see", "yeah yeah", "oh", "cool", "nice", "alright", "uh huh", "okay okay",
]
ENGLISH_INTERRUPTIONS = ["stop", "wait", "hold on", "hang on", "excuse me", "sorry", "pause"]
HINDI_ACKNOWLEDGEMENTS = [
    "हाँ", "हां", "हाँ जी", "हां जी", "जी", "जी हाँ", "अच्छा", "ठीक है", "हम्म", "हूँ", "ओके", "okay", "ok", "हम",
]
HINDI_INTERRUPTIONS = ["रुकिए", "रुको", "एक मिनट", "सुनिए", "रुकिये", "stop", "wait"]

EOU_INSTRUCTIONS = (
    "Decide whether the user has finished their conversational turn, so the assistant should respond now, "
    "or has only paused and is likely to keep talking. user_utterance is a live speech transcript up to the "
    "current pause; its punctuation is unreliable. Use assistant_last_utterance to judge what kind of answer "
    "the user is giving. When assistant_last_utterance is (none), judge from user_utterance alone. "
)

PAUSED_TURN_NOTE = (
    "\n\nTurn-taking: when the caller pauses mid-sentence, one turn can arrive as several consecutive caller "
    "messages, for example \"My date of birth is\" and then \"March 14, 1985\". Read consecutive caller "
    "messages together as one turn; the last one usually completes the first. When a number, a code or an "
    "email address arrives in pieces, join the pieces exactly, without adding spaces or punctuation between "
    "them: \"dana dot test 2026\" and then \"1020 at example dot com\" is dana.test20261020@example.com."
)


@dataclass(frozen=True)
class Variant:
    folder: str
    name: str
    description: str
    language: str
    vad_type: str
    acknowledgements: list[str]
    interruptions: list[str]
    not_turn: str
    eou_hint: str
    extra_note: str = ""


VARIANTS = [
    Variant(
        folder="example1_finance_with_handoff_realtime_hi_in",
        name="finance-hi-in-turn-detection",
        description=(
            "Hindi outbound personal-loan call (identity check, offer, charges with bureau consent, and "
            "appointment) with turn detection: 'जी' or 'हाँ जी' while the agent reads the offer does not "
            "interrupt it, speech to family members at home is ignored, and a pause in the middle of a date "
            "of birth does not end the caller's turn."
        ),
        language="hi-IN",
        vad_type="azure_semantic_vad_multilingual",
        acknowledgements=HINDI_ACKNOWLEDGEMENTS,
        interruptions=HINDI_INTERRUPTIONS,
        not_turn=(
            "Backchannels such as जी, हाँ जी, अच्छा, ठीक है or हम्म are not a turn, including while the "
            "assistant reads the loan offer, the charges or the consent text. Speech the user addresses to "
            "someone else nearby rather than to the assistant (for example telling a child to turn down the "
            "TV or asking a family member to wait) is not a turn either. The caller is at home with family."
        ),
        eou_hint=(
            "A date of birth needs both a day and a month; a day without a month has not been finished. "
            "An appointment time needs both a day and a time of day."
        ),
    ),
    Variant(
        folder="example10_collections_payment_recovery_agent",
        name="collections-turn-detection",
        description=(
            "Collections call (verify, discuss the balance, arrange a payment, or offer hardship options) with "
            "turn detection: 'okay' or 'mm-hmm' while the agent reads the balance and options does not "
            "interrupt it, speech to someone else at home is ignored, and a pause while the caller reads "
            "digits or a date of birth does not end the caller's turn."
        ),
        language="en-US",
        vad_type="azure_semantic_vad",
        acknowledgements=ENGLISH_ACKNOWLEDGEMENTS,
        interruptions=ENGLISH_INTERRUPTIONS,
        not_turn=(
            "Backchannels such as okay, mm-hmm, right or I see are not a turn, including while the assistant "
            "reads the balance, the payment options or the required disclosure. Speech the user addresses to "
            "someone else nearby rather than to the assistant, such as asking a family member to bring a card "
            "or telling a child to be quiet, is not a turn either. The caller is at home with family nearby."
        ),
        eou_hint=(
            "The last four digits of an account are exactly four digits; fewer have not been finished. A date "
            "of birth needs a month, a day and a year. A mobile number has ten digits after the country code."
        ),
    ),
    Variant(
        folder="example32_technical_support_agent",
        name="tech-support-turn-detection",
        description=(
            "Technical support call (troubleshoot step by step, check the account, open or update a ticket) "
            "with turn detection: 'okay' while the agent reads a step does not interrupt it, a request to a "
            "coworker is ignored, and a pause in the middle of an email address or a ticket number does not "
            "end the caller's turn."
        ),
        language="en-US",
        vad_type="azure_semantic_vad",
        acknowledgements=ENGLISH_ACKNOWLEDGEMENTS,
        interruptions=ENGLISH_INTERRUPTIONS,
        not_turn=(
            "Backchannels such as okay, mm-hmm, right or I see are not a turn, including while the assistant "
            "reads a troubleshooting step. Speech the user addresses to someone else nearby rather than to the "
            "assistant, such as asking a coworker to check a cable or a screen, is not a turn either."
        ),
        eou_hint=(
            "An email address has not been finished until it has a domain such as example.com. A caller "
            "spelling letters and digits of an email or a code may pause between groups."
        ),
        extra_note=(
            " When the caller asks you to wait while they try a step or look something up, say at most "
            "\"Sure, take your time.\" and wait."
        ),
    ),
]


def turn_detection(variant: Variant, base: dict) -> dict:
    # Keep every base setting (thresholds, padding, silence, idle timeout) so the variant differs from its
    # base only by the two detection settings and, where the language needs it, the VAD type.
    return {
        **base,
        "type": variant.vad_type,
        "speech_start_detection": {
            "while_assistant_speaking": {
                "acknowledgement_phrases": variant.acknowledgements,
                "interruption_phrases": variant.interruptions,
                "turn_taking_classifier": {"threshold": 0.5, "criteria": {"not_turn": variant.not_turn}},
                "num_words": 3,
            },
            "while_assistant_not_speaking": {"num_words": 0},
        },
        "end_of_utterance_detection": {
            "model": "microsoft-decision-1",
            "threshold_level": "default",
            "timeout_ms": 2000,
            "instructions": EOU_INSTRUCTIONS + variant.eou_hint,
        },
    }


def build(variant: Variant) -> dict:
    base = json.loads((SAMPLES / variant.folder / "agent.json").read_text(encoding="utf-8"))
    agent = copy.deepcopy(base)
    definition = agent["definition"]
    subagents = (definition.get("subagent_config") or {}).get("subagents") or []
    # The note goes into the shared prompt, so every stage must inherit it.
    if not all(subagent.get("inherit_base_instructions") for subagent in subagents):
        raise ValueError(f"{variant.folder}: every subagent must inherit the base instructions")
    agent["name"] = variant.name
    agent["description"] = variant.description
    definition["instructions"] = definition["instructions"].rstrip() + PAUSED_TURN_NOTE + variant.extra_note
    audio_input = definition["audio"]["input"]
    audio_input["turn_detection"] = turn_detection(variant, audio_input["turn_detection"])
    transcription = {key: value for key, value in (audio_input.get("transcription") or {}).items()
                     if key not in {"model", "language"}}
    # Speech start detection and Decision on a realtime model need a streaming recognizer, and streaming
    # Azure Speech needs an explicit language.
    audio_input["transcription"] = {"model": "azure-speech-streaming", "language": variant.language, **transcription}
    audio_input["noise_reduction"] = {"type": "azure_personal_noise_suppression"}
    audio_input["echo_cancellation"] = {"type": "server_echo_cancellation"}
    return agent


def render(agent: dict) -> str:
    return json.dumps(agent, indent=2, ensure_ascii=False) + "\n"


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--check", action="store_true", help="fail instead of writing when a variant differs")
    args = parser.parse_args()
    stale = []
    for variant in VARIANTS:
        path = SAMPLES / variant.folder / VARIANT_FILE
        expected = render(build(variant))
        current = path.read_text(encoding="utf-8") if path.exists() else None
        if current == expected:
            continue
        if args.check:
            stale.append(str(path.relative_to(SAMPLES.parent)))
        else:
            path.write_text(expected, encoding="utf-8", newline="\n")
            print(f"wrote {path.relative_to(SAMPLES.parent)}")
    if stale:
        print("Out of date; run samples/turn_detection/template_variants.py:\n  " + "\n  ".join(stale))
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
