"""Mocked regression tests for STT-only agent configuration and final usage."""

import asyncio
import logging
from collections.abc import AsyncIterator
from pathlib import Path
from types import SimpleNamespace
from typing import Self
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from samples.realtime_stt.sample import (
    Options,
    Transcript,
    _agent,
    _configure_transcript_console,
    _definition,
    _observe,
    _receive_events,
    _result,
    _session,
    _SessionState,
    _stream_audio,
    _validate_definition,
    _wait,
    run,
    transcript_logger,
)

EXAMPLE_ENDPOINT = "https://example.services.ai.azure.com/api/projects/example"  # Offline placeholder.
EXAMPLE_USAGE = {  # Deterministic cumulative usage; never derived from transcript length.
    "status": "complete",
    "incomplete_components": [],
    "total_tokens": 23,
    "input_tokens": 23,
    "output_tokens": 0,
    "input_token_details": {"audio_tokens": 23, "text_tokens": 0},
}


def _state() -> _SessionState:
    loop = asyncio.get_running_loop()
    return _SessionState(loop.create_future(), loop.create_future())


def _closed(*, usage: dict | None = None) -> dict:
    return {
        "type": "session.closed",
        "session": {"id": "sess_example"},
        "event_id": "event_example",
        "reason": "close_requested",
        "usage": EXAMPLE_USAGE if usage is None else usage,
    }


class TestConfiguration:
    @pytest.mark.parametrize("stt_model", ["azure-speech", "mai-transcribe-2"])
    @pytest.mark.parametrize("vad_type", ["server_vad", "azure_semantic_vad_multilingual"])
    def test_definition_preserves_stt_only_configuration(self: Self, stt_model: str, vad_type: str) -> None:
        """Verify definition preserves stt only configuration.

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
        options = Options(endpoint=EXAMPLE_ENDPOINT, stt_model=stt_model, vad_type=vad_type)
        definition = _definition(options).as_dict()
        _validate_definition(definition, options)
        assert definition["model"] == "gpt-5.6-luna"
        assert definition["audio"]["input"]["turn_detection"]["create_response"] is False
        assert "greeting" not in definition

    def test_validate_definition_rejects_automatic_response(self: Self) -> None:
        """Verify validate definition rejects automatic response.

        Returns
        -------
        None
            Assertions verify the expected behavior.
        """
        options = Options(endpoint=EXAMPLE_ENDPOINT)
        definition = _definition(options).as_dict()
        definition["audio"]["input"]["turn_detection"]["create_response"] = True
        with pytest.raises(ValueError, match="create_response"):
            _validate_definition(definition, options)

    def test_validate_definition_rejects_greeting(self: Self) -> None:
        """Verify validate definition rejects greeting.

        Returns
        -------
        None
            Assertions verify the expected behavior.
        """
        options = Options(endpoint=EXAMPLE_ENDPOINT)
        definition = _definition(options).as_dict()
        definition["greeting"] = {"type": "template", "text": "Welcome"}
        with pytest.raises(ValueError, match="greeting"):
            _validate_definition(definition, options)

    def test_agent_existing_mock_does_not_modify_agent(self: Self) -> None:
        """Verify agent existing mock does not modify agent.

        Returns
        -------
        None
            Assertions verify the expected behavior.
        """

        async def _scenario() -> None:
            options = Options(endpoint=EXAMPLE_ENDPOINT, agent_name="existing-stt")
            version = SimpleNamespace(name="existing-stt", version="7", definition=_definition(options))
            client = SimpleNamespace(
                agents=SimpleNamespace(
                    get=AsyncMock(return_value=SimpleNamespace(versions=SimpleNamespace(latest=version))),
                    create_version=AsyncMock(),
                    enable=AsyncMock(),
                )
            )
            assert await _agent(client, options) == ("existing-stt", "7")
            client.agents.create_version.assert_not_awaited()
            client.agents.enable.assert_not_awaited()

        asyncio.run(_scenario())

    def test_agent_creation_mock_verifies_stored_definition(self: Self) -> None:
        """Verify agent creation mock verifies stored definition.

        Returns
        -------
        None
            Assertions verify the expected behavior.
        """

        async def _scenario() -> None:
            options = Options(endpoint=EXAMPLE_ENDPOINT)
            version = SimpleNamespace(name="new-stt", version="1", definition=_definition(options))
            client = SimpleNamespace(
                agents=SimpleNamespace(
                    create_version=AsyncMock(return_value=version),
                    enable=AsyncMock(),
                    get_version=AsyncMock(return_value=version),
                )
            )
            assert await _agent(client, options) == ("new-stt", "1")
            client.agents.get_version.assert_awaited_once()

        asyncio.run(_scenario())


class TestEvents:
    def test_observe_waits_for_all_utterances_mock(self: Self) -> None:
        """Verify observe waits for all utterances mock.

        Returns
        -------
        None
            Assertions verify the expected behavior.
        """

        async def _scenario() -> None:
            state = _state()
            for item_id in ("item_first", "item_second"):
                _observe({"type": "input_audio_buffer.committed", "item_id": item_id}, state)
            _observe(
                {
                    "type": "conversation.item.input_audio_transcription.completed",
                    "item_id": "item_second",
                    "transcript": "Second",
                },
                state,
            )
            assert not state.settled.is_set()
            _observe(
                {
                    "type": "conversation.item.input_audio_transcription.completed",
                    "item_id": "item_first",
                    "transcript": "First",
                },
                state,
            )
            assert state.settled.is_set()
            _observe({"type": "input_audio_buffer.speech_started", "item_id": "item_third"}, state)
            assert not state.settled.is_set()

        asyncio.run(_scenario())

    @pytest.mark.parametrize("event_type", ["response.created", "response.done", "response.output_audio.delta"])
    def test_observe_rejects_model_response_mock(self: Self, event_type: str) -> None:
        """Verify observe rejects model response mock.

        Parameters
        ----------
        event_type
            Parametrized regression input.

        Returns
        -------
        None
            Assertions verify the expected behavior.
        """

        async def _scenario() -> None:
            with pytest.raises(RuntimeError, match="Unexpected LLM response"):
                _observe({"type": event_type}, _state())

        asyncio.run(_scenario())

    def test_observe_reports_transcription_failure_mock(self: Self) -> None:
        """Verify observe reports transcription failure mock.

        Returns
        -------
        None
            Assertions verify the expected behavior.
        """

        async def _scenario() -> None:
            with pytest.raises(RuntimeError, match="transcription_error"):
                _observe(
                    {
                        "type": "conversation.item.input_audio_transcription.failed",
                        "error": {"code": "transcription_error", "message": "private content"},
                    },
                    _state(),
                )

        asyncio.run(_scenario())

    def test_wait_propagates_receiver_error_mock(self: Self) -> None:
        """Verify wait propagates receiver error mock.

        Returns
        -------
        None
            Assertions verify the expected behavior.
        """

        async def _scenario() -> None:
            async def _failed_receiver() -> None:
                raise RuntimeError("receiver failed")

            receiver = asyncio.create_task(_failed_receiver())
            await asyncio.sleep(0)
            completion = asyncio.get_running_loop().create_future()
            completion.set_result("ready")
            with pytest.raises(RuntimeError, match="receiver failed"):
                await _wait(completion, receiver)

        asyncio.run(_scenario())

    def test_wait_rejects_closed_connection_without_usage_mock(self: Self) -> None:
        """Verify wait rejects closed connection without usage mock.

        Returns
        -------
        None
            Assertions verify the expected behavior.
        """

        async def _scenario() -> None:
            receiver = asyncio.create_task(asyncio.sleep(0))
            completion = asyncio.get_running_loop().create_future()
            with pytest.raises(ConnectionError, match="without the expected event"):
                await _wait(completion, receiver)

        asyncio.run(_scenario())

    def test_result_preserves_partial_usage_mock(self: Self) -> None:
        """Verify result preserves partial usage mock.

        Returns
        -------
        None
            Assertions verify the expected behavior.
        """

        async def _scenario() -> None:
            usage = {
                "status": "partial",
                "incomplete_components": ["transcription"],
                "input_token_details": {"audio_tokens": 8},
            }
            result = _result(_closed(usage=usage), _state(), ("existing-stt", "1"))
            assert result.usage is usage
            assert result.usage is not None
            assert result.usage["status"] == "partial"

        asyncio.run(_scenario())

    def test_receive_events_normal_close_mock_marks_usage_unconfirmed(self: Self) -> None:
        """Verify receive events normal close mock marks usage unconfirmed.

        Returns
        -------
        None
            Assertions verify the expected behavior.
        """

        async def _scenario() -> None:
            state = _state()
            state.close_requested = True
            connection = SimpleNamespace(recv=AsyncMock(side_effect=ConnectionResetError("closed")))
            await _receive_events(connection, state)
            assert await state.closed is None
            result = _result(None, state, ("existing-stt", "1"))
            assert result.usage is None
            assert result.usage_status == "unconfirmed"
            assert result.event_id is None

        asyncio.run(_scenario())

    def test_receive_events_early_close_mock_remains_error(self: Self) -> None:
        """Verify receive events early close mock remains error.

        Returns
        -------
        None
            Assertions verify the expected behavior.
        """

        async def _scenario() -> None:
            connection = SimpleNamespace(recv=AsyncMock(side_effect=ConnectionResetError("closed")))
            with pytest.raises(ConnectionError, match="Transport failed"):
                await _receive_events(connection, _state())

        asyncio.run(_scenario())

    def test_receive_events_abnormal_close_mock_remains_error(self: Self) -> None:
        """Verify receive events abnormal close mock remains error.

        Returns
        -------
        None
            Assertions verify the expected behavior.
        """

        async def _scenario() -> None:
            error = ConnectionResetError("abnormal")
            error.__cause__ = RuntimeError("transport error")
            state = _state()
            state.close_requested = True
            connection = SimpleNamespace(recv=AsyncMock(side_effect=error))
            with pytest.raises(ConnectionError, match="Transport failed"):
                await _receive_events(connection, state)

        asyncio.run(_scenario())


class TestSession:
    def test_session_multi_turn_mock_closes_after_all_transcripts(self: Self) -> None:
        """Verify session multi turn mock closes after all transcripts.

        Returns
        -------
        None
            Assertions verify the expected behavior.
        """

        async def _scenario() -> None:
            options = Options(endpoint=EXAMPLE_ENDPOINT, wav=Path("fixture.wav"))
            queue: asyncio.Queue[dict] = asyncio.Queue()
            await queue.put(
                {"type": "session.updated", "session": {"id": "sess_example", **_definition(options).as_dict()}}
            )
            connection = SimpleNamespace(recv=AsyncMock(side_effect=queue.get), send=AsyncMock())

            async def _stream_audio(*_args: object) -> None:
                for item_id in ("item_first", "item_second"):
                    await queue.put({"type": "input_audio_buffer.speech_started", "item_id": item_id})
                    await queue.put({"type": "input_audio_buffer.speech_stopped", "item_id": item_id})
                    await queue.put({"type": "input_audio_buffer.committed", "item_id": item_id})
                for item_id in ("item_second", "item_first"):
                    await queue.put(
                        {
                            "type": "conversation.item.input_audio_transcription.completed",
                            "item_id": item_id,
                            "transcript": "Example speech",
                        }
                    )

            async def _send_close(event: dict) -> None:
                assert event == {"type": "session.close"}
                assert queue.empty()
                await queue.put(_closed())

            connection.send.side_effect = _send_close
            with patch("samples.realtime_stt.sample._stream_audio", new=AsyncMock(side_effect=_stream_audio)):
                result = await _session(connection, MagicMock(), options, ("existing-stt", "1"))
            assert len(result.transcripts) == 2
            assert result.usage is EXAMPLE_USAGE
            assert result.event_counts["session.closed"] == 1
            connection.send.assert_awaited_once_with({"type": "session.close"})

        asyncio.run(_scenario())

    def test_session_require_usage_mock_rejects_missing_final_event(self: Self) -> None:
        """Verify session require usage mock rejects missing final event.

        Returns
        -------
        None
            Assertions verify the expected behavior.
        """

        async def _scenario() -> None:
            options = Options(endpoint=EXAMPLE_ENDPOINT, require_usage=True)
            connection = SimpleNamespace(send=AsyncMock())

            async def _receiver(_connection: object, state: _SessionState) -> None:
                state.ready.set_result({"id": "sess_example", **_definition(options).as_dict()})
                state.committed.add("item_first")
                state.transcripts["item_first"] = Transcript("item_first", "Example speech")
                state.settled.set()
                while not state.close_requested:
                    await asyncio.sleep(0)
                state.closed.set_result(None)

            with (
                patch("samples.realtime_stt.sample._receive_events", side_effect=_receiver),
                patch("samples.realtime_stt.sample._stream_audio", new=AsyncMock()),
                pytest.raises(RuntimeError, match="complete final usage"),
            ):
                await _session(connection, MagicMock(), options, ("existing-stt", "1"))

        asyncio.run(_scenario())

    def test_run_rejects_nonpositive_duration(self: Self) -> None:
        """Verify run rejects nonpositive duration.

        Returns
        -------
        None
            Assertions verify the expected behavior.
        """
        with pytest.raises(ValueError, match="duration must be positive"):
            asyncio.run(run(Options(endpoint=EXAMPLE_ENDPOINT, duration=0)))


class TestAudioInput:
    @pytest.mark.parametrize("use_wav", [False, True])
    def test_stream_audio_starts_source_mock(self: Self, use_wav: bool) -> None:
        """Verify input starts and microphone capture ends before trailing silence.

        Parameters
        ----------
        use_wav
            Select file input or microphone capture.

        Returns
        -------
        None
            Assertions verify capture startup and final microphone silence.
        """

        async def _scenario() -> None:
            async def _frames(_stop: asyncio.Event) -> AsyncIterator[bytes]:
                yield b"\0\0"

            options = Options(endpoint=EXAMPLE_ENDPOINT, wav=Path("fixture.wav") if use_wav else None)
            audio = MagicMock()
            audio.frames.side_effect = _frames
            connection = SimpleNamespace(input_audio_buffer=SimpleNamespace(append=AsyncMock()))
            clock = SimpleNamespace(time=MagicMock(side_effect=[0, options.duration + 1]))
            silence = AsyncMock()
            with (
                patch("samples.realtime_stt.sample.asyncio.get_running_loop", return_value=clock),
                patch("samples.realtime_stt.sample._silence", new=silence),
            ):
                await _stream_audio(connection, audio, options)
            audio.start.assert_called_once_with()
            connection.input_audio_buffer.append.assert_awaited_once_with(audio=b"\0\0")
            if use_wav:
                audio.stop_microphone.assert_not_called()
                silence.assert_not_awaited()
            else:
                audio.stop_microphone.assert_called_once_with()
                silence.assert_awaited_once_with(connection)

        asyncio.run(_scenario())


class TestConsole:
    def test_observe_completed_transcription_mock_displays_immediately(
        self: Self, capsys: pytest.CaptureFixture[str], caplog: pytest.LogCaptureFixture
    ) -> None:
        """Verify completed text reaches stdout without entering diagnostic logs.

        Parameters
        ----------
        capsys
            Captures the dedicated console output.
        caplog
            Captures ordinary diagnostic logging.

        Returns
        -------
        None
            Assertions verify immediate display and log isolation.
        """

        async def _scenario() -> None:
            with (
                patch.object(transcript_logger, "handlers", []),
                patch.object(transcript_logger, "level", logging.NOTSET),
            ):
                _configure_transcript_console()
                _observe(
                    {
                        "type": "conversation.item.input_audio_transcription.completed",
                        "item_id": "item_console",
                        "transcript": "Hello from the microphone.",
                    },
                    _state(),
                )
                assert capsys.readouterr().out == "Recognized: Hello from the microphone.\n"
                assert "Hello from the microphone." not in caplog.text
                assert transcript_logger.propagate is False

        asyncio.run(_scenario())
