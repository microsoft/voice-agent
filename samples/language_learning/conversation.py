"""Hands-free audio transport and sentence-bound pronunciation tool lifecycle."""

from __future__ import annotations

import asyncio
import base64
import json
import logging
import queue
from collections import deque
from dataclasses import dataclass
from typing import Any

from assessment import AssessmentError, PronunciationAssessor, VOICE_RATE, validate_pcm

logger = logging.getLogger(__name__)
PREPARE_TOOL = "prepare_practice"
ASSESS_TOOL = "assess_pronunciation"
CHUNK_FRAMES = 1200


def assessment_tool() -> dict[str, Any]:
    return {
        "type": "function",
        "name": ASSESS_TOOL,
        "description": (
            "Assess the current recorded practice attempt against the client-selected "
            "reference sentence using Azure Speech Pronunciation Assessment. "
            "The client binds the audio and reference; no audio or text arguments are needed."
        ),
        "parameters": {
            "type": "object", "properties": {}, "required": [],
            "additionalProperties": False,
        },
    }


def assessment_response() -> dict[str, Any]:
    # Require a call from a one-tool allowlist. The live gpt-realtime service can
    # emit a message containing "{}" for a named function choice instead.
    return {"tool_choice": "required", "tools": [assessment_tool()]}


class AudioHistory:
    """Bounded PCM indexed by the same session clock as server VAD offsets."""

    def __init__(self, seconds: int = 120) -> None:
        self.limit = seconds * VOICE_RATE
        self.frames = 0
        self.chunks: deque[tuple[int, bytes]] = deque()

    def append(self, pcm: bytes) -> None:
        if len(pcm) % 2:
            raise ValueError("Audio frames must be complete 16-bit PCM samples.")
        self.chunks.append((self.frames, pcm))
        self.frames += len(pcm) // 2
        while self.chunks and self.chunks[0][0] + len(self.chunks[0][1]) // 2 <= self.frames - self.limit:
            self.chunks.popleft()

    def slice(self, start_ms: int, end_ms: int) -> bytes:
        start = start_ms * VOICE_RATE // 1000
        end = end_ms * VOICE_RATE // 1000
        if (
            start < 0 or end <= start or end > self.frames
            or not self.chunks or start < self.chunks[0][0]
        ):
            raise ValueError("The practice audio is missing or outside the retained recording window.")
        parts = []
        for offset, pcm in self.chunks:
            left = max(start, offset)
            right = min(end, offset + len(pcm) // 2)
            if right > left:
                parts.append(pcm[(left - offset) * 2:(right - offset) * 2])
        audio = b"".join(parts)
        if len(audio) != (end - start) * 2:
            raise ValueError("The practice recording has a gap.")
        validate_pcm(audio)
        return audio


def audio_module():
    try:
        import pyaudio
    except ImportError as error:
        raise RuntimeError("Install this sample's requirements to use microphone/playback.") from error
    return pyaudio


class LiveAudio:
    def __init__(self, history: AudioHistory, playback: bool) -> None:
        self.module = audio_module()
        self.audio = self.module.PyAudio()
        self.history = history
        self.playback = playback
        self.input_stream = None
        self.output_stream = None
        self.incoming: asyncio.Queue[bytes] = asyncio.Queue(maxsize=200)
        self.outgoing: queue.Queue[tuple[int, bytes]] = queue.Queue(maxsize=2400)
        self.generation = 0
        self.failure: asyncio.Future[None] = asyncio.get_running_loop().create_future()
        self.remaining = b""
        self.remaining_generation = 0

    def fail(self, message: str) -> None:
        if not self.failure.done():
            self.failure.set_exception(RuntimeError(message))

    def start(self) -> None:
        loop = asyncio.get_running_loop()

        def enqueue(pcm, status):
            if status:
                self.fail("Microphone overflow: audio was lost. Restart the lesson.")
                return
            try:
                self.incoming.put_nowait(pcm)
            except asyncio.QueueFull:
                self.fail("Audio upload cannot keep up with the microphone. Restart the lesson.")

        def capture(data, _frame_count, _time_info, status):
            loop.call_soon_threadsafe(enqueue, data, status)
            return (None, self.module.paContinue)

        def render(_data, frame_count, _time_info, _status):
            wanted = frame_count * 2
            if self.remaining_generation != self.generation:
                self.remaining = b""
            output = self.remaining[:wanted]
            self.remaining = self.remaining[wanted:]
            while len(output) < wanted:
                try:
                    generation, pcm = self.outgoing.get_nowait()
                except queue.Empty:
                    return (output + bytes(wanted - len(output)), self.module.paContinue)
                if generation != self.generation:
                    continue
                take = wanted - len(output)
                output += pcm[:take]
                self.remaining = pcm[take:]
                self.remaining_generation = generation
            return (output, self.module.paContinue)

        if self.playback:
            self.output_stream = self.audio.open(
                format=self.module.paInt16, channels=1, rate=VOICE_RATE, output=True,
                frames_per_buffer=CHUNK_FRAMES, stream_callback=render,
            )
        self.input_stream = self.audio.open(
            format=self.module.paInt16, channels=1, rate=VOICE_RATE, input=True,
            frames_per_buffer=CHUNK_FRAMES, stream_callback=capture,
        )

    async def send(self, connection: Any) -> None:
        while True:
            pcm = await self.incoming.get()
            # Keep every frame in append order, before any VAD reply can arrive.
            # An append failure ends the session rather than skewing the audio clock.
            self.history.append(pcm)
            await connection.input_audio_buffer.append(audio=pcm)

    def output(self, delta: Any) -> None:
        if not self.playback:
            return
        pcm = delta if isinstance(delta, bytes) else base64.b64decode(delta, validate=True)
        try:
            self.outgoing.put_nowait((self.generation, pcm))
        except queue.Full:
            self.fail("Audio playback cannot keep up. Restart with --no-playback.")

    def interrupt(self) -> None:
        self.generation += 1

    def close(self) -> None:
        for stream in (self.input_stream, self.output_stream):
            if stream is not None:
                stream.stop_stream()
                stream.close()
        self.audio.terminate()
        if not self.failure.done():
            self.failure.cancel()


@dataclass
class Turn:
    item_id: str
    sentence: str | None
    start_ms: int
    pcm: bytes = b""
    error: str = ""


class Conversation:
    def __init__(
        self, connection: Any, assessor: PronunciationAssessor,
        history: AudioHistory, audio: Any, sentences: list[str],
    ) -> None:
        self.connection = connection
        self.assessor = assessor
        self.history = history
        self.audio = audio
        self.sentences = sentences
        self.pending_sentence: str | None = None
        self.turns: dict[str, Turn] = {}
        self.ready: deque[Turn] = deque()
        self.current: Turn | None = None
        self.responding = False
        self.cancel_requested = False
        self.expect_assessment = False
        self.completed_calls: set[str] = set()

    async def respond(self, tool_choice: Any = "auto", **fields) -> None:
        self.responding = True
        self.cancel_requested = False
        await self.connection.response.create(response={"tool_choice": tool_choice, **fields})

    async def next_turn(self) -> None:
        if self.responding or not self.ready:
            return
        self.current = self.ready.popleft()
        self.expect_assessment = self.current.sentence is not None
        if self.current.sentence is not None:
            await self.respond(**assessment_response())
        else:
            await self.respond("auto")

    async def tool_output(self, call: dict[str, Any], result: dict[str, Any]) -> None:
        print("\nTool result:\n" + json.dumps(result, ensure_ascii=False, indent=2))
        await self.connection.conversation.item.create(item={
            "type": "function_call_output", "call_id": call["call_id"],
            "output": json.dumps(result, ensure_ascii=False),
        })

    async def execute(self, call: dict[str, Any]) -> None:
        result: dict[str, Any]
        try:
            arguments = json.loads(call.get("arguments") or "{}")
            if call.get("name") == PREPARE_TOOL:
                if (
                    not isinstance(arguments, dict) or set(arguments) != {"sentence_number"}
                    or type(arguments["sentence_number"]) is not int
                    or not 1 <= arguments["sentence_number"] <= len(self.sentences)
                ):
                    raise ValueError("Choose a sentence_number from the provided lesson.")
                if self.pending_sentence is not None or any(turn.sentence for turn in self.ready):
                    raise ValueError("A practice attempt is already pending.")
                self.pending_sentence = self.sentences[arguments["sentence_number"] - 1]
                result = {
                    "ok": True, "reference_text": self.pending_sentence,
                    "instruction": "Ask the learner to read this exact sentence aloud on their next turn.",
                }
                print(f"\nPractice sentence: {self.pending_sentence}")
            elif call.get("name") == ASSESS_TOOL:
                if arguments != {} or self.current is None or self.current.sentence is None:
                    raise ValueError("Assessment requires the current practice attempt and no arguments.")
                if self.current.error:
                    raise ValueError(self.current.error)
                result = await self.assessor.assess(self.current.pcm, self.current.sentence)
            else:
                raise ValueError("Unknown language-learning tool.")
        except (AssessmentError, ValueError) as error:
            logger.error("Language-learning tool failed: %s", error)
            result = {"ok": False, "error": str(error)}
            if self.current and self.current.sentence:
                result["reference_text"] = self.current.sentence
                # A failed assessment can be retried on the learner's next turn.
                self.pending_sentence = self.current.sentence
        await self.tool_output(call, result)
        self.expect_assessment = False
        await self.respond("none")

    async def handle(self, event: dict[str, Any]) -> None:
        kind = event.get("type")
        if kind in {"error", "conversation.item.input_audio_transcription.failed"}:
            raise RuntimeError("Voice session failed; check project access, model, and audio configuration.")
        if kind == "input_audio_buffer.speech_started":
            self.audio.interrupt()
            item_id = event["item_id"]
            if item_id in self.turns:
                raise RuntimeError("Duplicate speech-start item; cannot associate the recording safely.")
            self.turns[item_id] = Turn(item_id, self.pending_sentence, event["audio_start_ms"])
            self.pending_sentence = None
            # Cancel spoken replies on barge-in, but let an assessment tool finish.
            if self.responding and not self.cancel_requested and not self.expect_assessment:
                self.cancel_requested = True
                await self.connection.response.cancel()
        elif kind == "input_audio_buffer.speech_stopped":
            turn = self.turns.get(event["item_id"])
            if turn is None:
                raise RuntimeError("Speech stopped without a matching start item.")
            if turn.sentence is not None:
                try:
                    turn.pcm = self.history.slice(turn.start_ms, event["audio_end_ms"])
                except ValueError as error:
                    turn.error = str(error)
        elif kind == "input_audio_buffer.committed":
            turn = self.turns.pop(event["item_id"], None)
            if turn is None:
                raise RuntimeError("Committed audio has no matching speech item.")
            if turn.sentence is not None and not turn.pcm and not turn.error:
                turn.error = "No complete practice recording was captured."
            if len(self.ready) >= 8:
                raise RuntimeError("Too many pending turns; wait for the coach's feedback.")
            self.ready.append(turn)
            await self.next_turn()
        elif kind == "conversation.item.input_audio_transcription.completed":
            print(f"You: {event.get('transcript', '')}")
        elif kind == "response.output_audio.delta":
            if not self.cancel_requested:
                self.audio.output(event["delta"])
        elif kind in {"response.output_audio_transcript.done", "response.output_text.done"}:
            print(f"Coach: {event.get('transcript') or event.get('text') or ''}")
        elif kind == "response.done":
            self.responding = False
            response = event.get("response") or {}
            status = response.get("status")
            if status == "cancelled":
                if self.expect_assessment:
                    raise RuntimeError("The pronunciation tool response was unexpectedly cancelled.")
                self.current = None
                await self.next_turn()
                return
            if status != "completed":
                raise RuntimeError("The coach's response failed or was incomplete.")
            calls = [item for item in response.get("output", []) if item.get("type") == "function_call"]
            if self.expect_assessment and (len(calls) != 1 or calls[0].get("name") != ASSESS_TOOL):
                raise RuntimeError("A practice attempt must call the pronunciation assessment tool.")
            if calls:
                if len(calls) != 1 or not calls[0].get("call_id"):
                    raise RuntimeError("Expected exactly one completed language-learning tool call.")
                call_id = calls[0]["call_id"]
                if call_id in self.completed_calls:
                    raise RuntimeError("Duplicate completed tool call; assessment will not be repeated.")
                if len(self.completed_calls) >= 1000:
                    raise RuntimeError("This lesson reached 1000 tool calls. Start a new session.")
                self.completed_calls.add(call_id)
                await self.execute(calls[0])
            else:
                self.current = None
                await self.next_turn()


async def run_conversation(connection: Any, assessor: PronunciationAssessor, args: Any) -> None:
    from language_learning import wait_for

    async with asyncio.timeout(120):
        ready = await wait_for(connection, "session.updated")
    session = ready.get("session") or {}
    vad = ((session.get("audio") or {}).get("input") or {}).get(
        "turn_detection", session.get("turn_detection")
    )
    if not isinstance(vad, dict) or vad.get("type") != "server_vad" or vad.get("create_response") is not False:
        raise RuntimeError("Hands-free sentence binding requires server VAD with create_response=False.")
    history = AudioHistory()
    audio = LiveAudio(history, not args.no_playback)
    controller = Conversation(connection, assessor, history, audio, args.sentence)

    async def events() -> None:
        await controller.respond("none", instructions=(
            "Greet the learner as a friendly language coach. Ask about their day or "
            "learning goals. Start with conversation, not a reading exercise."
        ))
        iterator = connection.__aiter__()
        while True:
            try:
                async with asyncio.timeout(120 if controller.responding else None):
                    event = await anext(iterator)
            except StopAsyncIteration:
                return
            await controller.handle(event.as_dict() if hasattr(event, "as_dict") else dict(event))

    tasks = []
    try:
        audio.start()
        print("Speak naturally. The coach will ask you to read a sentence during the chat.")
        print("Pause to finish your turn. Use a headset; Ctrl-C ends the lesson.")
        tasks = [asyncio.create_task(audio.send(connection)), asyncio.create_task(events())]
        done, _ = await asyncio.wait([*tasks, audio.failure], return_when=asyncio.FIRST_COMPLETED)
        for task in done:
            task.result()
    finally:
        for task in tasks:
            task.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)
        audio.close()
