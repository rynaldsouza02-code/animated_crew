"""Render the motion graphics over the cut footage and export the final video.

Usage:
  python render.py WORK                      # full render -> WORK/final.mp4
  python render.py WORK --stills auto        # contact sheet of graphics frames -> WORK/stills/contact.png
  python render.py WORK --stills 12.5,40,81  # stills at chosen times (edited-video seconds)
  python render.py WORK --check              # load the page, report errors, spans and duration, then exit

WORK is the project folder made by transcribe.py. It needs cut.mp4 (from cut.py), story.js and edit.json.
"""
import argparse
import asyncio
import base64
import json
import os
import shutil
import sys
import time
import wave

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import SKILL_DIR, build_page, die, load_state, need, out_height, pick_fps, probe, run, save_state, serve  # noqa: E402


def frame_ranges(spans, fps, total_frames, chunk=240):
    """Spans in seconds -> list of (first_frame, count), split into chunks for parallel workers."""
    out = []
    for a, b in spans:
        n0, n1 = max(0, int(round(a * fps))), min(total_frames, int(round(b * fps)))
        n = n0
        while n < n1:
            c = min(chunk, n1 - n)
            out.append((n, c))
            n += c
    return out


async def open_page(browser, base, scale, errors):
    ctx = await browser.new_context(viewport={"width": 1400, "height": 1000}, device_scale_factor=1)
    page = await ctx.new_page()
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.on("console", lambda m: errors.append("console: " + m.text) if m.type == "error" else None)
    await page.add_init_script(script=f"window.__RENDER = {{ scale: {scale} }};")
    await page.add_init_script(path=os.path.join(SKILL_DIR, "engine", "hidpi.js"))
    await page.goto(base + "/work/page.html")
    try:
        await page.wait_for_function("window.__ready === true", timeout=90000)
    except Exception:
        die("the page did not finish loading. Errors:\n" + "\n".join(errors[-10:]))
    if errors:
        die("story.js has errors:\n" + "\n".join(errors[-10:]))
    return page


async def decode_frames(cut, fps, n0, count, w, h):
    """Yield JPEG bytes for `count` frames of the cut footage starting at frame n0."""
    proc = await asyncio.create_subprocess_exec(
        "ffmpeg", "-v", "error", "-ss", f"{n0 / fps:.6f}", "-i", cut, "-frames:v", str(count),
        "-vf", f"scale={w}:{h}:flags=bicubic", "-f", "image2pipe", "-c:v", "mjpeg", "-q:v", "2", "-",
        stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.DEVNULL)
    buf = bytearray()
    got = 0
    while got < count:
        chunk = await proc.stdout.read(1 << 20)
        if not chunk:
            break
        buf += chunk
        while True:
            s = buf.find(b"\xff\xd8")
            e = buf.find(b"\xff\xd9", s + 2) if s >= 0 else -1
            if s < 0 or e < 0:
                break
            yield bytes(buf[s:e + 2])
            del buf[:e + 2]
            got += 1
    try:
        proc.kill()
    except ProcessLookupError:
        pass
    await proc.wait()


async def render_chunk(page, cut, fps, n0, count, w, h, out, crf, preset, quality):
    enc = await asyncio.create_subprocess_exec(
        "ffmpeg", "-v", "error", "-y", "-f", "image2pipe", "-framerate", str(fps), "-c:v", "mjpeg", "-i", "-",
        "-c:v", "libx264", "-preset", preset, "-crf", str(crf), "-pix_fmt", "yuv420p", "-r", str(fps), out,
        stdin=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE)
    i = 0
    last = None
    async for jpg in decode_frames(cut, fps, n0, count, w, h):
        t = (n0 + i) / fps
        res = await page.evaluate("([t, b, q]) => window.__renderFrame(t, b, q)", [t, base64.b64encode(jpg).decode(), quality])
        last = base64.b64decode(res)
        enc.stdin.write(last)
        await enc.stdin.drain()
        i += 1
    while i < count and last:  # footage ended early: hold the last frame
        enc.stdin.write(last)
        i += 1
    enc.stdin.close()
    err = await enc.stderr.read()
    if await enc.wait() != 0:
        die("encoding a graphics chunk failed:\n" + err.decode()[-1500:])
    return i


async def render_sfx(page, path):
    info = await page.evaluate("window.__renderSfx(48000)")
    total, off, step = info["bytes"], 0, 3 << 20
    with wave.open(path, "wb") as wv:
        wv.setnchannels(2)
        wv.setsampwidth(2)
        wv.setframerate(48000)
        while off < total:
            b = await page.evaluate("([o, l]) => window.__sfxChunk(o, l)", [off, step])
            wv.writeframes(base64.b64decode(b))
            off += step
    return info


async def stills(page, cut, times, w, h, work):
    from PIL import Image, ImageDraw
    os.makedirs(os.path.join(work, "stills"), exist_ok=True)
    paths = []
    for t in times:
        p = run(["ffmpeg", "-v", "error", "-ss", f"{t:.3f}", "-i", cut, "-frames:v", "1", "-vf", f"scale={w}:{h}", "-f", "image2pipe", "-c:v", "mjpeg", "-q:v", "2", "-"])
        b64 = base64.b64encode(p.stdout).decode() if p.stdout else None
        png = base64.b64decode(await page.evaluate("([t, b]) => window.__renderStill(t, b)", [t, b64]))
        path = os.path.join(work, "stills", f"still_{t:08.2f}.png")
        open(path, "wb").write(png)
        paths.append((t, path))
    cols = 3 if len(paths) > 4 else 2 if len(paths) > 1 else 1
    tw, th = 640, 360
    rows = (len(paths) + cols - 1) // cols
    sheet = Image.new("RGB", (cols * tw + (cols + 1) * 12, rows * (th + 34) + 12), (18, 18, 20))
    d = ImageDraw.Draw(sheet)
    for i, (t, p) in enumerate(paths):
        im = Image.open(p).convert("RGB").resize((tw, th), Image.LANCZOS)
        x, y = 12 + (i % cols) * (tw + 12), 12 + (i // cols) * (th + 34)
        sheet.paste(im, (x, y))
        d.text((x, y + th + 6), f"t = {int(t // 60)}:{t % 60:05.2f}", fill=(220, 220, 220))
    out = os.path.join(work, "stills", "contact.png")
    sheet.save(out)
    return out, [p for _, p in paths]


def final_mix(work, cut, sfx, chunks, out, crf, preset, captions, sfx_gain, has_audio, normalize=True):
    """Overlay graphics chunks on the cut footage, burn captions, mix voice + effects."""
    voice = os.path.join(work, "cut.wav") if os.path.exists(os.path.join(work, "cut.wav")) else cut
    cmd = ["ffmpeg", "-v", "error", "-y", "-i", cut, "-i", voice, "-i", sfx]
    for _, path in chunks:
        cmd += ["-i", path]
    lines = ["[0:v]ass=captions.ass:fontsdir=.fonts:shaping=complex[b0];" if captions else "[0:v]null[b0];"]
    for k, (start, _) in enumerate(chunks):
        lines.append(f"[{3 + k}:v]setpts=PTS-STARTPTS+{start:.6f}/TB[g{k}];")
        lines.append(f"[b{k}][g{k}]overlay=eof_action=pass:repeatlast=0[b{k + 1}];")
    lines.append(f"[b{len(chunks)}]format=yuv420p[v];")
    fx = f"[2:a]volume={sfx_gain}[fx]"
    if has_audio:
        lines.append(f"[1:a]aresample=48000,aformat=channel_layouts=stereo[va];{fx};[va][fx]amix=inputs=2:normalize=0:duration=first," + ("loudnorm=I=-14:TP=-1.5:LRA=11,aresample=48000," if normalize else "") + "alimiter=limit=0.97:level=false[a]")
    else:
        lines.append(fx.replace("[fx]", "[a]"))
    open(os.path.join(work, ".final_filter.txt"), "w").write("\n".join(lines))
    cmd += ["-filter_complex_script", ".final_filter.txt", "-map", "[v]", "-map", "[a]", "-c:a", "aac", "-b:a", "192k",
            "-c:v", "libx264", "-preset", preset, "-crf", str(crf), "-movflags", "+faststart", out]
    run(cmd, cwd=work)


async def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("work")
    ap.add_argument("--stills", help="'auto' or comma-separated times in seconds")
    ap.add_argument("--check", action="store_true", help="only load the page and report")
    ap.add_argument("--height", type=int, help="output height: 720, 1080 (default for HD sources), 1440 or 2160")
    ap.add_argument("--workers", type=int, default=0, help="parallel browser pages (default: half your CPU cores, max 4)")
    ap.add_argument("--crf", type=int, default=18)
    ap.add_argument("--preset", default="veryfast", help="x264 preset; use 'slow' for the best quality")
    ap.add_argument("--sfx-gain", type=float, default=1.0, help="effects level under the voice (1.0 = as designed)")
    ap.add_argument("--no-captions", action="store_true")
    ap.add_argument("--no-normalize", action="store_true", help="keep the original loudness (default: normalize to -14 LUFS for YouTube)")
    ap.add_argument("--out", default="final.mp4")
    a = ap.parse_args()
    work = os.path.abspath(a.work)
    need("ffmpeg")
    st = load_state(work)
    if not st.get("style"):
        die("no style chosen. Run: python cut.py WORK --style <id> (or set it with: python story_tools.py WORK --style <id>)")
    cut = os.path.join(work, "cut.mp4")
    if not os.path.exists(cut):
        die("cut.mp4 not found. Run cut.py first.")
    if not os.path.exists(os.path.join(work, "story.js")):
        die("story.js not found. Write the graphics story first (see SKILL.md, step 5).")
    info = probe(cut)
    fps = st.get("fps") or pick_fps(info["fps"])
    H = out_height(info["height"], a.height or st.get("height"))
    W = int(round(H * 16 / 9 / 2) * 2)
    scale = H / 720
    build_page(work, st["style"])
    srv, base = serve(work)
    from playwright.async_api import async_playwright
    errors = []
    t0 = time.time()
    async with async_playwright() as p:
        browser = await p.chromium.launch(args=["--force-color-profile=srgb", "--disable-background-timer-throttling", "--disable-renderer-backgrounding"])
        page = await open_page(browser, base, scale, errors)
        D = await page.evaluate("window.DURATION")
        spans = await page.evaluate("window.SPANS")
        if abs(D - info["duration"]) > 0.6:
            print(f"warning: EDIT.D is {D:.2f}s but cut.mp4 is {info['duration']:.2f}s. Set EDIT.D to the cut length.")
        if a.check:
            print(json.dumps({"ok": True, "duration": D, "spans": spans, "graphics_seconds": round(sum(b - a for a, b in spans), 2), "output": f"{W}x{H} @ {fps}fps"}, indent=1))
            return
        if a.stills:
            times = []
            if a.stills == "auto":
                for s0, s1 in spans:
                    L = s1 - s0
                    times += [s0 + min(0.6, L * 0.3), s0 + L * 0.55, s1 - min(0.35, L * 0.1)]
            else:
                times = [float(x) for x in a.stills.split(",") if x.strip()]
            sheet, files = await stills(page, cut, times, W, H, work)
            print(json.dumps({"contact_sheet": sheet, "stills": files}, indent=1))
            return
        total = int(round(info["duration"] * fps))
        ranges = frame_ranges(spans, fps, total)
        nframes = sum(c for _, c in ranges)
        workers = a.workers or max(1, min(4, (os.cpu_count() or 2) // 2))
        pages = [page] + [await open_page(browser, base, scale, errors) for _ in range(min(workers, max(1, len(ranges))) - 1)]
        tmp = os.path.join(work, ".chunks")
        shutil.rmtree(tmp, ignore_errors=True)
        os.makedirs(tmp)
        print(f"rendering {nframes} graphics frames ({nframes / fps:.1f}s of {D:.1f}s) at {W}x{H}, {fps}fps, {len(pages)} worker(s)")
        queue = list(enumerate(ranges))
        done = [0]
        chunks = []

        async def worker(pg):
            while queue:
                k, (n0, c) = queue.pop(0)
                path = os.path.join(tmp, f"g{k:05d}.mp4")
                await render_chunk(pg, cut, fps, n0, c, W, H, path, max(10, a.crf - 2), a.preset, 0.93)
                chunks.append((n0 / fps, path))
                done[0] += c
                el = time.time() - t0
                print(f"  {done[0]}/{nframes} frames  ({done[0] / max(el, 1e-6):.1f} fps)", flush=True)

        await asyncio.gather(*(worker(pg) for pg in pages))
        chunks.sort()
        sfx = os.path.join(work, "sfx.wav")
        print("rendering sound effects...")
        sinfo = await render_sfx(page, sfx)
        await browser.close()
    srv.shutdown()
    caps = bool((not a.no_captions) and st.get("captions"))
    if caps:
        from captions import build as build_captions
        build_captions(work, spans, st["style"], W, H)
        dst = os.path.join(work, ".fonts")
        shutil.rmtree(dst, ignore_errors=True)
        shutil.copytree(os.path.join(SKILL_DIR, "assets", "fonts", "ttf"), dst)
    print("mixing and encoding the final video...")
    out = os.path.join(work, a.out)
    final_mix(work, cut, sfx, chunks, out, a.crf, a.preset, caps, a.sfx_gain, info["has_audio"], not a.no_normalize)
    shutil.rmtree(os.path.join(work, ".chunks"), ignore_errors=True)
    save_state(work, rendered=out)
    print(json.dumps({"output": out, "seconds": round(time.time() - t0, 1), "sfx_peak": round(sinfo["peak"], 3)}, indent=1))


if __name__ == "__main__":
    asyncio.run(main())
