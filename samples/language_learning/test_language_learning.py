"""Offline pronunciation-tool contracts; no Azure resources or audio devices."""

from __future__ import annotations

import base64
import asyncio
import io
import json
import os
import tempfile
import unittest
import wave
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

import aiohttp
import numpy as np
from aiohttp import web
from azure.ai.projects.aio.operations import AsyncBetaRealtimeConnection

from assessment import (
    AssessmentError,
    PronunciationAssessor,
    SpeechSettings,
    parse_result,
    read_wav,
    speech_wav,
    validate_pcm,
)
import language_learning as sample
from conversation import (
    AudioHistory, Conversation, LiveAudio, PREPARE_TOOL,
    assessment_response, run_conversation,
)

PCM = bytes(24000 * 2)
SENTENCE = "Good morning."


def service_result() -> dict:
    return {
        "RecognitionStatus": "Success",
        "NBest": [{
            "Display": SENTENCE,
            "PronScore": 85.5,
            "AccuracyScore": 82,
            "FluencyScore": 90,
            "CompletenessScore": 100,
            "Words": [
                {"Word": "good", "AccuracyScore": 95, "ErrorType": "None"},
                {"Word": "morning", "AccuracyScore": 70, "ErrorType": "Mispronunciation"},
            ],
        }],
    }


def wire(kind: str, **fields) -> dict:
    return {"type": kind, **fields}


def done(output: list, status: str = "completed") -> dict:
    return wire("response.done", response={"status": status, "output": output})


def tool_call(call_id: str = "call-1") -> dict:
    return {"type": "function_call", "name": sample.TOOL_NAME, "call_id": call_id, "arguments": "{}"}


def feedback_events() -> list[dict]:
    return [
        wire("response.output_audio.delta", delta=base64.b64encode(b"\0\0" * 24).decode()),
        wire("response.output_audio_transcript.done", transcript="Here is your feedback."),
        done([]),
    ]


def connection(events: list[dict]) -> MagicMock:
    fake = MagicMock()
    fake.recv = AsyncMock(side_effect=events)
    fake.input_audio_buffer.append = AsyncMock()
    fake.input_audio_buffer.commit = AsyncMock()
    fake.response.create = AsyncMock()
    fake.response.cancel = AsyncMock()
    fake.conversation.item.create = AsyncMock()
    return fake


class AudioTests(unittest.TestCase):
    def test_exact_duration_boundaries(self):
        for frames in (2400, 720000):
            validate_pcm(bytes(frames * 2))
        for frames in (0, 2399, 720001):
            with self.assertRaises(ValueError):
                validate_pcm(bytes(frames * 2))
        with self.assertRaises(ValueError):
            validate_pcm(b"\0")

    def test_resampling_preserves_duration_frequency_and_wav_contract(self):
        time = np.arange(24000) / 24000
        pcm = (np.sin(2 * np.pi * 440 * time) * 16000).astype("<i2").tobytes()
        with wave.open(io.BytesIO(speech_wav(pcm)), "rb") as recording:
            self.assertEqual((recording.getnchannels(), recording.getsampwidth(), recording.getframerate()), (1, 2, 16000))
            self.assertEqual(recording.getnframes(), 16000)
            samples = np.frombuffer(recording.readframes(16000), dtype="<i2")
        spectrum = abs(np.fft.rfft(samples))
        self.assertEqual(int(np.argmax(spectrum)), 440)
        self.assertGreater(np.max(samples), 15000)

    def test_resampling_filters_above_new_nyquist(self):
        time = np.arange(24000) / 24000
        pcm = (np.sin(2 * np.pi * 10000 * time) * 16000).astype("<i2").tobytes()
        with wave.open(io.BytesIO(speech_wav(pcm)), "rb") as recording:
            samples = np.frombuffer(recording.readframes(16000), dtype="<i2").astype(float)
        self.assertLess(float(np.sqrt(np.mean(samples[100:-100] ** 2))), 100)

    def test_read_wav_format_duration_and_truncation(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "input.wav"
            for rate, channels, width in ((24000, 1, 2), (16000, 1, 2), (24000, 2, 2), (24000, 1, 1)):
                with wave.open(str(path), "wb") as recording:
                    recording.setnchannels(channels)
                    recording.setsampwidth(width)
                    recording.setframerate(rate)
                    recording.writeframes(PCM)
                if (rate, channels, width) == (24000, 1, 2):
                    self.assertEqual(read_wav(str(path)), PCM)
                    path.write_bytes(path.read_bytes()[:-2])
                    with self.assertRaisesRegex(ValueError, "truncated"):
                        read_wav(str(path))
                else:
                    with self.assertRaises(ValueError):
                        read_wav(str(path))


class AssessmentTests(unittest.TestCase):
    def test_scores_and_word_feedback(self):
        result = parse_result(service_result(), SENTENCE, "en-US")
        self.assertTrue(result["ok"])
        self.assertEqual(result["scores"]["pronunciation"], 85.5)
        self.assertEqual(result["practice_words"], [result["words"][1]])
        self.assertNotIn("prosody", result["scores"])

    def test_prosody_omissions_and_insertions(self):
        document = service_result()
        best = document["NBest"][0]
        best["ProsodyScore"] = 65
        best["Words"] = [
            {"Word": "good", "AccuracyScore": 0, "ErrorType": "Omission"},
            {"Word": "hello", "AccuracyScore": 85, "ErrorType": "Insertion"},
        ]
        result = parse_result(document, SENTENCE, "en-US")
        self.assertEqual(result["scores"]["prosody"], 65)
        self.assertEqual(len(result["practice_words"]), 2)

    def test_invalid_responses_never_become_scores(self):
        for document in (
            None, [], {}, {"RecognitionStatus": "NoMatch"},
            {"RecognitionStatus": "Success", "NBest": []},
        ):
            with self.assertRaises(AssessmentError):
                parse_result(document, SENTENCE, "en-US")
        for value in (None, True, "90", -1, 101, float("nan"), float("inf")):
            document = service_result()
            document["NBest"][0]["AccuracyScore"] = value
            with self.assertRaises(AssessmentError):
                parse_result(document, SENTENCE, "en-US")
        document = service_result()
        document["NBest"][0].pop("Words")
        with self.assertRaises(AssessmentError):
            parse_result(document, SENTENCE, "en-US")

    def test_endpoint_key_and_prosody_validation(self):
        for endpoint in (
            "http://speech.cognitiveservices.azure.com",
            "https://evil.example",
            "https://speech.cognitiveservices.azure.com/path",
            "https://speech.cognitiveservices.azure.com?key=secret",
            "https://user:secret@speech.cognitiveservices.azure.com",
        ):
            with self.assertRaises(ValueError):
                SpeechSettings(endpoint, "key")
        with self.assertRaises(ValueError):
            SpeechSettings("https://speech.cognitiveservices.azure.com", "")
        with self.assertRaises(ValueError):
            SpeechSettings("https://speech.cognitiveservices.azure.com", "key", "fr-FR", True)


class HttpTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.captured = []
        self.status = 200
        self.document = service_result()

        async def handler(request):
            self.captured.append((request, await request.read()))
            return web.json_response(self.document, status=self.status)

        app = web.Application()
        app.router.add_post("/stt/speech/recognition/conversation/cognitiveservices/v1", handler)
        self.runner = web.AppRunner(app)
        await self.runner.setup()
        site = web.TCPSite(self.runner, "127.0.0.1", 0)
        await site.start()
        self.url = f"http://127.0.0.1:{site._server.sockets[0].getsockname()[1]}"
        self.session = aiohttp.ClientSession()
        settings = SpeechSettings("https://speech.cognitiveservices.azure.com", "offline-key")
        # Only a test fixture bypasses the production HTTPS endpoint restriction.
        object.__setattr__(settings, "endpoint", self.url)
        self.assessor = PronunciationAssessor(self.session, settings)

    async def asyncTearDown(self):
        await self.session.close()
        await self.runner.cleanup()

    async def test_actual_http_request(self):
        result = await self.assessor.assess(PCM, SENTENCE)
        self.assertTrue(result["ok"])
        request, audio = self.captured[0]
        self.assertEqual(request.query["language"], "en-US")
        self.assertEqual(request.query["format"], "detailed")
        self.assertEqual(request.headers["Ocp-Apim-Subscription-Key"], "offline-key")
        parameters = json.loads(base64.b64decode(request.headers["Pronunciation-Assessment"]))
        self.assertEqual(parameters["ReferenceText"], SENTENCE)
        self.assertEqual(parameters["GradingSystem"], "HundredMark")
        self.assertEqual(parameters["Dimension"], "Comprehensive")
        self.assertEqual(parameters["Granularity"], "Word")
        self.assertTrue(parameters["EnableMiscue"])
        self.assertNotIn("EnableProsodyAssessment", parameters)
        with wave.open(io.BytesIO(audio), "rb") as recording:
            self.assertEqual(recording.getframerate(), 16000)
            self.assertEqual(recording.getnframes(), 16000)

    async def test_http_errors_are_explicit_and_sanitized(self):
        for status in (301, 401, 403, 429, 500):
            self.status = status
            self.document = {"error": "sensitive provider body"}
            with self.assertRaises(AssessmentError) as raised:
                await self.assessor.assess(PCM, SENTENCE)
            self.assertIn(str(status), str(raised.exception))
            self.assertNotIn("sensitive", str(raised.exception))
            self.assertNotIn("offline-key", str(raised.exception))

    async def test_no_match_is_not_success(self):
        self.document = {"RecognitionStatus": "NoMatch"}
        with self.assertRaises(AssessmentError):
            await self.assessor.assess(PCM, SENTENCE)

    async def test_prosody_is_explicitly_requested(self):
        object.__setattr__(self.assessor.settings, "prosody", True)
        self.document["NBest"][0]["ProsodyScore"] = 75
        result = await self.assessor.assess(PCM, SENTENCE)
        parameters = json.loads(base64.b64decode(self.captured[0][0].headers["Pronunciation-Assessment"]))
        self.assertTrue(parameters["EnableProsodyAssessment"])
        self.assertEqual(result["scores"]["prosody"], 75)

    async def test_invalid_input_is_not_uploaded(self):
        for pcm, sentence in ((b"", SENTENCE), (PCM, ""), (PCM, "x" * 501)):
            with self.assertRaises(ValueError):
                await self.assessor.assess(pcm, sentence)
        self.assertEqual(self.captured, [])

    async def test_real_sdk_websocket_chat_to_practice_to_speech_http_feedback(self):
        received = []

        async def voice(request):
            socket = web.WebSocketResponse()
            await socket.prepare(request)

            async def read_frame():
                frame = await socket.receive_json()
                received.append(frame)
                return frame

            async def speak(item_id, start, end):
                await socket.send_json(wire("input_audio_buffer.speech_started", item_id=item_id, audio_start_ms=start))
                await socket.send_json(wire("input_audio_buffer.speech_stopped", item_id=item_id, audio_end_ms=end))
                await socket.send_json(wire("input_audio_buffer.committed", item_id=item_id))

            await socket.send_json(wire("session.updated", session={
                "audio": {"input": {"turn_detection": {"type": "server_vad", "create_response": False}}},
            }))
            await read_frame()  # Initial greeting request.
            await socket.send_json(done([]))
            await speak("chat", 0, 1000)
            await read_frame()  # Normal chat response request.
            await socket.send_json(done([{
                "type": "function_call", "name": PREPARE_TOOL, "call_id": "prepare",
                "arguments": '{"sentence_number":1}',
            }]))
            await read_frame()  # Prepared reference function output.
            await read_frame()  # Coach reading prompt response request.
            await socket.send_json(wire("response.output_audio_transcript.done", transcript=f"Please read: {SENTENCE}"))
            await socket.send_json(done([]))
            await speak("attempt", 1000, 2000)
            await read_frame()  # Forced pronunciation call response request.
            await socket.send_json(done([tool_call()]))
            await read_frame()  # Actual Speech HTTP assessment function output.
            await read_frame()  # Spoken feedback response request.
            await socket.send_json(wire("response.output_audio_transcript.done", transcript="Your accuracy is 82 out of 100."))
            await socket.send_json(done([]))
            await socket.close()
            return socket

        app = web.Application()
        app.router.add_get("/voice", voice)
        runner = web.AppRunner(app)
        await runner.setup()
        site = web.TCPSite(runner, "127.0.0.1", 0)
        await site.start()
        url = f"http://127.0.0.1:{site._server.sockets[0].getsockname()[1]}/voice"
        audio_instances = []

        class OfflineAudio:
            def __init__(self, history, _playback):
                history.append(b"\x01\0" * 24000)
                history.append(b"\x02\0" * 24000)
                self.failure = asyncio.get_running_loop().create_future()
                self.closed = False
                audio_instances.append(self)

            def start(self):
                pass

            async def send(self, _connection):
                await asyncio.Event().wait()

            def interrupt(self):
                pass

            def output(self, _delta):
                pass

            def close(self):
                self.closed = True
                self.failure.cancel()

        try:
            async with self.session.ws_connect(url) as socket:
                sdk = AsyncBetaRealtimeConnection(socket, self.session)
                with patch("conversation.LiveAudio", OfflineAudio), patch("builtins.print"):
                    await asyncio.wait_for(
                        run_conversation(sdk, self.assessor, sample.parse_args(["--sentence", SENTENCE, "--no-playback"])),
                        timeout=10,
                    )
        finally:
            await runner.cleanup()
        self.assertEqual(len(self.captured), 1)
        parameters = json.loads(base64.b64decode(self.captured[0][0].headers["Pronunciation-Assessment"]))
        self.assertEqual(parameters["ReferenceText"], SENTENCE)
        with wave.open(io.BytesIO(self.captured[0][1]), "rb") as recording:
            samples = np.frombuffer(recording.readframes(16000), dtype="<i2")
            self.assertTrue(np.all(samples[100:-100] == 2))
        results = [
            json.loads(frame["item"]["output"])
            for frame in received if frame["type"] == "conversation.item.create"
        ]
        self.assertEqual(results[-1]["scores"]["accuracy"], 82)
        self.assertTrue(audio_instances[0].closed)


class LiveAudioTests(unittest.IsolatedAsyncioTestCase):
    async def test_capture_order_playback_interruption_and_cleanup(self):
        module = MagicMock()
        module.paContinue = 0
        device = module.PyAudio.return_value
        input_stream = MagicMock()
        output_stream = MagicMock()
        device.open.side_effect = [output_stream, input_stream]
        history = AudioHistory()
        with patch("conversation.audio_module", return_value=module):
            audio = LiveAudio(history, True)
            audio.start()
        callbacks = [call.kwargs["stream_callback"] for call in device.open.call_args_list]
        render, capture = callbacks
        fake = connection([])
        sender = asyncio.create_task(audio.send(fake))
        try:
            capture(b"\x01\0" * 1200, 1200, {}, 0)
            capture(b"\x02\0" * 1200, 1200, {}, 0)
            for _ in range(10):
                await asyncio.sleep(0)
            chunks = [call.kwargs["audio"] for call in fake.input_audio_buffer.append.await_args_list]
            self.assertEqual(chunks, [b"\x01\0" * 1200, b"\x02\0" * 1200])
            self.assertEqual(history.frames, 2400)
            audio.output(b"\x03\0" * 2400)
            self.assertEqual(render(None, 1200, {}, 0)[0], b"\x03\0" * 1200)
            audio.interrupt()
            self.assertEqual(render(None, 1200, {}, 0)[0], bytes(2400))
            audio.output(b"\x04\0" * 1200)
            self.assertEqual(render(None, 1200, {}, 0)[0], b"\x04\0" * 1200)
        finally:
            sender.cancel()
            await asyncio.gather(sender, return_exceptions=True)
            audio.close()
        device.terminate.assert_called_once()
        input_stream.close.assert_called_once()
        output_stream.close.assert_called_once()

    async def test_microphone_loss_is_an_explicit_failure(self):
        module = MagicMock()
        with patch("conversation.audio_module", return_value=module):
            audio = LiveAudio(AudioHistory(), False)
            audio.start()
        capture = module.PyAudio.return_value.open.call_args.kwargs["stream_callback"]
        try:
            capture(b"\0\0" * 1200, 1200, {}, 1)
            await asyncio.sleep(0)
            with self.assertRaisesRegex(RuntimeError, "overflow"):
                await audio.failure
        finally:
            audio.close()


class TurnTests(unittest.IsolatedAsyncioTestCase):
    async def test_practice_binds_audio_reference_and_completed_call(self):
        fake = connection([
            wire("input_audio_buffer.committed"),
            wire("response.function_call_arguments.done", **tool_call()),
            done([tool_call()]), *feedback_events(),
        ])
        assessor = MagicMock()
        assessor.assess = AsyncMock(return_value=parse_result(service_result(), SENTENCE, "en-US"))
        with patch("builtins.print"):
            result = await sample.run_turn(fake, assessor, PCM, SENTENCE, playback=False)
        assessor.assess.assert_awaited_once_with(PCM, SENTENCE)
        self.assertTrue(result["ok"])
        self.assertEqual(b"".join(call.kwargs["audio"] for call in fake.input_audio_buffer.append.await_args_list), PCM)
        choices = [call.kwargs["response"]["tool_choice"] for call in fake.response.create.await_args_list]
        self.assertEqual(choices, ["required", "none"])
        self.assertEqual(fake.response.create.await_args_list[0].kwargs["response"], assessment_response())
        item = fake.conversation.item.create.await_args_list[-1].kwargs["item"]
        self.assertEqual(item["type"], "function_call_output")
        self.assertEqual(item["call_id"], "call-1")
        self.assertEqual(json.loads(item["output"]), result)

    async def test_chat_never_assesses(self):
        fake = connection([wire("input_audio_buffer.committed"), *feedback_events()])
        assessor = MagicMock(assess=AsyncMock())
        with patch("builtins.print"):
            result = await sample.run_turn(fake, assessor, PCM, None, playback=False)
        self.assertIsNone(result)
        assessor.assess.assert_not_awaited()
        fake.response.create.assert_awaited_once_with(response={"tool_choice": "none"})

    async def test_failed_assessment_is_returned_to_coach_without_scores(self):
        fake = connection([wire("input_audio_buffer.committed"), done([tool_call()]), *feedback_events()])
        assessor = MagicMock(assess=AsyncMock(side_effect=AssessmentError("Speech assessment HTTP 401")))
        with patch("builtins.print"), self.assertLogs(sample.logger, level="ERROR"):
            result = await sample.run_turn(fake, assessor, PCM, SENTENCE, playback=False)
        self.assertFalse(result["ok"])
        self.assertNotIn("scores", result)
        self.assertIn("401", result["error"])
        self.assertEqual(fake.response.create.await_count, 2)

    async def test_unexpected_missing_or_duplicate_tool_calls_fail(self):
        for calls in ([], [tool_call(), tool_call("call-2")], [{**tool_call(), "name": "other"}]):
            fake = connection([wire("input_audio_buffer.committed"), done(calls)])
            assessor = MagicMock(assess=AsyncMock())
            with self.assertRaises(RuntimeError):
                await sample.run_turn(fake, assessor, PCM, SENTENCE, playback=False)
            assessor.assess.assert_not_awaited()

    async def test_model_cannot_change_reference(self):
        call = {**tool_call(), "arguments": '{"reference_text":"different sentence"}'}
        fake = connection([wire("input_audio_buffer.committed"), done([call]), *feedback_events()])
        assessor = MagicMock(assess=AsyncMock())
        with patch("builtins.print"), self.assertLogs(sample.logger, level="ERROR"):
            result = await sample.run_turn(fake, assessor, PCM, SENTENCE, playback=False)
        self.assertFalse(result["ok"])
        assessor.assess.assert_not_awaited()

    async def test_failed_voice_response_and_protocol_error_surface(self):
        for event in (done([], status="failed"), wire("error", error={"message": "secret"})):
            fake = connection([wire("input_audio_buffer.committed"), event])
            with self.assertRaises(RuntimeError) as raised:
                await sample.run_turn(fake, MagicMock(), PCM, None, playback=False)
            self.assertNotIn("secret", str(raised.exception))

    async def test_ready_session_rejects_automatic_turn_detection(self):
        args = sample.parse_args([])
        fake = connection([wire("session.updated", session={"audio": {"input": {"turn_detection": {"type": "server_vad"}}}})])
        with self.assertRaisesRegex(RuntimeError, "Manual sentence"):
            await sample.file_lesson(fake, MagicMock(), args)


class HistoryTests(unittest.TestCase):
    def test_exact_slice_across_chunks_excludes_other_turns(self):
        history = AudioHistory()
        history.append(b"\x01\0" * 24000)
        history.append(b"\x02\0" * 24000)
        history.append(b"\x03\0" * 24000)
        self.assertEqual(history.slice(1000, 2000), b"\x02\0" * 24000)
        self.assertEqual(history.slice(500, 1500), b"\x01\0" * 12000 + b"\x02\0" * 12000)

    def test_history_is_bounded_and_missing_or_long_slices_fail(self):
        history = AudioHistory(seconds=2)
        for _ in range(6):
            history.append(PCM)
        self.assertEqual(len(history.chunks), 2)
        with self.assertRaises(ValueError):
            history.slice(0, 1000)
        with self.assertRaises(ValueError):
            history.slice(5000, 7000)
        history = AudioHistory()
        history.append(bytes(24000 * 2 * 31))
        with self.assertRaisesRegex(ValueError, "30 seconds"):
            history.slice(0, 31000)


class ConversationTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.fake = connection([])
        self.assessor = MagicMock(assess=AsyncMock(return_value=parse_result(service_result(), SENTENCE, "en-US")))
        self.history = AudioHistory()
        self.history.append(b"\x01\0" * 24000)
        self.history.append(b"\x02\0" * 24000)
        self.history.append(b"\x03\0" * 24000)
        self.audio = MagicMock()
        self.prepare_count = 0
        self.controller = Conversation(self.fake, self.assessor, self.history, self.audio, [SENTENCE, "Second sentence."])

    async def spoken_turn(self, item_id="user-1", start=1000, end=2000):
        await self.controller.handle(wire("input_audio_buffer.speech_started", item_id=item_id, audio_start_ms=start))
        await self.controller.handle(wire("input_audio_buffer.speech_stopped", item_id=item_id, audio_end_ms=end))
        await self.controller.handle(wire("input_audio_buffer.committed", item_id=item_id))

    async def prepare(self, number=1):
        self.prepare_count += 1
        call = {
            "type": "function_call", "name": PREPARE_TOOL,
            "call_id": f"prepare-{self.prepare_count}", "arguments": json.dumps({"sentence_number": number}),
        }
        with patch("builtins.print"):
            await self.controller.handle(done([call]))
            await self.controller.handle(done([]))  # Coach's spoken reading prompt.

    async def test_chat_then_prompt_then_exact_sentence_assessment(self):
        await self.spoken_turn("chat", 0, 1000)
        self.fake.response.create.assert_awaited_with(response={"tool_choice": "auto"})
        self.assessor.assess.assert_not_awaited()
        await self.prepare()
        self.assertEqual(self.controller.pending_sentence, SENTENCE)
        await self.spoken_turn("attempt", 1000, 2000)
        self.assertIsNone(self.controller.pending_sentence)
        self.fake.response.create.assert_awaited_with(
            response=assessment_response()
        )
        # Argument delta/done events must not execute an assessment a second time.
        await self.controller.handle(wire("response.function_call_arguments.done", **tool_call()))
        with patch("builtins.print"):
            await self.controller.handle(done([tool_call()]))
            await self.controller.handle(done([]))
        self.assessor.assess.assert_awaited_once_with(b"\x02\0" * 24000, SENTENCE)
        await self.spoken_turn("chat-after", 2000, 3000)
        self.fake.response.create.assert_awaited_with(response={"tool_choice": "auto"})
        self.assertEqual(self.assessor.assess.await_count, 1)

    async def test_spoken_retry_rearms_same_reference_with_new_audio(self):
        await self.prepare()
        await self.spoken_turn("first", 1000, 2000)
        with patch("builtins.print"):
            await self.controller.handle(done([tool_call()]))
            await self.controller.handle(done([]))
        await self.spoken_turn("retry-request", 0, 1000)
        await self.prepare()
        await self.spoken_turn("retry-attempt", 2000, 3000)
        with patch("builtins.print"):
            await self.controller.handle(done([tool_call("call-2")]))
        self.assertEqual(self.assessor.assess.await_count, 2)
        self.assertEqual(self.assessor.assess.await_args_list[-1].args, (b"\x03\0" * 24000, SENTENCE))

    async def test_second_sentence_uses_selected_reference(self):
        await self.prepare(2)
        await self.spoken_turn()
        with patch("builtins.print"):
            await self.controller.handle(done([tool_call()]))
        self.assessor.assess.assert_awaited_once_with(b"\x02\0" * 24000, "Second sentence.")

    async def test_unavailable_audio_fails_explicitly_without_assessing_other_audio(self):
        await self.prepare()
        await self.spoken_turn(start=4000, end=5000)
        with patch("builtins.print"), self.assertLogs("conversation", level="ERROR"):
            await self.controller.handle(done([tool_call()]))
        self.assessor.assess.assert_not_awaited()
        result = json.loads(self.fake.conversation.item.create.await_args.kwargs["item"]["output"])
        self.assertFalse(result["ok"])
        self.assertNotIn("scores", result)
        self.assertEqual(self.controller.pending_sentence, SENTENCE)

    async def test_failed_assessment_notifies_coach_and_rearms_retry(self):
        await self.prepare()
        await self.spoken_turn()
        self.assessor.assess.side_effect = AssessmentError("Speech assessment HTTP 429")
        with patch("builtins.print"), self.assertLogs("conversation", level="ERROR"):
            await self.controller.handle(done([tool_call()]))
        result = json.loads(self.fake.conversation.item.create.await_args.kwargs["item"]["output"])
        self.assertFalse(result["ok"])
        self.assertIn("429", result["error"])
        self.assertEqual(self.controller.pending_sentence, SENTENCE)

    async def test_invalid_sentence_selection_and_assessment_outside_practice(self):
        for call in (
            {"type": "function_call", "name": PREPARE_TOOL, "call_id": "bad", "arguments": '{"sentence_number":99}'},
            tool_call(),
        ):
            with patch("builtins.print"), self.assertLogs("conversation", level="ERROR"):
                await self.controller.handle(done([call]))
            result = json.loads(self.fake.conversation.item.create.await_args.kwargs["item"]["output"])
            self.assertFalse(result["ok"])
        self.assessor.assess.assert_not_awaited()

    async def test_barge_in_cancels_reply_and_queues_next_response_until_done(self):
        await self.controller.respond("none")
        await self.spoken_turn()
        self.audio.interrupt.assert_called_once()
        self.fake.response.cancel.assert_awaited_once()
        self.assertEqual(self.fake.response.create.await_count, 1)
        await self.controller.handle(wire("response.output_audio.delta", delta="AAA="))
        self.audio.output.assert_not_called()
        await self.controller.handle(done([], status="cancelled"))
        self.assertEqual(self.fake.response.create.await_count, 2)

    async def test_duplicate_completed_call_never_assesses_twice(self):
        await self.prepare()
        await self.spoken_turn()
        with patch("builtins.print"):
            await self.controller.handle(done([tool_call()]))
        with self.assertRaisesRegex(RuntimeError, "Duplicate"):
            await self.controller.handle(done([tool_call()]))
        self.assertEqual(self.assessor.assess.await_count, 1)

    async def test_missing_tool_or_mismatched_vad_item_fails(self):
        await self.prepare()
        await self.spoken_turn()
        with self.assertRaisesRegex(RuntimeError, "must call"):
            await self.controller.handle(done([]))
        with self.assertRaisesRegex(RuntimeError, "matching"):
            await self.controller.handle(wire("input_audio_buffer.speech_stopped", item_id="other", audio_end_ms=1000))

    async def test_real_sdk_serializes_forced_tool_and_result(self):
        socket = MagicMock(send_str=AsyncMock())
        sdk = AsyncBetaRealtimeConnection(socket, MagicMock())
        self.controller.connection = sdk
        await self.prepare()
        await self.spoken_turn()
        with patch("builtins.print"):
            await self.controller.handle(done([tool_call()]))
        frames = [json.loads(call.args[0]) for call in socket.send_str.await_args_list]
        forced = [frame for frame in frames if frame["type"] == "response.create" and frame["response"]["tool_choice"] == "required"]
        self.assertEqual(forced[0]["response"], assessment_response())
        outputs = [frame["item"] for frame in frames if frame["type"] == "conversation.item.create"]
        self.assertEqual(outputs[-1]["type"], "function_call_output")
        self.assertEqual(json.loads(outputs[-1]["output"])["reference_text"], SENTENCE)


class DefinitionTests(unittest.TestCase):
    def test_released_sdk_definition_roundtrip(self):
        document = sample.definition("en-US").as_dict()
        self.assertEqual(document["kind"], "voice")
        self.assertFalse(document["store"])
        self.assertEqual(document["audio"]["input"]["turn_detection"]["type"], "server_vad")
        self.assertFalse(document["audio"]["input"]["turn_detection"]["create_response"])
        self.assertEqual(document["audio"]["input"]["format"]["rate"], 24000)
        tool = document["tools"][1]
        self.assertEqual(tool["name"], sample.TOOL_NAME)
        self.assertFalse(tool["parameters"]["additionalProperties"])
        self.assertIsNone(sample.definition("en-US", manual=True).as_dict()["audio"]["input"]["turn_detection"])

    def test_cli_sentences_and_file_constraints(self):
        self.assertEqual(len(sample.parse_args([]).sentence), 3)
        args = sample.parse_args(["--audio-file", "test.wav", "--sentence", SENTENCE])
        self.assertEqual(args.sentence, [SENTENCE])
        self.assertEqual(sample.parse_args(["--credential-mode", "cli"]).credential_mode, "cli")
        for argv in (["--sentence", " "], ["--audio-file", "test.wav"]):
            with patch("sys.stderr", io.StringIO()), self.assertRaises(SystemExit):
                sample.parse_args(argv)

    def test_project_endpoint(self):
        endpoint = "https://sample.services.ai.azure.com/api/projects/sample"
        self.assertEqual(sample.project_endpoint(endpoint + "/"), endpoint)
        for value in ("", endpoint + "?key=secret", endpoint.replace("https", "http"), "https://evil.example/api/projects/sample"):
            with self.assertRaises(ValueError):
                sample.project_endpoint(value)

    def test_invalid_environment_credential_mode_is_not_silently_replaced(self):
        with patch.dict(os.environ, {"AZURE_CREDENTIAL_MODE": "invalid"}):
            with patch("sys.stderr", io.StringIO()), self.assertRaises(SystemExit):
                sample.parse_args([])


if __name__ == "__main__":
    unittest.main()
