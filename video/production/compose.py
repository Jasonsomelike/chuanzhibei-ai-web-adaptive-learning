"""Make a 1080p master from the recorded online product and the timed narration."""
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
import argparse
import json
import os
import re
import subprocess
import wave

VIDEO = Path(__file__).resolve().parents[1]
OUT = VIDEO / "out" / "final-20261118"
RAW = OUT / "raw"
AUDIO = OUT / "audio"
RENDER = OUT / "render"
STORY = json.loads((VIDEO / "production" / "storyboard.json").read_text(encoding="utf-8"))
FFMPEG = os.environ.get("FFMPEG_PATH", "ffmpeg")
FFPROBE = os.environ.get("FFPROBE_PATH", "ffprobe")
PAIRED = {"turn1": "turn1_result", "turn2": "turn2_result", "build": "build_result"}
STILLS = {"open", "architecture_a", "architecture_b", "end"}
FPS = 30
MASTER = OUT / "chuanzhibei-2026-final.mp4"

def run(args, capture=False):
    return subprocess.run([str(x) for x in args], cwd=OUT, check=True,
                          capture_output=capture, text=capture, encoding="utf-8" if capture else None)

def duration(file):
    report = run([FFPROBE, "-v", "error", "-show_entries", "format=duration",
                  "-of", "default=nk=1:nw=1", file], capture=True)
    return float(report.stdout.strip())

def msfmt(seconds, ass):
    scale = 100 if ass else 1000
    total = round(seconds * scale)
    h, rem = divmod(total, 3600 * scale)
    m, rem = divmod(rem, 60 * scale)
    s, frac = divmod(rem, scale)
    return f"{h}:{m:02d}:{s:02d}.{frac:02d}" if ass else f"{h:02d}:{m:02d}:{s:02d},{frac:03d}"

def wrap_caption(text):
    if len(text) <= 42:
        return text
    cuts = [m.end() for m in re.finditer("[，、；]", text) if 14 <= m.end() < len(text) - 7]
    idx = min(cuts, key=lambda i: abs(i - len(text)/2)) if cuts else len(text)//2
    return text[:idx] + r"\N" + text[idx:]

def create_narration():
    rate = 24000
    width = 2
    caption_rows = []
    offset = 0
    wavefile = OUT / "narration.wav"
    with wave.open(str(wavefile), "wb") as target:
        target.setparams((1, width, rate, 0, "NONE", ""))
        def silence(secs):
            target.writeframes(b"\0" * (int(round(max(secs, 0)*rate))*width))
        for beat in STORY:
            lines = []
            for i, text in enumerate(beat["lines"]):
                with wave.open(str(AUDIO / f"{beat['id']}-{i}.wav"), "rb") as src:
                    if (src.getnchannels(), src.getframerate(), src.getsampwidth()) != (1,rate,width):
                        raise ValueError(f"Unexpected WAV format for {beat['id']} line {i}")
                    lines.append((text, src.getnframes()/rate, src.readframes(src.getnframes())))
            spoken = sum(q[1] for q in lines)
            if spoken + .4 > beat["seconds"]:
                factor = (spoken+1.25) / beat["seconds"]
                revised = []
                for i,(text,_,_) in enumerate(lines):
                    path = OUT/"render"/f"{beat['id']}-{i}-paced.wav"
                    run([FFMPEG,"-y","-v","error","-i",AUDIO/f"{beat['id']}-{i}.wav","-af",f"atempo={factor:.6f}",path])
                    with wave.open(str(path),"rb") as src:
                        revised.append((text,src.getnframes()/rate,src.readframes(src.getnframes())))
                lines = revised
                spoken = sum(q[1] for q in lines)
            spread = beat["seconds"] - spoken
            lead = min(.6, spread * .18)
            gap = min(2.5, max(.12, (spread - lead - .65)/max(len(lines)-1,1)))
            if spread - lead < gap*(len(lines)-1):
                gap = max(0,(spread-lead)/max(len(lines)-1,1))
            seek = offset + lead
            silence(lead)
            for i, (text, sec, data) in enumerate(lines):
                target.writeframes(data)
                if i + 1 < len(lines):
                    silence(gap)
                caption_rows.append((seek, min(offset+beat["seconds"]-.05, seek+sec+.15), text))
                seek += sec + (gap if i + 1 < len(lines) else 0)
            offset += beat["seconds"]
            silence(offset - target.getnframes()/rate)
            print(f"{beat['id']:<18} {spoken:5.1f}s narration over {beat['seconds']}s",flush=True)
    return wavefile, caption_rows

ASS = """[Script Info]
ScriptType: v4.00+
PlayResX: 1920
PlayResY: 1080
WrapStyle: 2
ScaledBorderAndShadow: yes
[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Subtitle,Microsoft YaHei,34,&H00FFFFFF,&H000000FF,&H000D170E,&H330D170E,0,0,0,0,100,100,0,0,1,1,0,2,60,60,26,1
Style: Label,Microsoft YaHei,26,&H00FFFFFF,&H000000FF,&H002C3824,&H002C3824,0,0,0,0,100,100,0,0,3,9,0,7,40,40,36,1
[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
"""

def write_subtitles(rows):
    srt = []
    for index,(start,end,text) in enumerate(rows,1):
        srt.append(f"{index}\n{msfmt(start,False)} --> {msfmt(end,False)}\n{text}\n")
    (OUT / "chuanzhibei-2026-final.srt").write_text("\n".join(srt),encoding="utf-8-sig")

def picture_filter(start, file, length, section, zoom=None):
    if section in STILLS:
        return f"[{start}:v]fps=30,scale=1920:1080,setsar=1,format=yuv420p,trim=duration={length},setpts=PTS-STARTPTS"
    sec = duration(file)
    stretch = min(2.2, max(0.6, (length - .65) / sec))
    mode = "scale=1760:990"
    color = "0xf4f3eb"
    y = "0"
    if section == "phone":
        mode = "scale=-2:960"
    if zoom:
        mode = f"crop={zoom},scale=1760:990"
    return (f"[{start}:v]setpts={stretch:.7f}*PTS,fps=30,{mode},"
            f"pad=1920:1080:(ow-iw)/2:{y}:color={color},setsar=1,format=yuv420p,"
            f"tpad=stop_mode=clone:stop_duration={length},trim=duration={length},setpts=PTS-STARTPTS")

def segment(job):
    beat, offset, captions = job
    id = beat["id"]
    length = beat["seconds"]
    name = RENDER / (id+".mp4")
    args = [FFMPEG,"-y","-hide_banner","-loglevel","error","-filter_complex_threads","2"]
    inputs = []
    label = None
    if id in STILLS:
        args += ["-loop","1","-framerate","30","-i", RAW / (id+".png")]
        inputs.append((RAW/(id+".png"),length,None))
    else:
        original = RAW / (id+".webm")
        if id in PAIRED:
            old = min(7,length/2)
            after = RAW / (PAIRED[id]+".webm")
            if id == "build":
                inputs = [(original,old,None),(after,length-old-7,None),
                          (RAW/"build_result.png",7,"960:540:880:210")]
            else:
                inputs = [(original,old,None),(after,length-old,None)]
            label = (old, old+2.4, "已跳过模型等待")
        elif id == "tutor_source":
            # Start on the actual response before the original-source drawer opens.
            reveal = RAW / "tutor-answer.png"
            if reveal.exists():
                args += ["-loop","1","-framerate","30","-i",reveal]
                inputs.append((reveal,6,None))
                inputs.append((original,length-12,None))
                inputs.append((RAW/"tutor_source.png",6,"960:540:960:80"))
            else:
                inputs = [(original,length,None)]
            label = (0.15,2.4,"已跳过模型等待")
        elif id == "budget60":
            inputs = [(original,length-7,None),(RAW/"budget60.png",7,"800:450:1040:110")]
        elif id == "estimate":
            inputs = [(original,10,None),(RAW/"estimate.png",length-10,"960:540:200:60")]
        elif id == "save":
            inputs = [(original,length-6,None),(RAW/"save.png",6,"1200:674:105:365")]
        else:
            inputs = [(original,length,None)]
        for index,(file,_,_) in enumerate(inputs):
            if id == "tutor_source" and index == 0 and file.suffix==".png":
                continue
            if file.suffix == ".png":
                args += ["-loop","1","-framerate","30"]
            args += ["-i",file]
    filters = []
    for idx,(file,sec,zoom) in enumerate(inputs):
        if file.suffix==".png" and id not in STILLS:
            if zoom:
                f = f"[{idx}:v]crop={zoom},scale=1760:990"
            else:
                f = f"[{idx}:v]scale=1760:990"
            filters.append(f+" ,fps=30,pad=1920:1080:80:0:color=0xf4f3eb,setsar=1,format=yuv420p,trim=duration="+str(sec)+",setpts=PTS-STARTPTS"+f"[v{idx}]")
        else:
            filters.append(picture_filter(idx,file,sec,id,zoom)+f"[v{idx}]")
    if len(inputs) > 1:
        filters.append("".join(f"[v{j}]" for j in range(len(inputs)))+f"concat=n={len(inputs)}:v=1:a=0[all]")
        current = "all"
    else:
        current = "v0"
    ass = ASS
    for start,end,text in captions:
        if start >= offset and start < offset+length:
            ass += f"Dialogue: 0,{msfmt(start-offset,True)},{msfmt(end-offset,True)},Subtitle,,0,0,0,,{wrap_caption(text)}\n"
    if label:
        start,end,text=label
        ass += f"Dialogue: 1,{msfmt(start,True)},{msfmt(end,True)},Label,,0,0,0,,{text}\n"
    path = f"render/{id}.ass"
    (OUT / path).write_text(ass,encoding="utf-8-sig")
    filters.append(f"[{current}]drawbox=x=0:y=990:w=iw:h=90:color=0x192419:t=fill,ass={path}[out]")
    run([*args,"-filter_complex",";".join(filters),"-map","[out]","-an","-c:v","libx264",
         "-preset","fast","-crf","17","-pix_fmt","yuv420p","-threads","4","-t",str(length),name])
    print("已编码",id,flush=True)
    return name

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--mux-only", action="store_true", help="Reuse the encoded picture segments.")
    options = parser.parse_args()
    RENDER.mkdir(parents=True, exist_ok=True)
    answer = RAW / "tutor-answer.png"
    if not options.mux_only and not answer.exists():
        run([FFMPEG,"-y","-hide_banner","-loglevel","error","-ss","0.5",
             "-i",RAW/"tutor_source.webm","-frames:v","1",answer])
    narration, rows = create_narration()
    write_subtitles(rows)
    jobs = []
    offset = 0
    for beat in STORY:
        jobs.append((beat,offset,rows))
        offset += beat["seconds"]
    if options.mux_only:
        videos = [RENDER / (beat["id"] + ".mp4") for beat in STORY]
    else:
        with ThreadPoolExecutor(max_workers=2) as pool:
            videos = list(pool.map(segment,jobs))
    playlist = RENDER / "parts.txt"
    playlist.write_text("".join(f"file '{p.name}'\n" for p in videos),encoding="utf-8")
    run([FFMPEG,"-y","-hide_banner","-loglevel","error","-f","concat","-safe","0","-i",playlist.relative_to(OUT).as_posix(),
         "-i",narration,"-map","0:v","-map","1:a","-c:v","copy","-c:a","aac","-b:a","192k","-ar","48000",
         "-af","loudnorm=I=-16:LRA=11:TP=-1.5","-movflags","+faststart","-t",str(offset),MASTER])
    run([FFPROBE,"-v","error","-show_entries","format=duration,size:stream=codec_name,width,height,r_frame_rate,sample_rate",
         "-of","json",MASTER])
