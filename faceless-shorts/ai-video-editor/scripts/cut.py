"""Cut silences and mistakes out of the video, frame-accurately and without audio clicks.

Usage:
  python cut.py WORK --dry-run            # plan only: writes cut_plan.json and prints a summary
  python cut.py WORK                      # plan and render cut.mp4 + transcript_edited.*
Options:
  --silence / --no-silence   remove long pauses (default: on)
  --pause 0.3                seconds of pause to leave where a long pause was removed
  --min-gap 0.6              pauses shorter than this are left alone
  --edits edits.json         mistakes to remove (default: WORK/edits.json if it exists)
  --style ID --captions yes|no --height 1080   saved to edit.json for the render step

edits.json (written by the agent after reading transcript.txt):
  { "remove": [ {"from": 12, "to": 30, "why": "retake of the intro"}, ... ],   # word indices, inclusive
    "remove_times": [ [61.2, 64.0] ] }                                        # optional raw ranges in seconds
When a word range is removed, the cut runs from just after the previous kept word to just before the next one,
so the joins sound natural.
"""
import argparse
import json
import os
import subprocess
import sys

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import die, load_state, need, out_height, pick_fps, probe, run, save_state, style_meta  # noqa: E402
from transcribe import write_txt  # noqa: E402

SR = 48000


def load_audio(src):
    p = subprocess.run(["ffmpeg", "-v", "error", "-i", src, "-vn", "-ac", "2", "-ar", str(SR), "-f", "f32le", "-"], stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    if p.returncode != 0:
        die("could not read the audio: " + p.stderr.decode()[-500:])
    return np.frombuffer(p.stdout, dtype=np.float32).reshape(-1, 2)


def silent_runs(audio, min_gap):
    """Energy-based pause finder. Returns [(start, end)] in seconds of quiet stretches >= min_gap."""
    hop = SR // 100  # 10 ms
    mono = audio.mean(axis=1)
    n = len(mono) // hop
    if n == 0:
        return [], None
    fr = mono[: n * hop].reshape(n, hop)
    db = 20 * np.log10(np.sqrt((fr ** 2).mean(axis=1)) + 1e-9)
    floor, loud = np.percentile(db, 10), np.percentile(db, 95)
    thr = max(floor + 6, floor + 0.28 * (loud - floor))
    speech = db > thr
    # hold speech for 60 ms around every loud frame so soft word endings survive
    k = 6
    held = np.convolve(speech.astype(np.int32), np.ones(2 * k + 1, dtype=np.int32), mode="same") > 0
    runs, i = [], 0
    while i < n:
        if not held[i]:
            j = i
            while j < n and not held[j]:
                j += 1
            if (j - i) / 100 >= min_gap:
                runs.append((i / 100, j / 100))
            i = j
        else:
            i += 1
    return runs, {"floor_db": round(float(floor), 1), "speech_db": round(float(loud), 1), "threshold_db": round(float(thr), 1)}


def merge(ranges):
    out = []
    for a, b in sorted(ranges):
        if out and a <= out[-1][1] + 1e-6:
            out[-1][1] = max(out[-1][1], b)
        else:
            out.append([a, b])
    return out


def plan(words, duration, audio, opt, edits):
    pad = opt.pause / 2
    removed = []  # [start, end, reason, text]
    gone = set()
    for r in edits.get("remove", []):
        a, b = int(r["from"]), int(r["to"])
        if a > b:
            a, b = b, a
        a, b = max(0, a), min(len(words) - 1, b)
        prev = words[a - 1] if a > 0 else None
        nxt = words[b + 1] if b + 1 < len(words) else None
        s = prev["e"] + min(pad, max(0.04, (words[a]["s"] - prev["e"]) / 2)) if prev else 0.0
        e = nxt["s"] - min(pad, max(0.04, (nxt["s"] - words[b]["e"]) / 2)) if nxt else duration
        if e <= s:
            s, e = words[a]["s"], words[b]["e"]
        removed.append([s, e, r.get("why", "mistake"), " ".join(w["w"] for w in words[a:b + 1])])
        gone.update(range(a, b + 1))
    for s, e in edits.get("remove_times", []):
        removed.append([float(s), float(e), "manual", ""])
    stats = None
    if opt.silence:
        runs, stats = silent_runs(audio, opt.min_gap)
        kept = [w for w in words if w["i"] not in gone]
        for s, e in runs:
            cs, ce = (0.0 if s <= 0.01 else s + pad), (duration if e >= duration - 0.02 else e - pad)
            if ce - cs < 0.08:
                continue
            # never cut through a word Whisper heard (quiet words can sit under the energy threshold)
            inside = [w for w in kept if w["e"] > cs + 0.03 and w["s"] < ce - 0.03]
            if inside:
                # cut only the part before/after those words, if long enough
                pieces, cur = [], cs
                for w in inside:
                    if w["s"] - 0.05 - cur >= opt.min_gap:
                        pieces.append((cur, w["s"] - 0.05))
                    cur = max(cur, w["e"] + 0.05)
                if ce - cur >= opt.min_gap:
                    pieces.append((cur, ce))
                for a, b in pieces:
                    removed.append([a, b, "pause", ""])
                continue
            removed.append([cs, ce, "pause", ""])
    cuts = merge([[max(0.0, s), min(duration, e)] for s, e, *_ in removed if e - s > 0.02])
    keep, cur = [], 0.0
    for s, e in cuts:
        if s > cur:
            keep.append([cur, s])
        cur = max(cur, e)
    if cur < duration:
        keep.append([cur, duration])
    return keep, sorted(removed), stats


def snap(keep, fps, duration):
    total = int(round(duration * fps))
    out = []
    for s, e in keep:
        a, b = int(round(s * fps)), min(total, int(round(e * fps)))
        if b - a >= 2:
            if out and a <= out[-1][1]:
                out[-1][1] = max(out[-1][1], b)
            else:
                out.append([a, b])
    return out  # frame ranges [a, b)


def remap_words(words, gone, frames, fps):
    out, t_out = [], 0.0
    segs = []
    for a, b in frames:
        s, e = a / fps, b / fps
        segs.append((s, e, t_out))
        t_out += e - s
    for w in words:
        if w["i"] in gone:
            continue
        mid = (w["s"] + w["e"]) / 2
        for s, e, o in segs:
            if s <= mid < e:
                ns, ne = o + max(0.0, w["s"] - s), o + min(e - s, w["e"] - s)
                out.append({"i": len(out), "w": w["w"], "s": round(ns, 3), "e": round(max(ne, ns + 0.02), 3), "p": w.get("p", 1), "src": w["i"]})
                break
    return out, t_out


def render_cut(src, work, frames, fps, W, H, audio):
    # video: constant frame rate, then keep only the planned frame ranges
    expr = "+".join(f"between(n,{a},{b - 1})" for a, b in frames)
    vf = f"[0:v]fps={fps},scale={W}:{H}:force_original_aspect_ratio=increase:flags=bicubic,crop={W}:{H},setsar=1,select='{expr}',setpts=N/({fps}*TB)[v]"
    open(os.path.join(work, ".cut_filter.txt"), "w").write(vf)
    # audio: slice by the same frame grid, 6 ms fades at every join so there are no clicks
    parts, f = [], int(SR * 0.006)
    ramp = np.linspace(0, 1, f, dtype=np.float32)[:, None]
    for a, b in frames:
        s0, s1 = int(round(a / fps * SR)), int(round(b / fps * SR))
        seg = audio[s0:s1].copy()
        if len(seg) < s1 - s0:
            seg = np.vstack([seg, np.zeros((s1 - s0 - len(seg), 2), np.float32)])
        if len(seg) > 2 * f:
            seg[:f] *= ramp
            seg[-f:] *= ramp[::-1]
        parts.append(seg)
    pcm = np.clip(np.vstack(parts), -1, 1)
    wav = os.path.join(work, "cut.wav")
    import wave
    with wave.open(wav, "wb") as wv:
        wv.setnchannels(2)
        wv.setsampwidth(2)
        wv.setframerate(SR)
        wv.writeframes((pcm * 32767).astype("<i2").tobytes())
    run(["ffmpeg", "-v", "error", "-y", "-i", src, "-i", wav, "-filter_complex_script", ".cut_filter.txt", "-map", "[v]", "-map", "1:a",
         "-c:v", "libx264", "-preset", "veryfast", "-crf", "16", "-pix_fmt", "yuv420p", "-r", str(fps),
         "-c:a", "aac", "-b:a", "256k", "-movflags", "+faststart", "cut.mp4"], cwd=work)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("work")
    ap.add_argument("--silence", dest="silence", action="store_true", default=True)
    ap.add_argument("--no-silence", dest="silence", action="store_false")
    ap.add_argument("--pause", type=float, default=0.3)
    ap.add_argument("--min-gap", type=float, default=0.6)
    ap.add_argument("--edits")
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--style")
    ap.add_argument("--captions", choices=["yes", "no"])
    ap.add_argument("--height", type=int)
    a = ap.parse_args()
    need("ffmpeg")
    work = os.path.abspath(a.work)
    st = load_state(work)
    tr_path = os.path.join(work, "transcript.json")
    if not os.path.exists(tr_path):
        die("transcript.json not found. Run transcribe.py first.")
    tr = json.load(open(tr_path, encoding="utf-8"))
    src = st.get("source") or tr["source"]
    info = probe(src)
    if a.style:
        style_meta(a.style)
    ed_path = a.edits or os.path.join(work, "edits.json")
    edits = json.load(open(ed_path, encoding="utf-8")) if os.path.exists(ed_path) else {}
    audio = load_audio(src)
    duration = min(info["duration"], len(audio) / SR) if len(audio) else info["duration"]
    words = tr["words"]
    keep, removed, stats = plan(words, duration, audio, a, edits)
    fps = pick_fps(info["fps"])
    frames = snap(keep, fps, duration)
    if not frames:
        die("the plan removes the whole video. Check edits.json.")
    new_len = sum(b - a_ for a_, b in frames) / fps
    gone = set()
    for r in edits.get("remove", []):
        lo, hi = sorted((int(r["from"]), int(r["to"])))
        gone.update(range(lo, hi + 1))
    by = {}
    for s, e, why, _ in removed:
        by[why if why in ("pause", "manual") else "mistakes"] = by.get(why if why in ("pause", "manual") else "mistakes", 0) + (e - s)
    summary = {"original_seconds": round(duration, 2), "edited_seconds": round(new_len, 2), "removed_seconds": round(duration - new_len, 2),
               "removed_by_reason": {k: round(v, 2) for k, v in by.items()}, "pieces_kept": len(frames), "fps": fps, "audio_levels": stats,
               "mistake_cuts": [{"from_s": round(s, 2), "to_s": round(e, 2), "why": why, "text": txt} for s, e, why, txt in removed if why not in ("pause",)]}
    json.dump({"summary": summary, "keep_frames": frames, "removed": removed}, open(os.path.join(work, "cut_plan.json"), "w", encoding="utf-8"), indent=1, ensure_ascii=False)
    kv = {"fps": fps, "silence_cut": a.silence}
    if a.style:
        kv["style"] = a.style
    if a.captions:
        kv["captions"] = a.captions == "yes"
    if a.height:
        kv["height"] = a.height
    st = save_state(work, **kv)
    if a.dry_run:
        print(json.dumps(summary, indent=1, ensure_ascii=False))
        return
    H = out_height(info["height"], st.get("height"))
    W = int(round(H * 16 / 9 / 2) * 2)
    if info["width"] / max(1, info["height"]) < 1.6:
        print("note: this video is not 16:9, so it is center-cropped to 16:9 (vertical video support is planned).")
    print(f"rendering cut.mp4: {duration:.1f}s -> {new_len:.1f}s, {W}x{H} @ {fps}fps", flush=True)
    render_cut(src, work, frames, fps, W, H, audio)
    ew, elen = remap_words(words, gone, frames, fps)
    json.dump({"language": tr.get("language"), "duration": round(elen, 3), "words": ew}, open(os.path.join(work, "transcript_edited.json"), "w", encoding="utf-8"), ensure_ascii=False, indent=0)
    write_txt(os.path.join(work, "transcript_edited.txt"), ew, elen, "Transcript of the EDITED video (cut.mp4). Time your graphics to these times.", note="wN = word index in transcript_edited.json.")
    save_state(work, cut_seconds=round(elen, 3), width=W, height=H)
    summary["outputs"] = [os.path.join(work, "cut.mp4"), os.path.join(work, "transcript_edited.txt")]
    print(json.dumps(summary, indent=1, ensure_ascii=False))


if __name__ == "__main__":
    main()
