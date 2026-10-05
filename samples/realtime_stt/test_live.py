"""Opt-in live tests through the Foundry voice-first agent endpoint."""

import asyncio
import logging
import os
from pathlib import Path
from typing import Self

import pytest

from samples.realtime_stt.sample import Options, run

logger = logging.getLogger(__name__)


@pytest.mark.skipif(os.getenv("STT_LIVE_TEST") != "1", reason="Set STT_LIVE_TEST=1 to create and test real agents.")
class TestLiveSTT:
    @pytest.mark.parametrize("stt_model", ["mai-transcribe-2", "azure-speech"])
    @pytest.mark.parametrize("vad_type", ["server_vad", "azure_semantic_vad_multilingual"])
    def test_run_live_vad_without_model_response(self: Self, stt_model: str, vad_type: str) -> None:
        """Verify run live vad without model response.

        Parameters
        ----------
        stt_model
            Parametrized regression input.
        vad_type
            Parametrized regression input.

        Returns
        -------
        None
            Assertions verify the expected behavior.
        """
        result = asyncio.run(
            run(
                Options(
                    endpoint=os.environ["AZURE_VOICE_AGENTS_ENDPOINT"],
                    stt_model=stt_model,
                    vad_type=vad_type,
                    wav=Path(os.environ["STT_LIVE_WAV"]),
                )
            )
        )
        logger.info(
            "LIVE_RESULT agent=%s version=%s session=%s stt=%s vad=%s audio_tokens=%s",
            result.agent_name,
            result.agent_version,
            result.session_id,
            stt_model,
            vad_type,
            result.usage["input_token_details"]["audio_tokens"] if result.usage is not None else None,
        )
        assert result.transcripts
        assert any("lake" in transcript.text.lower() for transcript in result.transcripts)
        assert not any(kind.startswith("response.") for kind in result.event_counts)
        assert result.event_counts["input_audio_buffer.speech_started"] > 0
        assert result.event_counts["input_audio_buffer.speech_stopped"] > 0
        assert result.event_counts["input_audio_buffer.committed"] == len(result.transcripts)
        if result.usage is None:
            assert result.usage_status == "unconfirmed"
            assert result.event_id is None
            return
        assert result.usage["status"] == "complete"
        assert result.usage["incomplete_components"] == []
        assert result.usage["input_token_details"]["audio_tokens"] > 0
        assert result.usage["input_token_details"]["text_tokens"] == 0
        assert result.usage["output_tokens"] == 0
        assert result.usage["total_tokens"] == result.usage["input_token_details"]["audio_tokens"]
