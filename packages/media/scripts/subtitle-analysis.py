"""Local, non-neural speech measurement reused by timing sync and regular-track proof.

No subtitle text enters WebRTC VAD. Every temporary artifact lives in the caller's
private control directory. The pinned ffsubsync npz contract avoids decoding the
video again when synchronizing and measuring the synchronized caption's coverage.
"""

import json
import os
import subprocess
import sys

import numpy as np
from ffsubsync.speech_transformers import _make_webrtcvad_detector


def audio(video: str, output: str, runtime_ms: int) -> None:
    detector = _make_webrtcvad_detector(100, 48_000, 0.0)
    command = ["ffmpeg", "-v", "error", "-nostdin", "-protocol_whitelist", "file,pipe",
               "-i", video, "-map", "0:a:0", "-t", str(runtime_ms / 1000),
               "-f", "s16le", "-ac", "1", "-acodec", "pcm_s16le", "-ar", "48000", "pipe:1"]
    parts = []
    frame_count = 0
    with subprocess.Popen(command, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE,
                          stderr=subprocess.DEVNULL) as process:
        if process.stdout is None:
            raise RuntimeError("Audio pipe unavailable")
        while True:
            chunk = process.stdout.read(960 * 1000)
            if not chunk:
                break
            measured = detector(chunk)
            frame_count += len(measured)
            if frame_count > (runtime_ms + 999) // 10:
                raise ValueError("Audio exceeded its measured duration")
            parts.append(measured)
        if process.wait() != 0:
            raise RuntimeError("Audio extraction failed")
    if not parts or abs(frame_count * 10 - runtime_ms) > 1000:
        raise ValueError("Audio did not cover the measured video runtime")
    with open(output, "xb") as target:
        np.savez_compressed(target, speech=np.concatenate(parts))
    print(json.dumps({"frames": frame_count}))


def coverage(reference: str, cue_file: str, runtime_ms: int) -> None:
    with open(cue_file, encoding="utf-8") as source:
        cues = json.load(source)
    if not isinstance(cues, list) or not 0 < len(cues) <= 100_000:
        raise ValueError("Invalid caption intervals")
    intervals = []
    last_start = -1
    for cue in cues:
        if (not isinstance(cue, list) or len(cue) != 2 or
                any(type(n) is not int for n in cue) or
                not 0 <= cue[0] < cue[1] <= runtime_ms + 1000 or cue[0] < last_start):
            raise ValueError("Invalid caption timing")
        last_start = cue[0]
        if cue[1] - cue[0] > 15_000:
            raise ValueError("Caption dialogue interval requires review")
        start, end = max(0, cue[0] - 250), min(runtime_ms, cue[1] + 250)
        if intervals and start <= intervals[-1][1]:
            intervals[-1][1] = max(intervals[-1][1], end)
        else:
            intervals.append([start, end])
    with np.load(reference, allow_pickle=False) as measured:
        speech = measured["speech"]
    if speech.ndim != 1 or abs(len(speech) * 10 - runtime_ms) > 1000 or not np.isin(speech, [0, 1]).all():
        raise ValueError("Invalid independently measured speech")
    windows = [{"speechMs": 0, "coveredSpeechMs": 0} for _ in range(12)]
    cursor = 0
    for frame, voiced in enumerate(speech):
        at = frame * 10
        if at >= runtime_ms or voiced != 1:
            continue
        while cursor < len(intervals) and intervals[cursor][1] <= at:
            cursor += 1
        covered = cursor < len(intervals) and intervals[cursor][0] <= at < intervals[cursor][1]
        window = windows[min(11, at * 12 // runtime_ms)]
        weight = min(10, runtime_ms - at)
        window["speechMs"] += weight
        if covered:
            window["coveredSpeechMs"] += weight
    print(json.dumps({"speechMs": sum(w["speechMs"] for w in windows),
                      "coveredSpeechMs": sum(w["coveredSpeechMs"] for w in windows),
                      "windows": windows}))


if __name__ == "__main__":
    if len(sys.argv) != 5 or sys.argv[1] not in ["audio", "coverage"]:
        raise ValueError("Expected a measurement mode, two local paths, and duration")
    mode, first, second, runtime = sys.argv[1:]
    runtime_ms = int(runtime)
    if not 0 < runtime_ms <= 28_800_000:
        raise ValueError("Video duration exceeds bounded caption analysis")
    for path in [first, second]:
        if not os.path.isabs(path) or os.path.realpath(os.path.dirname(path)) != os.path.dirname(path):
            raise ValueError("Analysis input is not a real local path")
    if os.path.realpath(first) != first or not os.path.isfile(first):
        raise ValueError("Missing local measurement input")
    if mode == "audio":
        audio(first, second, runtime_ms)
    else:
        if os.path.realpath(second) != second or not os.path.isfile(second):
            raise ValueError("Missing local caption intervals")
        coverage(first, second, runtime_ms)
