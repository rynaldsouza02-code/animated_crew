"""Shared helpers for the ai-video-editor scripts (paths, ffmpeg, project state, local web server)."""
import json
import os
import shutil
import subprocess
import sys
import threading
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

# Windows consoles often default to a legacy code page: keep Hindi text from crashing prints
for _s in (sys.stdout, sys.stderr):
    try:
        _s.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

SKILL_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
STYLES_DIR = os.path.join(SKILL_DIR, "styles")


def die(msg, code=1):
    print("ERROR: " + msg, file=sys.stderr)
    sys.exit(code)


def need(tool):
    path = shutil.which(tool)
    if not path:
        die(f"'{tool}' was not found. Run: python scripts/setup.py")
    return path


def run(cmd, quiet=True, **kw):
    """Run a command, raising with its stderr on failure."""
    p = subprocess.run(cmd, stdout=subprocess.PIPE if quiet else None, stderr=subprocess.PIPE, **kw)
    if p.returncode != 0:
        err = p.stderr.decode("utf-8", "replace")[-3000:] if p.stderr else ""
        die(f"command failed: {' '.join(map(str, cmd[:6]))} ...\n{err}")
    return p


def probe(path):
    """Basic facts about a video: duration, fps, size, audio."""
    need("ffprobe")
    p = run(["ffprobe", "-v", "error", "-print_format", "json", "-show_streams", "-show_format", path])
    info = json.loads(p.stdout)
    v = next((s for s in info["streams"] if s["codec_type"] == "video"), None)
    a = next((s for s in info["streams"] if s["codec_type"] == "audio"), None)
    if v is None:
        die(f"no video stream in {path}")

    def rate(r):
        try:
            n, d = r.split("/")
            return float(n) / float(d) if float(d) else 0.0
        except Exception:
            return 0.0

    w, h = int(v["width"]), int(v["height"])
    rot = 0
    for sd in v.get("side_data_list", []) or []:
        if "rotation" in sd:
            rot = int(sd["rotation"])
    if (v.get("tags") or {}).get("rotate"):
        rot = int(v["tags"]["rotate"])
    if abs(rot) in (90, 270):
        w, h = h, w
    fps = rate(v.get("avg_frame_rate", "0/0")) or rate(v.get("r_frame_rate", "0/0")) or 30.0
    dur = float(info["format"].get("duration") or v.get("duration") or 0)
    return {"width": w, "height": h, "fps": fps, "duration": dur, "has_audio": a is not None,
            "audio_rate": int(a.get("sample_rate", 48000)) if a else 48000}


def pick_fps(fps):
    """Snap a (possibly variable) frame rate to a standard constant one."""
    for std in (23.976, 24, 25, 29.97, 30, 50, 59.94, 60):
        if abs(fps - std) < 0.6:
            return 30 if std == 29.97 else 60 if std == 59.94 else 24 if std == 23.976 else std
    return 60 if fps > 45 else 30


def out_height(src_h, want=None):
    if want:
        return int(want)
    for h in (2160, 1440, 1080):
        if src_h >= h:
            return min(h, 1080)  # default to 1080p; pass --height 2160 for 4K
    return 720


def load_state(work):
    p = os.path.join(work, "edit.json")
    return json.load(open(p, encoding="utf-8")) if os.path.exists(p) else {}


def save_state(work, **kv):
    st = load_state(work)
    st.update(kv)
    json.dump(st, open(os.path.join(work, "edit.json"), "w", encoding="utf-8"), indent=1, ensure_ascii=False)
    return st


def styles():
    return json.load(open(os.path.join(STYLES_DIR, "index.json"), encoding="utf-8"))


def style_meta(sid):
    p = os.path.join(STYLES_DIR, sid, "style.json")
    if not os.path.exists(p):
        die(f"unknown style '{sid}'. Choose one of: " + ", ".join(s["id"] for s in styles()))
    return json.load(open(p, encoding="utf-8"))


def build_page(work, style_id, story="story.js", out="page.html", skill_url="/skill", footage="cut.mp4"):
    """Write the preview/render page for this project."""
    meta = style_meta(style_id)
    tpl = open(os.path.join(SKILL_DIR, "engine", "page.html"), encoding="utf-8").read()
    html = (tpl.replace("{{TITLE}}", f"{meta['title']} edit")
               .replace("{{SKILL}}", skill_url)
               .replace("{{STYLE}}", style_id)
               .replace("{{STORY}}", story)
               .replace("{{FONTS}}", json.dumps(meta["fonts"]))
               .replace("{{FOOTAGE}}", json.dumps(footage)))
    open(os.path.join(work, out), "w", encoding="utf-8").write(html)
    return os.path.join(work, out)


class _Handler(SimpleHTTPRequestHandler):
    roots = {}

    def translate_path(self, path):
        path = path.split("?", 1)[0].split("#", 1)[0]
        for prefix, root in self.roots.items():
            if path.startswith(prefix + "/"):
                rel = path[len(prefix) + 1:]
                from urllib.parse import unquote
                full = os.path.normpath(os.path.join(root, unquote(rel)))
                if os.path.commonpath([full, root]) == root:
                    return full
        return os.path.join(self.roots.get("/work", "."), "__nope__")

    def send_head(self):
        # byte ranges, so the preview's <video> can seek
        rng = self.headers.get("Range")
        path = self.translate_path(self.path)
        if not rng or not os.path.isfile(path):
            return super().send_head()
        try:
            size = os.path.getsize(path)
            a, b = rng.replace("bytes=", "").split("-")[:2]
            start = int(a) if a else max(0, size - int(b))
            end = min(int(b), size - 1) if (a and b) else size - 1
            f = open(path, "rb")
            f.seek(start)
            self.send_response(206)
            self.send_header("Content-Type", self.guess_type(path))
            self.send_header("Content-Range", f"bytes {start}-{end}/{size}")
            self.send_header("Content-Length", str(end - start + 1))
            self.send_header("Accept-Ranges", "bytes")
            self.end_headers()
            self._remaining = end - start + 1
            return f
        except Exception:
            return super().send_head()

    def copyfile(self, source, outputfile):
        n = getattr(self, "_remaining", None)
        if n is None:
            return super().copyfile(source, outputfile)
        self._remaining = None
        while n > 0:
            buf = source.read(min(65536, n))
            if not buf:
                break
            try:
                outputfile.write(buf)
            except (BrokenPipeError, ConnectionResetError):
                break
            n -= len(buf)

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        self.send_header("Accept-Ranges", "bytes")
        self.send_header("Access-Control-Allow-Origin", "*")
        super().end_headers()

    def log_message(self, *a):
        pass


def serve(work, port=0):
    """Serve /work (the project folder) and /skill (this skill) on localhost. Returns (server, base_url)."""
    handler = type("H", (_Handler,), {"roots": {"/work": os.path.abspath(work), "/skill": SKILL_DIR}})
    handler.extensions_map = dict(SimpleHTTPRequestHandler.extensions_map, **{".js": "text/javascript", ".mp4": "video/mp4", ".woff2": "font/woff2"})
    srv = ThreadingHTTPServer(("127.0.0.1", port), handler)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return srv, f"http://127.0.0.1:{srv.server_address[1]}"
