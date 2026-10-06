"""Assess one recorded sentence with Azure Speech's short-audio REST API."""

from __future__ import annotations

import base64
import io
import json
import math
import re
import wave
from dataclasses import dataclass
from typing import Any
from urllib.parse import urlsplit

import aiohttp
import numpy as np
from scipy.signal import resample_poly

VOICE_RATE = 24000
SPEECH_RATE = 16000
MAX_SECONDS = 30
MIN_SECONDS = 0.1
SAMPLE_WIDTH = 2


class AssessmentError(RuntimeError):
    """An assessment failed; no scores should be fabricated."""


def validate_pcm(pcm: bytes) -> None:
    if len(pcm) % SAMPLE_WIDTH:
        raise ValueError("PCM must contain complete 16-bit samples.")
    frames = len(pcm) // SAMPLE_WIDTH
    if not VOICE_RATE * MIN_SECONDS <= frames <= VOICE_RATE * MAX_SECONDS:
        raise ValueError("Record between 0.1 and 30 seconds, including silence.")


def read_wav(path: str) -> bytes:
    with wave.open(path, "rb") as recording:
        if (
            recording.getnchannels() != 1
            or recording.getsampwidth() != SAMPLE_WIDTH
            or recording.getframerate() != VOICE_RATE
            or recording.getcomptype() != "NONE"
        ):
            raise ValueError("Use an uncompressed mono, 16-bit PCM, 24000 Hz WAV.")
        frames = recording.getnframes()
        if not VOICE_RATE * MIN_SECONDS <= frames <= VOICE_RATE * MAX_SECONDS:
            raise ValueError("Use a WAV between 0.1 and 30 seconds.")
        pcm = recording.readframes(frames)
        if len(pcm) != frames * SAMPLE_WIDTH:
            raise ValueError("The WAV is truncated.")
    validate_pcm(pcm)
    return pcm


def speech_wav(pcm: bytes) -> bytes:
    validate_pcm(pcm)
    samples = np.frombuffer(pcm, dtype="<i2").astype(np.float64)
    # Polyphase filtering prevents aliasing when converting 24 kHz to 16 kHz.
    converted = np.clip(
        np.rint(resample_poly(samples, 2, 3)), -32768, 32767
    ).astype("<i2")
    output = io.BytesIO()
    with wave.open(output, "wb") as recording:
        recording.setnchannels(1)
        recording.setsampwidth(SAMPLE_WIDTH)
        recording.setframerate(SPEECH_RATE)
        recording.writeframes(converted.tobytes())
    return output.getvalue()


def validate_sentence(sentence: str) -> str:
    sentence = sentence.strip()
    if not sentence or len(sentence) > 500:
        raise ValueError("Use a nonempty reference sentence of at most 500 characters.")
    return sentence


def _score(document: dict[str, Any], name: str) -> float:
    value = document.get(name)
    if (
        isinstance(value, bool)
        or not isinstance(value, (int, float))
        or not math.isfinite(value)
        or not 0 <= value <= 100
    ):
        raise AssessmentError(f"Speech returned an invalid or missing {name}.")
    return float(value)


def parse_result(document: Any, sentence: str, language: str) -> dict[str, Any]:
    if not isinstance(document, dict) or document.get("RecognitionStatus") != "Success":
        raise AssessmentError(
            "Speech did not recognize a sentence. Check the microphone, locale, and recording."
        )
    alternatives = document.get("NBest")
    if not isinstance(alternatives, list) or not alternatives or not isinstance(alternatives[0], dict):
        raise AssessmentError("Speech returned no detailed assessment.")
    best = alternatives[0]
    scores = {
        label: _score(best, field)
        for label, field in (
            ("pronunciation", "PronScore"),
            ("accuracy", "AccuracyScore"),
            ("fluency", "FluencyScore"),
            ("completeness", "CompletenessScore"),
        )
    }
    if "ProsodyScore" in best:
        scores["prosody"] = _score(best, "ProsodyScore")
    words = best.get("Words")
    if not isinstance(words, list) or not words:
        raise AssessmentError("Speech returned no word-level assessment.")
    normalized = []
    for word in words:
        if not isinstance(word, dict) or not isinstance(word.get("Word"), str):
            raise AssessmentError("Speech returned an invalid word.")
        error_type = word.get("ErrorType")
        if not isinstance(error_type, str):
            raise AssessmentError("Speech returned no word error type.")
        normalized.append({
            "word": word["Word"],
            "accuracy": _score(word, "AccuracyScore"),
            "error_type": error_type,
        })
    return {
        "ok": True,
        "reference_text": sentence,
        "language": language,
        "recognized_text": best.get("Display") or document.get("DisplayText") or "",
        "score_scale": "0-100",
        "scores": scores,
        "words": normalized,
        "practice_words": [
            word for word in normalized
            if word["error_type"] != "None" or word["accuracy"] < 80
        ],
    }


@dataclass(frozen=True)
class SpeechSettings:
    endpoint: str
    key: str
    language: str = "en-US"
    prosody: bool = False

    def __post_init__(self) -> None:
        parsed = urlsplit(self.endpoint)
        if (
            parsed.scheme != "https"
            or not parsed.hostname
            or not re.fullmatch(r"[a-z0-9-]+\.cognitiveservices\.azure\.com", parsed.hostname)
            or parsed.username
            or parsed.password
            or parsed.port not in (None, 443)
            or parsed.path not in ("", "/")
            or parsed.query
            or parsed.fragment
        ):
            raise ValueError(
                "AZURE_SPEECH_ENDPOINT must be your public-cloud HTTPS Speech resource endpoint."
            )
        if not self.key.strip():
            raise ValueError("Set AZURE_SPEECH_KEY to your Speech resource key.")
        if not re.fullmatch(r"[a-z]{2,3}-[A-Z]{2}", self.language):
            raise ValueError("Use a Speech pronunciation-assessment locale, for example en-US.")
        if self.prosody and self.language != "en-US":
            raise ValueError("This sample enables prosody only for en-US.")


class PronunciationAssessor:
    def __init__(self, session: aiohttp.ClientSession, settings: SpeechSettings) -> None:
        self.session = session
        self.settings = settings

    async def assess(self, pcm: bytes, sentence: str) -> dict[str, Any]:
        sentence = validate_sentence(sentence)
        body = speech_wav(pcm)
        parameters = {
            "ReferenceText": sentence,
            "GradingSystem": "HundredMark",
            "Granularity": "Word",
            "Dimension": "Comprehensive",
            "EnableMiscue": True,
        }
        if self.settings.prosody:
            parameters["EnableProsodyAssessment"] = True
        header = base64.b64encode(
            json.dumps(parameters, ensure_ascii=False).encode("utf-8")
        ).decode("ascii")
        url = (
            self.settings.endpoint.rstrip("/")
            + "/stt/speech/recognition/conversation/cognitiveservices/v1"
        )
        try:
            async with self.session.post(
                url,
                params={"language": self.settings.language, "format": "detailed"},
                headers={
                    "Ocp-Apim-Subscription-Key": self.settings.key,
                    "Pronunciation-Assessment": header,
                    "Content-Type": "audio/wav; codecs=audio/pcm; samplerate=16000",
                    "Accept": "application/json",
                },
                data=body,
                timeout=aiohttp.ClientTimeout(total=60),
                allow_redirects=False,
            ) as response:
                if response.status != 200:
                    raise AssessmentError(
                        f"Speech assessment HTTP {response.status}; check resource access, "
                        "locale support, quota, and audio. No scores are available."
                    )
                document = await response.json()
        except (aiohttp.ClientError, TimeoutError, ValueError) as error:
            # Never expose response bodies, URLs with credentials, or keys.
            raise AssessmentError(
                "Speech assessment request failed; check connectivity and configuration."
            ) from error
        return parse_result(document, sentence, self.settings.language)
