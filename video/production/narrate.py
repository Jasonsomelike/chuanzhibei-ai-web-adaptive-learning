"""Build MiMo narration in reusable lines, with exact subtitle timing."""
import argparse
import asyncio
import base64
from concurrent.futures import ThreadPoolExecutor
from functools import partial
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import time
from urllib.request import Request, urlopen

VIDEO = Path(__file__).resolve().parents[1]
OUT = VIDEO / "out" / "final-20261118" / "audio"
STORY = json.loads((VIDEO / "production" / "storyboard.json").read_text("utf-8"))
STYLE = "比赛产品演示，读得自然、清楚、平稳。普通话，速度适中，标点处短停。忠实朗读，不添加额外文字。"
URL = "https://api.xiaomimimo.com/v1/chat/completions"

def synthesize_mimo(text, path):
    body = {"model": "mimo-v2.5-tts", "messages": [
        {"role": "user", "content": STYLE}, {"role": "assistant", "content": text}],
        "audio": {"format": "wav", "voice": "冰糖"}}
    request = Request(URL, method="POST", data=json.dumps(body, ensure_ascii=False).encode("utf-8"),
                      headers={"Authorization": "Bearer " + os.environ["MIMO_API_KEY"],
                               "Content-Type": "application/json; charset=utf-8"})
    with urlopen(request, timeout=90) as response:
        result = json.load(response)
    sample = base64.b64decode(result["choices"][0]["message"]["audio"]["data"], validate=True)
    if len(sample) < 1000 or sample[:4] != b"RIFF":
        raise ValueError("MiMo 没有返回可用的 WAV")
    path.write_bytes(sample)

def synthesize_edge(text, path):
    import edge_tts
    source = path.with_suffix(".mp3")
    asyncio.run(edge_tts.Communicate(text, "zh-CN-XiaoxiaoNeural").save(str(source)))
    ffmpeg = os.environ.get("FFMPEG_PATH", "ffmpeg")
    subprocess.run([ffmpeg, "-y", "-v", "error", "-i", str(source), "-ac", "1", "-ar", "24000",
                    "-c:a", "pcm_s16le", str(path)], check=True)

def make(item, edge):
    beat, index, line = item
    stamp = hashlib.sha256((STYLE + line + ("edge" if edge else "")).encode()).hexdigest()[:12]
    path = OUT / "parts" / f"{beat}-{index}-{stamp}.wav"
    if not path.exists():
        for attempt in range(2):
            try:
                (synthesize_edge if edge else synthesize_mimo)(line, path)
                break
            except Exception as error:
                if attempt:
                    raise RuntimeError(f"{beat}/{index}: {type(error).__name__}, HTTP {getattr(error, 'code', 'n/a')}") from None
                time.sleep(3)
    shutil.copyfile(path, OUT / f"{beat}-{index}.wav")

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--edge", action="store_true", help="Use the same fallback voice for all lines.")
    options = parser.parse_args()
    if not options.edge and not os.environ.get("MIMO_API_KEY"):
        raise SystemExit("Set MIMO_API_KEY in this process, or select --edge.")
    (OUT / "parts").mkdir(parents=True, exist_ok=True)
    tasks = [(beat["id"], i, line) for beat in STORY for i, line in enumerate(beat["lines"])]
    with ThreadPoolExecutor(max_workers=3) as pool:
        for n, _ in enumerate(pool.map(partial(make, edge=options.edge), tasks), 1):
            if n % 10 == 0 or n == len(tasks):
                print(f"已完成 {n}/{len(tasks)} 句", flush=True)
