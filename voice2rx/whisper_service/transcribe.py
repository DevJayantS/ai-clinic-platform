#!/usr/bin/env python3
"""Local speech-to-text using faster-whisper (open source, no API key).

Usage: python3 transcribe.py <audio_file> [--model base] [--language en]
       python3 transcribe.py --check
Prints one JSON line: {"text": "...", "language": "en"}

Audio decoding: uses PyAV when installed (normal faster-whisper install). On platforms
without PyAV wheels (e.g. Python 3.14 on Intel macOS) it falls back to the bundled ffmpeg
binary from `imageio-ffmpeg` and passes a float32 array to Whisper. VAD filtering needs
onnxruntime and is enabled only when that is installed.
"""
import argparse
import json
import subprocess
import sys
import types


def _import_whisper():
    try:
        import av  # noqa: F401
    except ImportError:
        # faster_whisper imports `av` at module load even if we decode audio ourselves.
        sys.modules["av"] = types.ModuleType("av")
        decode_with_av = False
    else:
        decode_with_av = True
    from faster_whisper import WhisperModel
    return WhisperModel, decode_with_av


def _has_onnx():
    try:
        import onnxruntime  # noqa: F401
        return True
    except ImportError:
        return False


def _decode_ffmpeg(path):
    import imageio_ffmpeg
    import numpy as np
    exe = imageio_ffmpeg.get_ffmpeg_exe()
    proc = subprocess.run(
        [exe, "-nostdin", "-i", path, "-f", "f32le", "-ac", "1", "-ar", "16000", "-"],
        stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=False)
    if proc.returncode != 0 or not proc.stdout:
        raise RuntimeError("Could not decode audio (unsupported or corrupt file)")
    return np.frombuffer(proc.stdout, dtype=np.float32)


def main():
    p = argparse.ArgumentParser()
    p.add_argument("audio", nargs="?")
    p.add_argument("--model", default="base")
    p.add_argument("--language", default=None)
    p.add_argument("--check", action="store_true")
    a = p.parse_args()

    WhisperModel, decode_with_av = _import_whisper()
    if not decode_with_av:
        import imageio_ffmpeg  # noqa: F401  (fails the check if missing)
    if a.check:
        print("ok")
        return
    if not a.audio:
        p.error("audio file required")

    model = WhisperModel(a.model, device="cpu", compute_type="int8")
    source = a.audio if decode_with_av else _decode_ffmpeg(a.audio)
    segments, info = model.transcribe(source, language=a.language or None, vad_filter=_has_onnx())
    text = " ".join(s.text.strip() for s in segments).strip()
    json.dump({"text": text, "language": info.language}, sys.stdout)


if __name__ == "__main__":
    main()
