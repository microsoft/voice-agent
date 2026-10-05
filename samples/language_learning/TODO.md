# Language-learning sample TODO

## Improve TTS rendering of pronunciation coaching

**Status: Open.** Reported spoken-feedback issue:

> Pay attention to the syllables: pro-nun-ci-a-tion

TTS does not reliably read the hyphen-separated syllables as intended. This can
make the coach's pronunciation guidance confusing, even when the assessment
scores and word-level results are correct. The rendering issue is separate from
Azure Speech Pronunciation Assessment.

- [ ] Reproduce the phrase with the configured output voice and listen to the
  generated audio, not just the transcript.
- [ ] Investigate a speech-friendly feedback format that clearly demonstrates
  the whole word and the syllables or stress being taught. Keep written
  syllable breakdowns separate from spoken output if needed.
- [ ] Check which pronunciation controls the Voice Agent output path supports
  before relying on SSML, phoneme notation, or other synthesis markup.
- [ ] Add regression coverage and a live listening check for sentence feedback
  and spoken retries.

**Acceptance criteria:** The coach pronounces the whole word correctly and
renders any syllable guidance intelligibly, without unintended separator
readings or misleading fragments. Assessment scores and reference-text/audio
binding remain unchanged.
