"""独立交叉校验：仅用 Python 标准库 wave/json 验证导出的 WAV 与工程 JSON。"""
import json
import wave
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "output"

project = json.loads((OUT / "project.json").read_text(encoding="utf-8"))
duration_ms = project["durationMs"]
cues = project["cues"]

with wave.open(str(OUT / "rhythm.wav"), "rb") as wav:
    channels = wav.getnchannels()
    sample_width = wav.getsampwidth()
    sample_rate = wav.getframerate()
    frame_count = wav.getnframes()
    frames = wav.readframes(frame_count)

assert channels == 1, f"期望单声道，实际 {channels}"
assert sample_width == 2, f"期望 16-bit，实际 {sample_width * 8}-bit"
assert sample_rate == 48000, f"期望 48kHz，实际 {sample_rate}Hz"

expected_frames = round(duration_ms / 1000 * sample_rate)
assert frame_count == expected_frames, f"帧数 {frame_count} != {expected_frames}"
assert len(frames) == expected_frames * 2, "PCM 数据字节长度不符"

boundaries = sorted({ms for cue in cues for ms in (cue["start"], cue["end"])})
print(f"Python 交叉校验: {len(cues)} 条字幕, {len(boundaries)} 个节奏边界")
print(f"  WAV: {sample_rate}Hz / {sample_width * 8}bit / {channels}ch")
print(f"  帧数={frame_count}, 时长={frame_count / sample_rate:.3f}s, 工程时长={duration_ms / 1000:.3f}s")
assert abs(frame_count / sample_rate - duration_ms / 1000) < 0.002
print("Python 标准库交叉校验通过 ✔")
