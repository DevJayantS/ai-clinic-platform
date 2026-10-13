#!/usr/bin/env python3
"""Local speech-to-text using faster-whisper (open source, no API key).

Usage: python3 transcribe.py <audio_file> [--model base] [--language en]
Prints one JSON line: {"text": "...", "language": "en"}
"""
import argparse
import json
import sys


def main():
    p = argparse.ArgumentParser()
    p.add_argument("audio")
    p.add_argument("--model", default="base")
    p.add_argument("--language", default=None)
    a = p.parse_args()

    from faster_whisper import WhisperModel  # imported lazily so errors are reported cleanly

    model = WhisperModel(a.model, device="cpu", compute_type="int8")
    segments, info = model.transcribe(a.audio, language=a.language or None, vad_filter=True)
    text = " ".join(s.text.strip() for s in segments).strip()
    json.dump({"text": text, "language": info.language}, sys.stdout)


if __name__ == "__main__":
    main()
