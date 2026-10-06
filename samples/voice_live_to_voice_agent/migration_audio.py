"""Local microphone and speaker I/O for the two migration examples."""

from __future__ import annotations

import asyncio
import queue
import sys
import threading
from collections.abc import AsyncIterator

RATE = 24000
FRAMES = 480


class AudioError(Exception):
    """An audio device, format, or buffering failure."""


class Audio:
    """Capture and play mono PCM16 without depending on another sample."""

    def __init__(self):
        self.microphone: queue.Queue[bytes] = queue.Queue(maxsize=100)
        self.output = bytearray()
        self.lock = threading.Lock()
        self.input_stream = self.output_stream = None
        self.input_error: str | None = None
        self.sd = None

    def __enter__(self):
        if sys.byteorder != "little":
            raise AudioError("These demos require a little-endian PCM16 host.")
        try:
            import sounddevice as sd
        except (ImportError, OSError) as exc:
            raise AudioError(
                "Install requirements.txt and PortAudio to use microphone/speaker devices."
            ) from exc
        self.sd = sd
        try:
            sd.check_input_settings(channels=1, dtype="int16", samplerate=RATE)
            sd.check_output_settings(channels=1, dtype="int16", samplerate=RATE)
        except (ValueError, sd.PortAudioError) as exc:
            raise AudioError(
                "Audio device unavailable. Select your default microphone and speaker in "
                "OS sound settings and allow microphone access. Run on your local computer, "
                "not a headless SSH server."
            ) from exc
        return self

    def start(self):
        self.output_stream = self.sd.RawOutputStream(
            samplerate=RATE, channels=1, dtype="int16", blocksize=FRAMES,
            callback=self._speaker,
        )
        self.output_stream.start()
        self.input_stream = self.sd.RawInputStream(
            samplerate=RATE, channels=1, dtype="int16", blocksize=FRAMES,
            callback=self._microphone,
        )
        self.input_stream.start()

    def _microphone(self, data, frames, timing, status):
        if status:
            self.input_error = "Microphone status error; audio could not be captured reliably."
        try:
            self.microphone.put_nowait(bytes(data))
        except queue.Full:
            self.input_error = "Microphone backlog exceeded 2 seconds; check your connection."

    def _speaker(self, output, frames, timing, status):
        with self.lock:
            count = min(len(output), len(self.output))
            output[:count] = self.output[:count]
            output[count:] = bytes(len(output) - count)
            del self.output[:count]

    def play(self, pcm: bytes):
        if len(pcm) % 2:
            raise AudioError("Received an incomplete PCM16 sample.")
        with self.lock:
            if len(self.output) + len(pcm) > RATE * 2 * 30:
                raise AudioError("Speaker backlog exceeded 30 seconds; stopping.")
            self.output.extend(pcm)

    async def frames(self, stop: asyncio.Event) -> AsyncIterator[bytes]:
        while not stop.is_set():
            if self.input_error:
                raise AudioError(self.input_error)
            try:
                pcm = self.microphone.get_nowait()
            except queue.Empty:
                await asyncio.sleep(0.005)
                continue
            yield pcm

    def __exit__(self, *_):
        try:
            if self.input_stream:
                try:
                    self.input_stream.abort()
                finally:
                    self.input_stream.close()
        finally:
            if self.output_stream:
                try:
                    self.output_stream.abort()
                finally:
                    self.output_stream.close()
