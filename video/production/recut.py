"""Edit live 60 fps browser recordings, timed focus moves, narration and short subtitles."""

import argparse
from concurrent.futures import ThreadPoolExecutor
from functools import partial
import json
import math
import os
from pathlib import Path
import re
import subprocess
import wave

import numpy as np
from PIL import ImageFont
import compose
import narrate

HERE = Path(__file__).resolve().parent
OUT = HERE.parent / "out" / "recut"
RENDER = OUT / "render"
AUDIO = OUT / "audio"
ORIGINAL = {item["id"]: item["lines"] for item in compose.STORY}
STORY = json.loads((HERE / "recut.json").read_text("utf8"))
FPS = 60
TEMPO = 1.12
RATE = 24000
STEM = "chuanzhibei-live-1080p60"
FF = os.environ.get("FFMPEG_PATH", "ffmpeg")
PROBE = os.environ.get("FFPROBE_PATH", "ffprobe")
FONT = ImageFont.truetype(
    str(Path(os.environ.get("WINDIR", "C:/Windows")) / "Fonts/msyhbd.ttc"), 38
)
SPLITS = {
    "主要功能有学习诊断、路径规划、课程导师和自定义学习方向。": "主要功能有学习诊断、路径规划、|课程导师和自定义学习方向。",
    "再点队列，就能读到队列的内容和它的先修知识。": "再点队列，就能读到队列的内容|和它的先修知识。",
    "同一个知识点会分别估算新学和复习需要多久。": "同一个知识点会分别估算|新学和复习需要多久。",
    "这样排出的学习顺序，才不会要求学生先学一个依赖自己的知识点。": "这样排出的学习顺序，|才不会要求学生先学一个依赖自己的知识点。",
}


def run(args, capture=False):
    return subprocess.run(
        [str(x) for x in args],
        cwd=OUT,
        check=True,
        capture_output=capture,
        text=capture,
        encoding="utf8" if capture else None,
    )


def lines(row):
    return row[2] if len(row) > 2 else ORIGINAL[row[0]]


def wavpath(key, i, text):
    if i < len(ORIGINAL.get(key, [])) and text == ORIGINAL[key][i]:
        return compose.AUDIO / f"{key}-{i}.wav"
    return AUDIO / f"{key}-{i}.wav"


def voices():
    narrate.OUT = AUDIO
    (AUDIO / "parts").mkdir(parents=True, exist_ok=True)
    tasks = [
        (row[0], i, text)
        for row in STORY
        for i, text in enumerate(lines(row))
        if wavpath(row[0], i, text).parent == AUDIO
    ]
    with ThreadPoolExecutor(max_workers=3) as pool:
        list(pool.map(partial(narrate.make, edge=False), tasks))


def phrases(text):
    if text in SPLITS:
        return SPLITS[text].split("|")
    bits = re.findall(r"[^，。！？、；]+[，。！？、；]?", text)
    out = []
    for bit in bits:
        if out and len(out[-1]) + len(bit) <= 19:
            out[-1] += bit
        else:
            out.append(bit)
    return out


def word_cues(text, samples):
    # Move punctuation boundaries to the quietest nearby 25 ms of the real voice.
    parts = phrases(text)
    lengths = [len(part) + (2 if part.endswith("，") else 0) for part in parts]
    sec = len(samples) / RATE
    bounds = [0.0]
    for i in range(1, len(parts)):
        expected = sec * sum(lengths[:i]) / sum(lengths)
        candidates = np.arange(
            max(bounds[-1] + 0.45, expected - 0.30),
            min(sec - 0.42, expected + 0.30),
            0.015,
        )

        def cost(t):
            a = samples[int(t * RATE) : int((t + 0.025) * RATE)].astype(float)
            return np.sqrt(np.mean(a * a)) + abs(t - expected) * 110

        bounds.append(min(candidates, key=cost) if len(candidates) else expected)
    bounds.append(sec)
    return list(zip(bounds, bounds[1:], parts))


def soundtrack():
    captions = {}
    offset = 0
    all_srt = []
    with wave.open(str(OUT / "voice.wav"), "wb") as dst:
        dst.setparams((1, 2, RATE, 0, "NONE", ""))

        def pad_to(t):
            n = round(t * RATE) - dst.getnframes()
            if n > 0:
                dst.writeframes(b"\0\0" * n)

        for row in STORY:
            key, seconds = row[:2]
            clips = []
            for i, text in enumerate(lines(row)):
                src = wavpath(key, i, text)
                paced = RENDER / f"{key}-{i}-paced.wav"
                run(
                    [
                        FF,
                        "-y",
                        "-v",
                        "error",
                        "-i",
                        src,
                        "-af",
                        f"atempo={TEMPO}",
                        "-ac",
                        "1",
                        "-ar",
                        RATE,
                        paced,
                    ]
                )
                with wave.open(str(paced), "rb") as w:
                    samples = np.frombuffer(
                        w.readframes(w.getnframes()), dtype="<i2"
                    ).copy()
                clips.append((text, samples))
            room = seconds - sum(len(s) / RATE for _, s in clips)
            if room < 0:
                raise ValueError(f"{key}: narration exceeds picture by {-room:.2f}s")
            lead = min(0.42, room * 0.14)
            gap = min(1.65, max(0, (room - lead - 0.8) / max(len(clips) - 1, 1)))
            start = lead
            captions[key] = []
            for text, samples in clips:
                pad_to(offset + start)
                dst.writeframes(samples.tobytes())
                for a, b, part in word_cues(text, samples):
                    captions[key].append([start + a, start + b, part])
                    all_srt.append((offset + start + a, offset + start + b, part))
                start += len(samples) / RATE + gap
            offset += seconds
            pad_to(offset)
    data = "\n".join(
        f"{i}\n{compose.msfmt(a, False)} --> {compose.msfmt(b, False)}\n{text}\n"
        for i, (a, b, text) in enumerate(all_srt, 1)
    )
    (OUT / (STEM + ".srt")).write_text(data, encoding="utf-8-sig")
    (RENDER / "captions.json").write_text(
        json.dumps(captions, ensure_ascii=False), encoding="utf8"
    )


def subtitle_track(key, rows, jump, seconds):
    header = compose.ASS.replace("Microsoft YaHei,34", "Microsoft YaHei,38")
    header = header.replace("1,1,0,2,60,60,26,1", "1,0,0,5,0,0,0,1")
    rows_out = [header]

    def show(layer, start, end, data, style="Subtitle"):
        rows_out.append(
            f"Dialogue: {layer},{compose.msfmt(start, True)},{compose.msfmt(end, True)},{style},,0,0,0,,{data}\n"
        )

    for a, b, text in rows:
        # A narrow, softly rounded backing follows each phrase on light or dark footage.
        y = 980
        if key == "phone":
            y = 994
        if key in {"diagnose", "feedback", "nodes"}:
            y = 84
        w = math.ceil(FONT.getlength(text) / 2) + 26
        h = 32
        r = 13
        # ASS cubic Beziers draw the four corners.
        path = (
            f"m {-w + r} {-h} l {w - r} {-h} b {w} {-h} {w} {-h} {w} {-h + r} l {w} {h - r} "
            f"b {w} {h} {w} {h} {w - r} {h} l {-w + r} {h} b {-w} {h} {-w} {h} {-w} {h - r} "
            f"l {-w} {-h + r} b {-w} {-h} {-w} {-h} {-w + r} {-h}"
        )
        show(
            0,
            a,
            b,
            r"{\an7\pos(960,"
            + str(y)
            + r")\bord0\shad0\1c&H19251E&\1a&H35&\p1}"
            + path,
        )
        show(1, a, b, r"{\an5\pos(960," + str(y) + r")\b1\fs46\bord0\shad0}" + text)
    if jump is not None:
        show(1, jump + 0.05, min(seconds, jump + 2.1), "已跳过模型等待", "Label")
    if key == "tutor_source":
        show(1, 0.15, 2, "已跳过模型等待", "Label")
    if key == "end":
        show(
            0,
            6,
            seconds,
            r"{\an7\pos(1075,730)\bord0\1c&H354837&\p1}m 12 0 l 592 0 b 602 0 604 2 604 12 l 604 118 b 604 128 602 130 592 130 l 12 130 b 2 130 0 128 0 118 l 0 12 b 0 2 2 0 12 0",
        )
        show(1, 6, seconds, r"{\an7\pos(1107,747)\fs29\b0\c&HE1E6D2&}在线演示")
        show(1, 6, seconds, r"{\an7\pos(1104,789)\fs48\b1}chuanzhi.jasonsome.cn")
    if key == "phone":
        show(
            1, 0, seconds, r"{\an7\pos(185,355)\c&H40513D&\fs34\b0}课程导师　/　手机端"
        )
        show(1, 0, seconds, r"{\an7\pos(178,425)\c&H29372C&\fs70\b1}在对话里翻开教材")
    (RENDER / f"{key}.ass").write_text("".join(rows_out), encoding="utf-8-sig")


def source(name):
    for root in [OUT / "live-hd", OUT / "live"]:
        meta = root / (name + ".json")
        if meta.exists() and (root / (name + ".webm")).is_file():
            return root / (name + ".webm"), json.loads(meta.read_text("utf8"))
    raise FileNotFoundError(name)


def duration(file):
    return float(
        run(
            [
                PROBE,
                "-v",
                "error",
                "-show_entries",
                "format=duration",
                "-of",
                "csv=p=0",
                file,
            ],
            True,
        ).stdout
    )


def camera(cues, index):
    # Interpolate the top-left of the crop separately from scale, stopping at frame edges.
    moves = [(0.0, 0.0, 0.0, 1.0)]
    for c in cues:
        z = max(1, min(2.3, c["z"]))
        x = max(0, min(1 - 1 / z, c["x"] - 0.5 / z))
        y = max(0, min(1 - 1 / z, c["y"] - 0.46 / z))
        moves.append((max(0.05, c["t"]), x, y, z))
    value = f"{moves[0][index]:.6f}"
    for prev, cur in zip(moves, moves[1:]):
        old = prev[index]
        new = cur[index]
        change = min(0.80, max(0.15, cur[0] - prev[0]))
        u = f"clip((on/60-{cur[0]:.3f})/{change:.3f},0,1)"
        if abs(new - old) > 1e-6:
            value += f"+({new - old:.6f})*({u})*({u})*(3-2*({u}))"
    return value


def edit_segment(row):
    key, seconds = row[:2]
    pieces = {
        "turn1": [("turn1", 7), ("turn1_result", 10)],
        "turn2": [("turn2", 7), ("turn2_result", 10)],
        "build": [("build", 6), ("build_result", 13)],
    }.get(key, [(key, seconds)])
    if key == "save" and (OUT / "live-hd/bank.json").exists():
        pieces = [("save", 11), ("bank", 6)]
    captions = json.loads((RENDER / "captions.json").read_text("utf8"))
    subtitle_track(
        key,
        captions[key],
        pieces[0][1] if key in {"turn1", "turn2", "build"} else None,
        seconds,
    )
    inputs = []
    filters = []
    for i, (name, length) in enumerate(pieces):
        file, meta = source(name)
        inputs += ["-threads", "3", "-i", file]
        active = meta["view"]
        w, h = active["width"], active["height"]
        # Chromium emits CSS-viewport-sized screencast frames. Discard any recorder padding.
        chain = f"[{i}:v]crop={w}:{h}:0:0,setsar=1"
        if name == "phone":
            chain += ",scale=-2:1032:flags=lanczos,pad=1920:1080:1130:24:color=0xf4f1e9"
        else:
            cues = meta["cues"]
            if name == "nodes":
                # The prerequisite row spans the page; its label sits under the heading on the left.
                cues[-1] = {**cues[-1], "x": 0.24}
            if name in {"turn1_result", "turn2_result"}:
                cues = [{"t": 0.3, "x": 0.32, "y": 0.45, "z": 1.55}]
            if name == "tutor_source":
                cues[-1] = {**cues[-1], "x": 0.88, "y": 0.30, "z": 1.88}
            if name == "estimate":
                cues[-1] = {**cues[-1], "x": 0.27, "z": 1.85}
            if cues:
                chain += (
                    f",zoompan=z='{camera(cues, 3)}':x='iw*({camera(cues, 1)})':y='ih*({camera(cues, 2)})'"
                    ":d=1:s=1920x1080:fps=60"
                )
            else:
                chain += ",scale=1920:1080:flags=lanczos"
        dur = duration(file)
        if dur < length - 0.04:
            chain += f",setpts={length / dur:.8f}*PTS,fps=60"
        chain += f",trim=end_frame={length * FPS},setpts=N/(60*TB),setsar=1,format=yuv420p[v{i}]"
        filters.append(chain)
    current = "v0"
    if len(pieces) > 1:
        filters.append(
            "".join(f"[v{i}]" for i in range(len(pieces)))
            + f"concat=n={len(pieces)}:v=1:a=0[whole]"
        )
        current = "whole"
    filters.append(f"[{current}]ass=render/{key}.ass[out]")
    run(
        [
            FF,
            "-hide_banner",
            "-y",
            "-loglevel",
            "error",
            "-filter_complex_threads",
            "3",
            *inputs,
            "-filter_complex",
            ";".join(filters),
            "-map",
            "[out]",
            "-an",
            "-c:v",
            "libx264",
            "-preset",
            "veryfast",
            "-crf",
            "15",
            "-threads",
            "5",
            "-pix_fmt",
            "yuv420p",
            "-r",
            "60",
            RENDER / (key + ".mp4"),
        ]
    )
    print("完成", key, flush=True)


def mux():
    expected = sum(row[1] for row in STORY)
    for key, sec, *_ in STORY:
        if abs(duration(RENDER / (key + ".mp4")) - sec) > 0.03:
            raise ValueError(f"Incomplete {key}")
    (RENDER / "list.txt").write_text(
        "".join(f"file '{row[0]}.mp4'\n" for row in STORY), "utf8"
    )
    run(
        [
            FF,
            "-y",
            "-v",
            "error",
            "-f",
            "concat",
            "-safe",
            "0",
            "-i",
            "render/list.txt",
            "-i",
            "voice.wav",
            "-map",
            "0:v",
            "-map",
            "1:a",
            "-c:v",
            "copy",
            "-c:a",
            "aac",
            "-b:a",
            "192k",
            "-ar",
            "48000",
            "-af",
            "loudnorm=I=-16:LRA=10:TP=-1.5",
            "-t",
            expected,
            "-movflags",
            "+faststart",
            OUT / (STEM + ".mp4"),
        ]
    )


if __name__ == "__main__":
    args = argparse.ArgumentParser()
    args.add_argument("task", choices=["voices", "audio", "video", "mux"])
    args.add_argument("scenes", nargs="*")
    opt = args.parse_args()
    RENDER.mkdir(parents=True, exist_ok=True)
    if opt.task == "voices":
        voices()
    elif opt.task == "audio":
        soundtrack()
    elif opt.task == "mux":
        mux()
    else:
        jobs = [row for row in STORY if not opt.scenes or row[0] in opt.scenes]
        with ThreadPoolExecutor(max_workers=2) as pool:
            list(pool.map(edit_segment, jobs))
