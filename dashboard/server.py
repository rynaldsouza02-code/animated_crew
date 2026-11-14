import html as html_lib
import ipaddress
import json
import os
import random
import re
import socket
import ssl
import struct
import subprocess
import sys
import threading
import time
import uuid
import wave
from concurrent.futures import ThreadPoolExecutor, TimeoutError as FuturesTimeoutError, as_completed
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple
from zoneinfo import ZoneInfo

import requests
import urllib3.util.connection as _urllib3_conn
from requests.adapters import HTTPAdapter
from urllib3.connection import HTTPSConnection
from urllib3.connectionpool import HTTPSConnectionPool
from urllib3.exceptions import ConnectTimeoutError, NameResolutionError, NewConnectionError
from urllib3.poolmanager import PoolManager
from urllib3.util.retry import Retry
from fastapi import Body, FastAPI, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse, Response
from fastapi.staticfiles import StaticFiles

# Prefer IPv4 on Windows/local networks where IPv6 SSL handshakes to YouTube stall or EOF
if os.name == "nt":
    _urllib3_conn.allowed_gai_family = lambda: socket.AF_INET

# Paths & Runtime Mode (Local Windows Workstation vs Vercel Serverless Cloud Monitor)
BASE_DIR = Path(__file__).resolve().parent
STATIC_DIR = BASE_DIR / "static"
LOCAL_PROJECTS_ROOT = Path(r"C:\Users\DELL\faceless-shorts")
D_PROJECTS_ROOT = Path(r"D:\faceless-shorts")
CLOUD_DATA_DIR = BASE_DIR / "cloud_data"
IS_VERCEL = bool(os.environ.get("VERCEL") or os.environ.get("VERCEL_ENV"))
CLOUD_MODE = IS_VERCEL or (not LOCAL_PROJECTS_ROOT.exists() and not D_PROJECTS_ROOT.exists())
PROJECTS_ROOT = CLOUD_DATA_DIR if CLOUD_MODE else (D_PROJECTS_ROOT if D_PROJECTS_ROOT.exists() else LOCAL_PROJECTS_ROOT)

LOCAL_LONGFORM_ROOT = Path(r"D:\faceless-longform")
CLOUD_LONGFORM_DIR = CLOUD_DATA_DIR / "longform"
CLOUD_LONGFORM_JSON = CLOUD_DATA_DIR / "longform.json"
LONGFORM_ROOT = LOCAL_LONGFORM_ROOT if LOCAL_LONGFORM_ROOT.exists() else CLOUD_LONGFORM_DIR
LONGFORM_QUEUE_PATH = LONGFORM_ROOT / "queue" / "queue.json"


def is_longform_project(slug: Optional[str]) -> bool:
    if not slug:
        return False
    clean_s = str(slug).strip()
    for r in (LOCAL_LONGFORM_ROOT, CLOUD_LONGFORM_DIR):
        if r.exists() and (r / clean_s).is_dir():
            return True
    if LONGFORM_QUEUE_PATH.exists():
        try:
            q_data = _read_json(LONGFORM_QUEUE_PATH, {})
            if any(item.get("slug") == clean_s for item in q_data.get("queue", [])):
                return True
        except Exception:
            pass
    return False


def find_project_dir(slug: str) -> Optional[Path]:
    for r in (D_PROJECTS_ROOT, LOCAL_PROJECTS_ROOT, LOCAL_LONGFORM_ROOT, CLOUD_DATA_DIR, CLOUD_LONGFORM_DIR):
        if r.exists():
            p = (r / slug).resolve()
            if p.is_dir():
                return p
    return None


def find_project_mp4(slug: str, rel_video: Optional[str] = None) -> Optional[Path]:
    candidates = []
    for r in (D_PROJECTS_ROOT, LOCAL_PROJECTS_ROOT, LOCAL_LONGFORM_ROOT, CLOUD_DATA_DIR, CLOUD_LONGFORM_DIR):
        if r.exists():
            p = (r / slug).resolve()
            if p.is_dir():
                candidates.append(p)

    if rel_video:
        rel_p = Path(rel_video)
        if rel_p.is_absolute() and rel_p.exists() and rel_p.stat().st_size > 50_000:
            return rel_p
        for p in candidates:
            cand = p / rel_video
            if cand.exists() and cand.stat().st_size > 50_000:
                return cand

    # Check longform queue.json for declared mp4_file
    if LONGFORM_QUEUE_PATH.exists():
        try:
            q_data = _read_json(LONGFORM_QUEUE_PATH, {})
            for item in q_data.get("queue", []):
                if item.get("slug") == slug and item.get("mp4_file"):
                    cand = Path(item["mp4_file"])
                    if cand.exists() and cand.stat().st_size > 50_000:
                        return cand
        except Exception:
            pass

    for p in candidates:
        rdir = p / "renders"
        if rdir.exists():
            renders = sorted(rdir.glob("*.mp4"), key=lambda x: x.stat().st_mtime, reverse=True)
            for cand in renders:
                if cand.exists() and cand.stat().st_size > 50_000:
                    return cand
    return None

SKILL_ROOT = Path(r"C:\Users\DELL\OneDrive\Desktop\faceless\faceless-shorts")

def resolve_helper_script(name: str) -> Path:
    for base in (D_PROJECTS_ROOT, LOCAL_PROJECTS_ROOT, BASE_DIR, SKILL_ROOT):
        cand = base / name
        if cand.exists():
            return cand
    return LOCAL_PROJECTS_ROOT / name

RUNS_JSON_PATH = PROJECTS_ROOT / "runs.json"
MONETIZATION_JSON_PATH = PROJECTS_ROOT / "monetization.json"
STUDIO_ANALYTICS_PATH = PROJECTS_ROOT / "studio_analytics.json"
STUDIO_CONFIG_PATH = LOCAL_PROJECTS_ROOT / "studio_config.json"
STUDIO_SYNC_JOB_PATH = PROJECTS_ROOT / "studio_sync_job.json"
YT_LIVE_CACHE_PATH = LOCAL_PROJECTS_ROOT / "yt_live_cache.json"
UPLOAD_JOB_PATH = PROJECTS_ROOT / "upload_job.json"
MANUAL_UPLOADS_DIR = PROJECTS_ROOT / "manual-uploads"
UPLOAD_MEDIA_PY = resolve_helper_script("upload_media.py")
FINALIZE_UPLOAD_PY = resolve_helper_script("finalize_upload.py")
FINALIZE_STUDIO_SYNC_PY = resolve_helper_script("finalize_studio_sync.py")
PYTHON_BIN = Path(r"C:\Python314\python.exe")
AGENTAPI_BAT = Path(r"C:\Users\DELL\.gemini\antigravity\bin\agentapi.bat")
LANGUAGE_SERVER_EXE = Path(r"C:\Users\DELL\AppData\Local\Programs\antigravity\resources\bin\language_server.exe")

GEMINI_CONFIG_DIR = Path(r"C:\Users\DELL\.gemini\config")
GEMINI_CONFIG_JSON = GEMINI_CONFIG_DIR / "config.json"
SIDECAR_ID = "daily-viral-shorts"
SIDECAR_JSON = GEMINI_CONFIG_DIR / "sidecars" / SIDECAR_ID / "sidecar.json"
SIDECAR_DATA_DIR = Path(r"C:\Users\DELL\.gemini\antigravity\sidecar_data") / SIDECAR_ID
SIDECAR_LOG = SIDECAR_DATA_DIR / "logs" / "sidecar.log"
SIDECAR_EVENTS_DIR = SIDECAR_DATA_DIR / "events"
BRAIN_DIR = Path(r"C:\Users\DELL\.gemini\antigravity\brain")

YOUTUBE_CHANNEL_ID = "UCT-NT5b7lbS1mqaITYfeZ4g"
YOUTUBE_CHANNEL_TITLE = "Animated_Crew"

EXCLUDED_DIRS = {"manual-uploads", "__pycache__", "renders", "review", "tmp", "temp"}

# Fallback analytics baseline (refreshed continuously by real-time InnerTube + disk cache)
BASELINE_VIDEO_META: Dict[str, Dict[str, Any]] = {
    "Ju_GMnwmskA": {
        "title": "Thieves Stole 3,000 Tons Of Maple Syrup ($18.7M Heist!) 🍁🕵️ #Shorts",
        "publishedAt": "2026-11-11T05:11:09Z",
        "duration": "0:50",
        "duration_sec": 50,
        "is_short": True,
        "views": 926,
        "likes": 47,
        "comments": 0,
    },
    "ACCzOdTOvMM": {
        "title": "The Con Artist Who Sold The Eiffel Tower TWICE! 🗼💸 #Shorts",
        "publishedAt": "2026-11-10T13:35:00Z",
        "duration": "0:52",
        "duration_sec": 52,
        "is_short": True,
        "views": 1345,
        "likes": 46,
        "comments": 4,
    },
    "GM2VoeHNEV4": {
        "title": "Parents Legally Mailed Their 5-Year-Old Daughter For 53¢! 📦🤯 #Shorts",
        "publishedAt": "2026-11-10T09:09:54Z",
        "duration": "0:52",
        "duration_sec": 52,
        "is_short": True,
        "views": 1442,
        "likes": 88,
        "comments": 6,
    },
    "U2JI4OeNHP4": {
        "title": "He bought the Queen’s bank for $1… 🤯 #Shorts #animation #funny #memes #animationmeme #joker",
        "publishedAt": "2026-11-09T13:52:52Z",
        "duration": "0:39",
        "duration_sec": 39,
        "is_short": True,
        "views": 1328,
        "likes": 41,
        "comments": 4,
    },
    "GR6kYF3zbTo": {
        "title": "France Football Facts! 🇫🇷⚽️ World Cup Glory! #Shorts #France #WorldCupFacts",
        "publishedAt": "2026-06-13T12:30:41Z",
        "duration": "1:01",
        "duration_sec": 61,
        "is_short": True,
        "views": 19,
        "likes": 3,
        "comments": 0,
    },
    "CdskYyYawgM": {
        "title": "🤯 FIFA World Cup 2026: SHOCKING FACTS! #shorts #worldcup #fifa",
        "publishedAt": "2026-06-12T16:16:29Z",
        "duration": "1:03",
        "duration_sec": 63,
        "is_short": True,
        "views": 15,
        "likes": 2,
        "comments": 0,
    },
    "c3vN_Q-qNH8": {
        "title": "Brazil's FIFA World Cup Dominance: Top 10 Facts! 🇧🇷🏆 #shorts #WorldCupFacts",
        "publishedAt": "2026-06-12T13:26:01Z",
        "duration": "1:01",
        "duration_sec": 61,
        "is_short": True,
        "views": 18,
        "likes": 2,
        "comments": 1,
    },
}

app = FastAPI(title="Faceless Studio Hub", version="2.0.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

if STATIC_DIR.exists():
    app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")

@app.get("/media/{file_path:path}")
def serve_media(file_path: str):
    for root in (D_PROJECTS_ROOT, LOCAL_PROJECTS_ROOT, CLOUD_DATA_DIR):
        if root.exists():
            target = (root / file_path).resolve()
            if str(target).startswith(str(root.resolve())) and target.is_file():
                return FileResponse(str(target))
    raise HTTPException(status_code=404, detail="Media file not found")

if LOCAL_LONGFORM_ROOT.exists():
    app.mount("/media-longform", StaticFiles(directory=str(LOCAL_LONGFORM_ROOT)), name="media-longform")
elif CLOUD_LONGFORM_DIR.exists():
    app.mount("/media-longform", StaticFiles(directory=str(CLOUD_LONGFORM_DIR)), name="media-longform")

# Simple thread-safe locks, persistent workers & caches
_yt_lock = threading.RLock()
_yt_session_lock = threading.Lock()
_proc_lock = threading.Lock()
_runs_lock = threading.Lock()
_upload_lock = threading.Lock()
_mon_lock = threading.Lock()
_studio_sync_lock = threading.Lock()
_yt_cache: Dict[str, Any] = {"timestamp": 0.0, "data": None}
_yt_static_meta: Dict[str, Dict[str, Any]] = {}
_yt_discovery_cache: Dict[str, Any] = {
    "timestamp": 0.0,
    "shorts": set(BASELINE_VIDEO_META.keys()),
    "extra_ids": [],
    "subscribers": None,
}
_yt_disc_in_flight = False
_proc_cache: Dict[str, Any] = {
    "ts": 0.0,
    "in_flight": False,
    "active_tools": [],
}
YT_CACHE_TTL_SEC = 4.0
YT_DISCOVERY_TTL_SEC = 180.0
_yt_in_flight = False
_yt_live_in_ram = False
_yt_cold_worker_seq = 0
_yt_done_cond = threading.Condition(_yt_lock)
_yt_thread_local = threading.local()
_yt_executor: Optional[ThreadPoolExecutor] = None
_active_worker_jobs: set[str] = set()
_active_studio_sync_jobs: set[str] = set()
_active_upload_procs: Dict[str, subprocess.Popen] = {}
_cancelled_jobs: set[str] = set()


def _read_json(path: Path, default: Any = None) -> Any:
    try:
        if path.exists():
            return json.loads(path.read_text(encoding="utf-8", errors="replace"))
    except Exception:
        pass
    return default


def _write_json_atomic(path: Path, data: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + f".{uuid.uuid4().hex[:6]}.tmp")
    tmp.write_text(json.dumps(data, indent=2, ensure_ascii=False), encoding="utf-8")
    tmp.replace(path)


def _wav_duration(path: Path) -> Optional[float]:
    try:
        if not path.exists():
            return None
        with wave.open(str(path), "rb") as w:
            frames = w.getnframes()
            rate = w.getframerate()
            return round(frames / float(rate), 2) if rate else None
    except Exception:
        return None


def _file_mtime_iso(path: Path) -> Optional[str]:
    try:
        if path.exists():
            return datetime.fromtimestamp(path.stat().st_mtime).astimezone().isoformat(timespec="seconds")
    except Exception:
        pass
    return None


def _normalize_tags(raw_tags: Any) -> List[str]:
    if isinstance(raw_tags, list):
        candidates = [str(t).strip().lstrip("#") for t in raw_tags]
    elif isinstance(raw_tags, str):
        # Support comma-separated phrases (preferred by YouTube) or space-separated hashtags
        sep_pattern = r"[,;\n]+" if ("," in raw_tags or ";" in raw_tags or "\n" in raw_tags) else r"[,\s]+"
        candidates = [p.strip().lstrip("#") for p in re.split(sep_pattern, raw_tags)]
    else:
        candidates = []

    out: List[str] = []
    seen: set[str] = set()
    total_chars = 0
    for c in candidates:
        clean = re.sub(r"[<>\"`]+", "", c).strip()
        if not clean:
            continue
        key = clean.lower()
        if key in seen:
            continue
        cost = len(clean) + (3 if " " in clean else 1)
        if len(out) >= 30 or (total_chars + cost) > 420:
            break
        seen.add(key)
        out.append(clean)
        total_chars += cost

    return out or ["Shorts", "History", "TrueStory", "Animation"]


def _sanitize_youtube_meta(
    title: str,
    description: str,
    tags_raw: Any,
    privacy_status: str,
    category_id: str,
    is_longform: bool = False,
) -> Tuple[str, str, List[str], str, str]:
    clean_title = re.sub(r"[<>]+", "", str(title or "")).strip()
    clean_title = re.sub(r"\s+", " ", clean_title)
    if not clean_title:
        clean_title = "Documentary True Story" if is_longform else "CrewTube Short #Shorts"
    if len(clean_title) > 100:
        clean_title = clean_title[:97].rstrip() + "..."

    clean_desc = re.sub(r"[<>]+", "", str(description or "")).strip()
    if not clean_desc:
        clean_desc = f"{clean_title}\n\n#Documentary #History #TrueStory" if is_longform else f"{clean_title}\n\n#Shorts #Animation #History #TrueStory"
    elif not is_longform and "#shorts" not in clean_desc.lower():
        clean_desc = clean_desc.rstrip() + "\n\n#Shorts"
    if len(clean_desc) > 4900:
        clean_desc = clean_desc[:4880].rstrip() + ("\n\n#Documentary" if is_longform else "\n\n#Shorts")

    clean_tags = _normalize_tags(tags_raw)
    clean_priv = privacy_status.strip().lower() if privacy_status else "public"
    if clean_priv not in ("public", "unlisted", "private"):
        clean_priv = "public"
    default_cat = "27" if is_longform else "23"
    clean_cat = re.sub(r"[^0-9]", "", str(category_id or default_cat)) or default_cat
    return clean_title, clean_desc, clean_tags, clean_priv, clean_cat


def _build_default_metadata(slug: str, script: Dict[str, Any], run_meta: Dict[str, Any]) -> Dict[str, Any]:
    title_base = script.get("title") or run_meta.get("title") or slug.replace("-", " ").title()
    yt_title = run_meta.get("youtube_title") or f"{title_base} 🤯 #Shorts"
    if len(yt_title) > 100:
        yt_title = yt_title[:97].rstrip() + "..."
    lines = script.get("lines") or []
    summary_text = " ".join(str(l.get("text", "")).strip() for l in lines[:3]).strip()
    default_desc = (
        f"{summary_text}\n\n#Shorts #History #TrueStory #CrazyHistory #Animation #DidYouKnow"
        if summary_text
        else f"{title_base}\n\n#Shorts #History #TrueStory #Animation"
    )
    yt_desc = run_meta.get("youtube_description") or default_desc
    yt_tags = _normalize_tags(run_meta.get("youtube_tags"))
    return {
        "youtube_title": yt_title,
        "youtube_description": yt_desc,
        "youtube_tags": yt_tags,
        "privacy_status": str(run_meta.get("privacy_status") or "public"),
        "category_id": str(run_meta.get("category_id") or "23"),
    }


def _normalize_queue_locked(runs_data: Dict[str, Any]) -> Dict[str, Any]:
    runs = runs_data.setdefault("runs", [])
    queued = [r for r in runs if r.get("status") == "queued"]
    queued.sort(
        key=lambda r: (
            int(r["queue_order"]) if isinstance(r.get("queue_order"), (int, float)) else 999999,
            str(r.get("created_at") or ""),
            str(r.get("slug") or ""),
        )
    )
    for idx, r in enumerate(queued, start=1):
        r["queue_order"] = idx
    for r in runs:
        if r.get("status") != "queued":
            r["queue_order"] = None
    return runs_data


def _parse_multipart(content_type: str, body: bytes) -> Tuple[Dict[str, str], Dict[str, Dict[str, Any]]]:
    m = re.search(r'boundary=(?:"([^"]+)"|([^;\s]+))', content_type or "", re.IGNORECASE)
    if not m:
        raise ValueError("Missing multipart boundary")
    boundary_str = (m.group(1) or m.group(2) or "").strip()
    if not boundary_str:
        raise ValueError("Empty multipart boundary")
    delim = b"--" + boundary_str.encode("latin-1")
    fields: Dict[str, str] = {}
    files: Dict[str, Dict[str, Any]] = {}

    pos = body.find(delim)
    if pos == -1:
        raise ValueError("Multipart boundary delimiter not found in payload")
    mv = memoryview(body)

    while pos != -1:
        after_delim = pos + len(delim)
        if body[after_delim : after_delim + 2] == b"--":
            break
        part_start = after_delim
        if body[part_start : part_start + 2] == b"\r\n":
            part_start += 2
        elif body[part_start : part_start + 1] == b"\n":
            part_start += 1

        next_pos = body.find(delim, part_start)
        if next_pos == -1:
            break
        part_end = next_pos
        if body[part_end - 2 : part_end] == b"\r\n":
            part_end -= 2
        elif body[part_end - 1 : part_end] == b"\n":
            part_end -= 1

        sep_idx = body.find(b"\r\n\r\n", part_start, part_end)
        sep_len = 4
        if sep_idx == -1:
            sep_idx = body.find(b"\n\n", part_start, part_end)
            sep_len = 2
        if sep_idx != -1:
            hdr_bytes = body[part_start:sep_idx].decode("utf-8", errors="replace")
            payload_mv = mv[sep_idx + sep_len : part_end]
            name_m = re.search(r'name="([^"]+)"', hdr_bytes)
            if name_m:
                field_name = name_m.group(1)
                fn_m = re.search(r'filename="([^"]*)"', hdr_bytes)
                if fn_m:
                    files[field_name] = {
                        "filename": os.path.basename(fn_m.group(1)),
                        "content": payload_mv,
                    }
                else:
                    fields[field_name] = bytes(payload_mv).decode("utf-8", errors="replace")
        pos = next_pos

    return fields, files


def _refresh_proc_tools_bg() -> None:
    tools: List[str] = []
    try:
        out = subprocess.check_output(
            ["tasklist", "/fo", "csv", "/nh"],
            text=True,
            timeout=2.5,
            creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
        )
        lower = out.lower()
        if "ffmpeg.exe" in lower:
            tools.append("ffmpeg")
        if ("chrome-headless-shell" in lower or "chrome.exe" in lower) and "ffmpeg.exe" in lower:
            tools.append("headless-chrome")
    except Exception:
        pass
    finally:
        with _proc_lock:
            _proc_cache["active_tools"] = tools
            _proc_cache["ts"] = time.time()
            _proc_cache["in_flight"] = False


def _detect_active_processes() -> Dict[str, Any]:
    """Quickly detect whether local rendering/voice/ffmpeg tools are actively running without blocking HTTP requests."""
    if CLOUD_MODE or os.name != "nt":
        return {"is_rendering": False, "active_tools": [], "active_project": None}

    now = time.time()
    trigger_bg = False
    with _proc_lock:
        active_tools = list(_proc_cache["active_tools"])
        if not _proc_cache["in_flight"] and (now - _proc_cache["ts"]) >= 5.0:
            _proc_cache["in_flight"] = True
            trigger_bg = True
    if trigger_bg:
        threading.Thread(target=_refresh_proc_tools_bg, daemon=True).start()

    recent_project = None
    for r_root in (D_PROJECTS_ROOT, LOCAL_PROJECTS_ROOT, CLOUD_DATA_DIR if CLOUD_MODE else None):
        if not r_root or not r_root.exists():
            continue
        for d in r_root.iterdir():
            if not d.is_dir() or d.name.startswith(".") or d.name in EXCLUDED_DIRS:
                continue
            for check_rel in ["script.json", "data/narration.wav", "data/words.json", "data/mix.wav", "src/shots.js"]:
                p = d / check_rel
                if p.exists() and (now - p.stat().st_mtime) < 90:
                    recent_project = d.name
                    break
            if not recent_project and (d / "renders").exists():
                for mp in (d / "renders").glob("*.mp4"):
                    if (now - mp.stat().st_mtime) < 45:
                        recent_project = d.name
                        if "rendering" not in active_tools:
                            active_tools.append("rendering")
                        break
            if recent_project:
                break
        if recent_project:
            break

    return {
        "is_rendering": len(active_tools) > 0 or recent_project is not None,
        "active_tools": active_tools,
        "active_project": recent_project,
    }


def _compute_next_run(cron_str: str) -> Dict[str, Any]:
    tz_name = "Asia/Kolkata"
    hour, minute = 19, 0
    m = re.match(r"CRON_TZ=([^\s]+)\s+(\d+)\s+(\d+)\s+", cron_str or "")
    if m:
        tz_name = m.group(1)
        minute = int(m.group(2))
        hour = int(m.group(3))

    try:
        tz = ZoneInfo(tz_name)
    except Exception:
        tz = ZoneInfo("UTC")

    now = datetime.now(tz)
    target = now.replace(hour=hour, minute=minute, second=0, microsecond=0)
    if target <= now:
        target += timedelta(days=1)

    diff_sec = int((target - now).total_seconds())
    return {
        "timezone": tz_name,
        "local_time_label": f"{hour % 12 or 12}:{minute:02d} {'PM' if hour >= 12 else 'AM'}",
        "next_run_iso": target.isoformat(),
        "seconds_until_next": max(0, diff_sec),
        "now_iso": now.isoformat(),
    }


def get_automation_status() -> Dict[str, Any]:
    if CLOUD_MODE:
        snap = _read_json(CLOUD_DATA_DIR / "automation_snapshot.json", {})
        enabled = bool(snap.get("enabled", True))
        cron_str = snap.get("cron_str") or "CRON_TZ=Asia/Kolkata 0 19 * * *"
        schedule_info = _compute_next_run(cron_str)
        return {
            "sidecar_id": SIDECAR_ID,
            "cloud_mode": True,
            "display_name": snap.get("display_name", "Daily Viral Tall Tale Short"),
            "description": snap.get("description", ""),
            "enabled": enabled,
            "run_state": "armed" if enabled else "disabled",
            "queue_mode": "fifo_one_per_day",
            "schedule": schedule_info,
            "scheduler_started_at": snap.get("synced_at"),
            "last_trigger_at": None,
            "next_exec_log": None,
            "latest_conversation_id": None,
            "latest_conversation_status": "armed",
            "latest_conversation_updated": snap.get("synced_at"),
            "latest_conversation_note": snap.get(
                "latest_conversation_note",
                "Workstation daemon armed · FIFO queue uploads 1 Short/day at 7:00 PM IST.",
            ),
            "auto_prompt_ready": True,
            "active_processes": {"is_rendering": False, "active_tools": [], "active_project": None},
            "events": [],
            "log_tail": snap.get("log_tail", []),
        }

    config = _read_json(GEMINI_CONFIG_JSON, {})
    sidecar_cfg = _read_json(SIDECAR_JSON, {})
    sidecar_state = config.get("sidecars", {}).get(SIDECAR_ID, {})
    enabled = bool(sidecar_state.get("enabled", False))

    args = sidecar_cfg.get("args", [])
    cron_str = args[0] if args else "CRON_TZ=Asia/Kolkata 0 19 * * *"
    schedule_info = _compute_next_run(cron_str)

    log_lines: List[str] = []
    scheduler_started_at = None
    last_trigger_at = None
    next_exec_log = None
    if SIDECAR_LOG.exists():
        raw_lines = SIDECAR_LOG.read_text(encoding="utf-8", errors="replace").splitlines()
        log_lines = raw_lines[-30:]
        for line in raw_lines:
            if "sidecar \"" in line and "started at" in line:
                m = re.search(r"started at ([^\s=]+)", line)
                if m:
                    scheduler_started_at = m.group(1)
            if "[schedule] Triggering command:" in line:
                last_trigger_at = line[:19]
            if "[schedule] Next execution scheduled" in line:
                next_exec_log = line

    events: List[Dict[str, Any]] = []
    latest_conv_id = None
    latest_conv_status = "idle"
    latest_conv_updated = None
    latest_conv_note = "Ready for next 7:00 PM IST drop (uploads 1 queued video/day)."

    if SIDECAR_EVENTS_DIR.exists():
        event_files = sorted(SIDECAR_EVENTS_DIR.glob("*.json"), key=lambda p: p.stat().st_mtime, reverse=True)
        for ef in event_files[:10]:
            ev = _read_json(ef, {})
            if ev:
                payload = ev.get("payload", {}).get("newConversation", {})
                conv_id = payload.get("conversationId")
                ts_ms = ev.get("timestampMs")
                ts_iso = None
                try:
                    if ts_ms:
                        ts_iso = datetime.fromtimestamp(int(ts_ms) / 1000.0).astimezone().isoformat(timespec="seconds")
                except Exception:
                    ts_iso = _file_mtime_iso(ef)
                events.append(
                    {
                        "file": ef.name,
                        "timestamp": ts_iso,
                        "conversation_id": conv_id,
                        "prompt_preview": (payload.get("prompt") or "")[:120],
                        "error": ev.get("error") or None,
                    }
                )
        if events:
            latest_conv_id = events[0].get("conversation_id")

    if latest_conv_id:
        transcript_path = BRAIN_DIR / latest_conv_id / ".system_generated" / "logs" / "transcript.jsonl"
        if transcript_path.exists():
            mtime = transcript_path.stat().st_mtime
            latest_conv_updated = datetime.fromtimestamp(mtime).astimezone().isoformat(timespec="seconds")
            age_sec = time.time() - mtime
            try:
                t_lines = transcript_path.read_text(encoding="utf-8", errors="replace").splitlines()
                if t_lines:
                    last_step = json.loads(t_lines[-1])
                    step_status = last_step.get("status")
                    step_type = last_step.get("type")
                    if age_sec < 120 and (step_status == "RUNNING" or step_type != "PLANNER_RESPONSE"):
                        latest_conv_status = "running"
                        latest_conv_note = "Scheduled agent is actively working right now."
                    else:
                        latest_conv_status = "completed"
                        content = last_step.get("content", "")
                        if "requested" in content.lower() or "ended with a colon" in content.lower():
                            latest_conv_status = "needs_attention"
                            latest_conv_note = "Previous trigger note detected; FIFO queue ready for 7:00 PM IST."
                        else:
                            latest_conv_note = "Scheduler armed (FIFO queue: 1 video/day at 7:00 PM IST)."
            except Exception:
                pass

    proc_info = _detect_active_processes()
    if proc_info["is_rendering"]:
        run_state = "running"
    elif not enabled:
        run_state = "disabled"
    elif latest_conv_status == "running":
        run_state = "running"
    else:
        run_state = "armed"

    prompt_arg = args[4] if len(args) > 4 else ""
    auto_prompt_fixed = "AUTO_PROMPT.md" in prompt_arg and "\n" not in prompt_arg

    return {
        "sidecar_id": SIDECAR_ID,
        "cloud_mode": False,
        "display_name": sidecar_cfg.get("display_name", "Daily Viral Tall Tale Short"),
        "description": sidecar_cfg.get("description", ""),
        "enabled": enabled,
        "run_state": run_state,
        "queue_mode": "fifo_one_per_day",
        "schedule": schedule_info,
        "scheduler_started_at": scheduler_started_at,
        "last_trigger_at": last_trigger_at,
        "next_exec_log": next_exec_log,
        "latest_conversation_id": latest_conv_id,
        "latest_conversation_status": latest_conv_status,
        "latest_conversation_updated": latest_conv_updated,
        "latest_conversation_note": latest_conv_note,
        "auto_prompt_ready": auto_prompt_fixed and (PROJECTS_ROOT / "AUTO_PROMPT.md").exists(),
        "active_processes": proc_info,
        "events": events,
        "log_tail": log_lines,
    }


_INNERTUBE_WEB_CTX = {
    "client": {
        "clientName": "WEB",
        "clientVersion": "2.20240726.00.00",
        "hl": "en",
        "gl": "US",
    }
}
_YT_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
    "Accept-Language": "en-US,en;q=0.9",
}
_YT_COOKIES = {"CONSENT": "PENDING+987", "SOCS": "CAESHAgBEhJnd3NfMjAyMzA4MTAtMF9SQzIaAmVuIAEaBgiA_LyaBg"}
_YT_NEXT_FIELDS = (
    "contents.twoColumnWatchNextResults.results.results.contents("
    "videoPrimaryInfoRenderer(title.runs.text,viewCount.videoViewCountRenderer),"
    "videoSecondaryInfoRenderer.owner.videoOwnerRenderer.subscriberCountText.simpleText),"
    "engagementPanels.engagementPanelSectionListRenderer.content.structuredDescriptionContentRenderer.items.videoDescriptionHeaderRenderer.factoid"
)
_YT_PLAYER_FIELDS = "videoDetails(videoId,lengthSeconds),microformat.playerMicroformatRenderer.publishDate"


_YT_SSL_CTX = ssl.create_default_context()
_YT_SSL_CTX.options |= getattr(ssl, "OP_IGNORE_UNEXPECTED_EOF", 0x80)
_yt_dns_lock = threading.Lock()
_yt_dns_cache: Dict[Tuple[str, int], Tuple[float, List[str]]] = {}
_yt_dns_stale: Dict[Tuple[str, int], List[str]] = {}
_yt_dns_inflight: Dict[Tuple[str, int], threading.Event] = {}
_yt_good_ips: Dict[str, str] = {}
_YT_DNS_TTL_SEC = 600.0
_YT_DNS_SWR_SEC = 300.0


def _skip_dns_name(data: bytes, idx: int) -> int:
    seen_jumps = 0
    while idx < len(data):
        ln = data[idx]
        if ln == 0:
            return idx + 1
        if (ln & 0xC0) == 0xC0:
            if idx + 1 >= len(data) or seen_jumps > 4:
                return len(data)
            return idx + 2
        idx += 1 + ln
        seen_jumps += 1
    return len(data)


def _udp_dns_lookup_a(host: str, resolver: str, timeout: float = 1.6) -> Tuple[List[str], bool]:
    """Query DNS A records via UDP:53 and return (ipv4_list, nxdomain)."""
    tid = random.randint(0, 65535)
    header = struct.pack("!HHHHHH", tid, 0x0100, 1, 0, 0, 0)
    try:
        labels = [p.encode("idna") for p in host.strip(".").split(".") if p]
    except Exception:
        labels = [p.encode("ascii", errors="ignore") for p in host.strip(".").split(".") if p]
    if not labels:
        return [], True
    qname = b"".join(bytes([len(lbl)]) + lbl for lbl in labels if len(lbl) < 64) + b"\x00"
    pkt = header + qname + struct.pack("!HH", 1, 1)

    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    s.settimeout(timeout)
    try:
        s.connect((resolver, 53))
        s.send(pkt)
        data = s.recv(2048)
    finally:
        s.close()

    if len(data) < 12:
        return [], False
    r_tid, flags, qdcount, ancount, _, _ = struct.unpack("!HHHHHH", data[:12])
    if r_tid != tid or (flags & 0x8000) == 0:
        return [], False
    rcode = flags & 0x0F
    if rcode == 3:
        return [], True
    if rcode != 0:
        return [], False

    idx = 12
    for _ in range(qdcount):
        idx = _skip_dns_name(data, idx) + 4
        if idx > len(data):
            return [], False

    ips: List[str] = []
    for _ in range(ancount):
        idx = _skip_dns_name(data, idx)
        if idx + 10 > len(data):
            break
        rtype, rclass, _, rdlen = struct.unpack("!HHIH", data[idx : idx + 10])
        idx += 10
        if rtype == 1 and rclass == 1 and rdlen == 4 and idx + 4 <= len(data):
            ip_str = socket.inet_ntoa(data[idx : idx + 4])
            try:
                ip_obj = ipaddress.IPv4Address(ip_str)
                if not ip_obj.is_unspecified and not ip_obj.is_multicast and ip_str not in ips:
                    ips.append(ip_str)
            except Exception:
                pass
        idx += rdlen
    return ips, False


def _resolve_ipv4s_uncached(host: str, port: int) -> List[str]:
    """Race fast UDP resolvers (1.1.1.1 / 8.8.8.8 / 9.9.9.9) alongside OS getaddrinfo."""
    try:
        ipaddress.IPv4Address(host)
        return [host]
    except Exception:
        pass

    use_udp = "." in host and not host.endswith(".local")
    targets = ["1.1.1.1", "8.8.8.8", "9.9.9.9"] if use_udp else []
    total_workers = len(targets) + 1
    pending = [total_workers]
    win_ips: List[List[str]] = [[]]
    nxdomain_hits = [0]
    last_err: List[Optional[Exception]] = [None]
    rlock = threading.Lock()
    done_evt = threading.Event()

    def _finish_check() -> None:
        pending[0] -= 1
        if pending[0] <= 0 or win_ips[0]:
            done_evt.set()

    def _run_udp(resolver: str) -> None:
        try:
            ips, is_nx = _udp_dns_lookup_a(host, resolver, timeout=1.6)
            with rlock:
                if ips and not win_ips[0]:
                    win_ips[0] = ips
                elif is_nx:
                    nxdomain_hits[0] += 1
                _finish_check()
        except Exception as exc:
            with rlock:
                last_err[0] = exc
                _finish_check()

    def _run_sys() -> None:
        try:
            addrs = socket.getaddrinfo(host, port, socket.AF_INET, socket.SOCK_STREAM)
            ips = list(dict.fromkeys(a[4][0] for a in addrs))
            with rlock:
                if ips and not win_ips[0]:
                    win_ips[0] = ips
                _finish_check()
        except Exception as exc:
            with rlock:
                last_err[0] = exc
                _finish_check()

    for res in targets:
        threading.Thread(target=_run_udp, args=(res,), daemon=True, name="yt-dns-udp").start()
    threading.Thread(target=_run_sys, daemon=True, name="yt-dns-sys").start()

    done_evt.wait(timeout=2.2 if use_udp else 3.2)
    with rlock:
        ips_out = list(win_ips[0])
        is_nx = nxdomain_hits[0] > 0 and not ips_out
        err_out = last_err[0]

    if not ips_out and not is_nx and use_udp:
        # Give OS getaddrinfo one brief extra window before falling back to stale cache
        done_evt.wait(timeout=1.1)
        with rlock:
            ips_out = list(win_ips[0])

    if not ips_out:
        stale = _yt_dns_stale.get((host, port)) if not is_nx else None
        if stale:
            return list(stale)
        if isinstance(err_out, socket.gaierror):
            raise err_out
        raise socket.gaierror(11001, f"DNS resolution failed for {host}")
    return ips_out


def _refresh_dns_bg(host: str, port: int) -> None:
    key = (host, port)
    with _yt_dns_lock:
        if key in _yt_dns_inflight:
            return
        evt = threading.Event()
        _yt_dns_inflight[key] = evt
    try:
        ips = _resolve_ipv4s_uncached(host, port)
        now = time.time()
        with _yt_dns_lock:
            _yt_dns_cache[key] = (now, ips)
            _yt_dns_stale[key] = list(ips)
    except Exception:
        pass
    finally:
        with _yt_dns_lock:
            _yt_dns_inflight.pop(key, None)
        evt.set()


def _yt_get_ipv4s(host: str, port: int) -> List[str]:
    key = (host, port)
    now = time.time()
    wait_evt: Optional[threading.Event] = None
    is_leader = False

    with _yt_dns_lock:
        cached = _yt_dns_cache.get(key)
        if cached and (now - cached[0]) < _YT_DNS_TTL_SEC and cached[1]:
            if (now - cached[0]) >= _YT_DNS_SWR_SEC and key not in _yt_dns_inflight:
                threading.Thread(target=_refresh_dns_bg, args=(host, port), daemon=True, name="yt-dns-swr").start()
            return list(cached[1])
        wait_evt = _yt_dns_inflight.get(key)
        if wait_evt is None:
            wait_evt = threading.Event()
            _yt_dns_inflight[key] = wait_evt
            is_leader = True

    if not is_leader and wait_evt is not None:
        wait_evt.wait(timeout=3.6)
        with _yt_dns_lock:
            cached = _yt_dns_cache.get(key)
            if cached and cached[1]:
                return list(cached[1])
            stale = _yt_dns_stale.get(key)
            if stale:
                return list(stale)
        # Leader failed without caching; fall back to direct resolution
        return _resolve_ipv4s_uncached(host, port)

    try:
        ips = _resolve_ipv4s_uncached(host, port)
        done_now = time.time()
        with _yt_dns_lock:
            _yt_dns_cache[key] = (done_now, ips)
            _yt_dns_stale[key] = list(ips)
        return ips
    finally:
        with _yt_dns_lock:
            _yt_dns_inflight.pop(key, None)
        wait_evt.set()


def _yt_race_ipv4_connect(
    conn_obj: Any,
    host: str,
    port: int,
    tcp_timeout: float = 2.6,
    io_timeout: float = 5.0,
) -> socket.socket:
    try:
        ips = _yt_get_ipv4s(host, port)
    except socket.gaierror as exc:
        raise NameResolutionError(host, conn_obj, exc) from exc

    with _yt_dns_lock:
        pinned = _yt_good_ips.get(host)
    others = [ip for ip in ips if ip != pinned]
    random.shuffle(others)
    candidates = ([pinned] + others[:2]) if (pinned and pinned in ips) else others[:3]

    winner: List[Optional[Any]] = [None, None]
    last_err: List[Optional[Exception]] = [None]
    race_lock = threading.Lock()
    done_evt = threading.Event()
    opened_socks: List[socket.socket] = []

    def _attempt(ip: str, delay: float) -> None:
        if delay > 0 and done_evt.wait(delay):
            return
        if done_evt.is_set():
            return
        sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        sock.settimeout(tcp_timeout)
        with race_lock:
            if done_evt.is_set():
                try:
                    sock.close()
                except Exception:
                    pass
                return
            opened_socks.append(sock)
        try:
            sock.connect((ip, port))
            with race_lock:
                if winner[0] is None and not done_evt.is_set():
                    winner[0] = sock
                    winner[1] = ip
                    done_evt.set()
                    return
            try:
                sock.close()
            except Exception:
                pass
        except Exception as exc:
            with race_lock:
                last_err[0] = exc
            try:
                sock.close()
            except Exception:
                pass

    for idx, ip in enumerate(candidates):
        threading.Thread(target=_attempt, args=(ip, idx * 0.18), daemon=True, name="yt-he-conn").start()

    done_evt.wait(timeout=tcp_timeout)
    with race_lock:
        done_evt.set()
        win_sock = winner[0]
        win_ip = winner[1]
        for s in opened_socks:
            if s is not win_sock:
                try:
                    s.close()
                except Exception:
                    pass
        err = last_err[0]

    if win_sock is None:
        with _yt_dns_lock:
            if candidates and _yt_good_ips.get(host) == candidates[0]:
                _yt_good_ips.pop(host, None)
        if isinstance(err, OSError) and not isinstance(err, socket.timeout):
            raise NewConnectionError(conn_obj, f"Failed to establish a new connection: {err}") from err
        raise ConnectTimeoutError(conn_obj, f"Connection to {host} timed out. (connect timeout={tcp_timeout})")

    with _yt_dns_lock:
        _yt_good_ips[host] = str(win_ip)
    win_sock.settimeout(io_timeout)
    sys.audit("http.client.connect", conn_obj, conn_obj.host, conn_obj.port)
    return win_sock


class _FastHTTPSConnection(HTTPSConnection):
    def _new_conn(self) -> socket.socket:
        raw_t = self.timeout
        connect_t = float(raw_t) if isinstance(raw_t, (int, float)) and raw_t > 0 else 3.8
        return _yt_race_ipv4_connect(
            self,
            self._dns_host,
            self.port,
            tcp_timeout=min(3.4, max(1.5, connect_t)),
            io_timeout=max(2.8, min(connect_t + 1.0, 5.2)),
        )


class _FastHTTPSPool(HTTPSConnectionPool):
    ConnectionCls = _FastHTTPSConnection


class _FastPoolManager(PoolManager):
    def _new_pool(self, scheme, host, port, request_context=None):
        if scheme == "https" and not IS_VERCEL and os.name == "nt":
            kwargs = dict(self.connection_pool_kw)
            kwargs.pop("strict", None)
            return _FastHTTPSPool(host, port, **kwargs)
        return super()._new_pool(scheme, host, port, request_context)


class _YTCompatTLSAdapter(HTTPAdapter):
    """HTTP/1.1 keep-alive adapter with IPv4 2-edge failover on Windows and OpenSSL 3 EOF resilience."""

    def init_poolmanager(self, connections, maxsize, block=False, **pool_kwargs):
        manager_cls = _FastPoolManager if (not IS_VERCEL and os.name == "nt") else PoolManager
        self.poolmanager = manager_cls(
            num_pools=connections,
            maxsize=maxsize,
            block=block,
            ssl_context=_YT_SSL_CTX,
            **pool_kwargs,
        )


def _new_yt_session() -> requests.Session:
    s = requests.Session()
    retry = Retry(
        total=0,
        connect=0,
        read=0,
        allowed_methods=frozenset(["GET", "POST"]),
        raise_on_status=False,
    )
    adapter = _YTCompatTLSAdapter(pool_connections=4, pool_maxsize=4, max_retries=retry)
    s.mount("https://", adapter)
    s.mount("http://", adapter)
    s.headers.update(_YT_HEADERS)
    s.cookies.update(_YT_COOKIES)
    return s


def _get_batch_yt_session(
    batch_id: Optional[str] = None,
    batch_sessions: Optional[List[requests.Session]] = None,
) -> Tuple[requests.Session, bool]:
    """Reuse keep-alive sockets only within one active poll batch when batch_id is given."""
    if batch_id:
        cur_id = getattr(_yt_thread_local, "batch_id", None)
        cur_sess = getattr(_yt_thread_local, "batch_session", None)
        if cur_id == batch_id and cur_sess is not None:
            return cur_sess, False
        s = _new_yt_session()
        _yt_thread_local.batch_id = batch_id
        _yt_thread_local.batch_session = s
        if batch_sessions is not None:
            with _yt_lock:
                batch_sessions.append(s)
        return s, False
    return _get_worker_yt_session(), False


def _get_worker_yt_session() -> requests.Session:
    global _yt_cold_worker_seq
    sess = getattr(_yt_thread_local, "worker_session", None)
    if sess is None:
        if not IS_VERCEL and os.name == "nt":
            with _yt_lock:
                seq = _yt_cold_worker_seq
                _yt_cold_worker_seq += 1
            if seq < 7 and (seq % 7) > 0:
                time.sleep((seq % 7) * 0.22)
        sess = _new_yt_session()
        _yt_thread_local.worker_session = sess
    return sess


def _reset_worker_yt_session() -> requests.Session:
    old = getattr(_yt_thread_local, "worker_session", None)
    if old is not None:
        try:
            old.close()
        except Exception:
            pass
    sess = _new_yt_session()
    _yt_thread_local.worker_session = sess
    return sess


def _get_yt_session() -> requests.Session:
    return _get_worker_yt_session()


def _get_yt_executor() -> ThreadPoolExecutor:
    global _yt_executor
    with _yt_lock:
        if _yt_executor is None:
            _yt_executor = ThreadPoolExecutor(max_workers=8 if IS_VERCEL else 7, thread_name_prefix="yt-live")
        return _yt_executor


def _get_studio_config() -> Dict[str, Any]:
    cfg: Dict[str, Any] = {}
    if not CLOUD_MODE and STUDIO_CONFIG_PATH.exists():
        raw = _read_json(STUDIO_CONFIG_PATH, {})
        if isinstance(raw, dict):
            cfg.update(raw)
    env_map = {
        "youtube_api_key": "YOUTUBE_API_KEY",
        "oauth_access_token": "YOUTUBE_OAUTH_ACCESS_TOKEN",
        "oauth_refresh_token": "YOUTUBE_OAUTH_REFRESH_TOKEN",
        "oauth_client_id": "YOUTUBE_OAUTH_CLIENT_ID",
        "oauth_client_secret": "YOUTUBE_OAUTH_CLIENT_SECRET",
        "zapier_webhook_url": "ZAPIER_STUDIO_WEBHOOK_URL",
    }
    for key, env_name in env_map.items():
        val = (os.environ.get(env_name) or "").strip()
        if val:
            cfg[key] = val
    return cfg


def _refresh_oauth_token_if_needed(cfg: Dict[str, Any], sess: requests.Session, force: bool = False) -> Optional[str]:
    access_tok = (cfg.get("oauth_access_token") or "").strip()
    expires_at = float(cfg.get("oauth_expires_at") or 0.0)
    if access_tok and not force and (expires_at == 0.0 or time.time() < expires_at - 60):
        return access_tok
    rt = (cfg.get("oauth_refresh_token") or "").strip()
    cid = (cfg.get("oauth_client_id") or "").strip()
    csec = (cfg.get("oauth_client_secret") or "").strip()
    if not (rt and cid and csec):
        return access_tok or None
    try:
        tr = sess.post(
            "https://oauth2.googleapis.com/token",
            data={
                "client_id": cid,
                "client_secret": csec,
                "refresh_token": rt,
                "grant_type": "refresh_token",
            },
            timeout=(3.0, 4.0),
        )
        if tr.status_code == 200:
            tj = tr.json()
            new_tok = str(tj.get("access_token") or "").strip()
            if new_tok:
                cfg["oauth_access_token"] = new_tok
                cfg["oauth_expires_at"] = time.time() + int(tj.get("expires_in") or 3500)
                if not CLOUD_MODE and STUDIO_CONFIG_PATH.exists():
                    try:
                        _write_json_atomic(STUDIO_CONFIG_PATH, cfg)
                    except Exception:
                        pass
                return new_tok
    except Exception:
        pass
    return access_tok or None


def _parse_iso8601_dur_sec(dur: str) -> Optional[int]:
    m = re.match(r"^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$", str(dur or "").strip())
    if not m:
        return None
    return int(m.group(1) or 0) * 3600 + int(m.group(2) or 0) * 60 + int(m.group(3) or 0)


def _load_studio_snapshot() -> Dict[str, Any]:
    raw = _read_json(STUDIO_ANALYTICS_PATH, None)
    return raw if isinstance(raw, dict) else {}


def _fetch_via_youtube_data_api_v3(
    seed_ids: List[str],
    force_discovery: bool = False,
) -> Optional[Dict[str, Any]]:
    cfg = _get_studio_config()
    api_key = (cfg.get("youtube_api_key") or "").strip()
    has_oauth_cfg = bool(
        (cfg.get("oauth_access_token") or "").strip()
        or (
            (cfg.get("oauth_refresh_token") or "").strip()
            and (cfg.get("oauth_client_id") or "").strip()
            and (cfg.get("oauth_client_secret") or "").strip()
        )
    )
    if not api_key and not has_oauth_cfg:
        return None

    with _new_yt_session() as sess:
        oauth_token = _refresh_oauth_token_if_needed(cfg, sess)
        if not api_key and not oauth_token:
            return None

        headers = {"Authorization": f"Bearer {oauth_token}"} if oauth_token else {}
        auth_params: Dict[str, Any] = {} if oauth_token else {"key": api_key}

        all_ids: List[str] = list(dict.fromkeys(seed_ids))
        with _yt_lock:
            disc_age = time.time() - _yt_discovery_cache["timestamp"] if _yt_discovery_cache["timestamp"] > 0 else 999999.0

        # Discover channel uploads playlist when stale or forced
        if force_discovery or disc_age >= YT_DISCOVERY_TTL_SEC:
            try:
                uploads_pid = "UU" + YOUTUBE_CHANNEL_ID[2:] if YOUTUBE_CHANNEL_ID.startswith("UC") else f"UU{YOUTUBE_CHANNEL_ID}"
                rp = sess.get(
                    "https://www.googleapis.com/youtube/v3/playlistItems",
                    params={"part": "contentDetails", "playlistId": uploads_pid, "maxResults": 25, **auth_params},
                    headers=headers,
                    timeout=(2.8, 4.0),
                )
                if rp.status_code == 200:
                    found_ids = [
                        str(it.get("contentDetails", {}).get("videoId") or "")
                        for it in rp.json().get("items", [])
                        if isinstance(it, dict)
                    ]
                    found_ids = [v for v in found_ids if v]
                    for vid in found_ids:
                        if vid not in all_ids:
                            all_ids.append(vid)
                    with _yt_lock:
                        _yt_discovery_cache["timestamp"] = time.time()
                        _yt_discovery_cache["extra_ids"] = all_ids[:]
            except Exception:
                pass

        if not all_ids:
            return None

        ch_params: Dict[str, Any] = {"part": "statistics,status,snippet", **auth_params}
        if oauth_token:
            ch_params["mine"] = "true"
        else:
            ch_params["id"] = YOUTUBE_CHANNEL_ID

        vid_resp = sess.get(
            "https://www.googleapis.com/youtube/v3/videos",
            params={"part": "snippet,statistics,contentDetails,status", "id": ",".join(all_ids[:50]), **auth_params},
            headers=headers,
            timeout=(2.8, 4.0),
        )
        if vid_resp.status_code == 401 and oauth_token:
            oauth_token = _refresh_oauth_token_if_needed(cfg, sess, force=True)
            if oauth_token:
                headers = {"Authorization": f"Bearer {oauth_token}"}
                vid_resp = sess.get(
                    "https://www.googleapis.com/youtube/v3/videos",
                    params={"part": "snippet,statistics,contentDetails,status", "id": ",".join(all_ids[:50])},
                    headers=headers,
                    timeout=(2.8, 4.0),
                )
        if vid_resp.status_code != 200:
            return None

        ch_stats: Dict[str, Any] = {}
        ch_status: Dict[str, Any] = {}
        try:
            rc = sess.get("https://www.googleapis.com/youtube/v3/channels", params=ch_params, headers=headers, timeout=(2.5, 3.5))
            if rc.status_code == 200:
                items_c = rc.json().get("items") or []
                if items_c:
                    ch_stats = items_c[0].get("statistics", {}) or {}
                    ch_status = items_c[0].get("status", {}) or {}
        except Exception:
            pass

        videos_out: Dict[str, Dict[str, Any]] = {}
        for item in vid_resp.json().get("items", []):
            vid = str(item.get("id") or "")
            if not vid:
                continue
            sn = item.get("snippet", {}) or {}
            st = item.get("statistics", {}) or {}
            cd = item.get("contentDetails", {}) or {}
            dur_sec = _parse_iso8601_dur_sec(cd.get("duration", ""))
            views = int(st.get("viewCount") or 0)
            likes = int(st.get("likeCount") or 0)
            comments = int(st.get("commentCount") or 0)
            dur_str = f"{dur_sec // 60}:{dur_sec % 60:02d}" if dur_sec is not None else "0:45"
            videos_out[vid] = {
                "id": vid,
                "title": sn.get("title") or vid,
                "views": views,
                "likes": likes,
                "comments": comments,
                "published_at": sn.get("publishedAt"),
                "duration": dur_str,
                "duration_sec": dur_sec,
                "is_short": (dur_sec <= 65) if dur_sec is not None else True,
                "thumbnail": f"https://i.ytimg.com/vi/{vid}/hqdefault.jpg",
                "play_url": f"https://www.youtube.com/watch?v={vid}",
                "shorts_url": f"https://www.youtube.com/shorts/{vid}",
                "engagement_pct": round((likes / views * 100), 1) if views > 0 else 0.0,
            }
        return {
            "videos": videos_out,
            "subscribers": str(ch_stats.get("subscriberCount")) if ch_stats.get("subscriberCount") is not None else None,
            "channel_views_settled": int(ch_stats.get("viewCount") or 0) if ch_stats.get("viewCount") is not None else None,
            "ypp_enabled": ch_status.get("isChannelMonetizationEnabled"),
            "source_mode": "youtube_oauth_api_v3" if oauth_token else "youtube_data_api_v3",
            "source_label": "YouTube Studio OAuth (Data API v3)" if oauth_token else "YouTube Studio Data API v3 (Key)",
        }


def _load_disk_yt_cache() -> Optional[Dict[str, Any]]:
    if CLOUD_MODE or not YT_LIVE_CACHE_PATH.exists():
        return None
    raw = _read_json(YT_LIVE_CACHE_PATH, None)
    if isinstance(raw, dict) and isinstance(raw.get("videos"), list) and raw["videos"]:
        return raw
    return None


def _build_studio_summary(
    videos_list: List[Dict[str, Any]],
    studio_snap: Optional[Dict[str, Any]] = None,
    api_v3_meta: Optional[Dict[str, Any]] = None,
    mon_snap: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    cfg = _get_studio_config()
    snap = studio_snap if isinstance(studio_snap, dict) else {}
    mon = mon_snap if isinstance(mon_snap, dict) else {}
    api_key_set = bool((cfg.get("youtube_api_key") or "").strip())
    oauth_set = bool(
        (cfg.get("oauth_access_token") or "").strip()
        or (
            (cfg.get("oauth_refresh_token") or "").strip()
            and (cfg.get("oauth_client_id") or "").strip()
            and (cfg.get("oauth_client_secret") or "").strip()
        )
    )

    if api_v3_meta:
        api_mode = api_v3_meta.get("source_mode") or "youtube_data_api_v3"
        source_label = api_v3_meta.get("source_label") or "YouTube Studio Data API v3"
    elif snap:
        api_mode = "zapier_studio_sync+innertube"
        source_label = f"{snap.get('source') or 'YouTube Studio (Zapier OAuth)'} + 5s Live Stream"
    else:
        api_mode = "innertube_live"
        source_label = "Real-Time InnerTube Stream (5s)"

    mins_watched = int(snap.get("analytics_minutes_watched") if snap.get("analytics_minutes_watched") is not None else (mon.get("analytics_minutes_watched") or 0))
    settled_views = int(snap.get("analytics_views_settled") if snap.get("analytics_views_settled") is not None else (mon.get("analytics_views_settled") or 0))
    avg_dur_sec = int(snap.get("analytics_avg_view_duration_sec") or 0)
    subs_gained = int(snap.get("analytics_subscribers_gained") if snap.get("analytics_subscribers_gained") is not None else (mon.get("analytics_subscribers_gained") or 0))
    total_comments = sum(int(v.get("comments") or 0) for v in videos_list) if videos_list else int(snap.get("total_comments") or 0)
    ch_views_settled = (
        api_v3_meta.get("channel_views_settled")
        if (api_v3_meta and api_v3_meta.get("channel_views_settled") is not None)
        else snap.get("channel_views_settled")
    )
    ypp_enabled = (
        bool(api_v3_meta.get("ypp_enabled"))
        if (api_v3_meta and api_v3_meta.get("ypp_enabled") is not None)
        else bool(snap.get("ypp_enabled") if snap.get("ypp_enabled") is not None else mon.get("ypp_enabled", False))
    )

    return {
        "channel_id": YOUTUBE_CHANNEL_ID,
        "channel_title": YOUTUBE_CHANNEL_TITLE,
        "api_mode": api_mode,
        "source": source_label,
        "api_key_configured": api_key_set,
        "oauth_connected": oauth_set,
        "zapier_oauth_connected": True,
        "ypp_enabled": ypp_enabled,
        "channel_views_settled": ch_views_settled,
        "live_video_views_sum": sum(int(v.get("views") or 0) for v in videos_list),
        "live_likes_sum": sum(int(v.get("likes") or 0) for v in videos_list),
        "total_comments": total_comments,
        "analytics_views_settled": settled_views,
        "analytics_likes_settled": int(snap.get("analytics_likes_settled") or 0),
        "analytics_comments_settled": int(snap.get("analytics_comments_settled") or 0),
        "analytics_minutes_watched": mins_watched,
        "analytics_hours_watched": round(mins_watched / 60.0, 2),
        "analytics_avg_view_duration_sec": avg_dur_sec,
        "analytics_subscribers_gained": subs_gained,
        "synced_at": snap.get("synced_at") or mon.get("api_checked_at"),
        "synced_epoch": snap.get("synced_epoch"),
        "studio_channel_url": f"https://studio.youtube.com/channel/{YOUTUBE_CHANNEL_ID}/analytics/tab-overview/period-default",
        "studio_realtime_url": f"https://studio.youtube.com/channel/{YOUTUBE_CHANNEL_ID}/analytics/tab-overview/period-4_weeks",
        "analytics_lag_note": "Video views & likes update live (~5s); YouTube Analytics API watch-time & AVD settle every 24–48h.",
    }


def _with_yt_meta(data: Dict[str, Any], cache_ts: float) -> Dict[str, Any]:
    out = dict(data)
    out["age_sec"] = round(max(0.0, time.time() - cache_ts), 1) if cache_ts > 0 else None
    out["cache_ttl_sec"] = YT_CACHE_TTL_SEC
    if not isinstance(out.get("studio_analytics"), dict):
        out["studio_analytics"] = _build_studio_summary(
            out.get("videos") or [],
            _load_studio_snapshot(),
            mon_snap=_read_json(MONETIZATION_JSON_PATH, {}),
        )
    return out


def _parse_innertube_next(data: Dict[str, Any]) -> Dict[str, Any]:
    contents = (
        data.get("contents", {})
        .get("twoColumnWatchNextResults", {})
        .get("results", {})
        .get("results", {})
        .get("contents", [])
    )
    primary = next(
        (c.get("videoPrimaryInfoRenderer") for c in contents if isinstance(c, dict) and "videoPrimaryInfoRenderer" in c),
        {},
    ) or {}
    secondary = next(
        (c.get("videoSecondaryInfoRenderer") for c in contents if isinstance(c, dict) and "videoSecondaryInfoRenderer" in c),
        {},
    ) or {}

    title = "".join(r.get("text", "") for r in primary.get("title", {}).get("runs", [])).strip()

    vvc = primary.get("viewCount", {}).get("videoViewCountRenderer", {})
    raw_orig = str(vvc.get("originalViewCount") or "").strip()
    simple_views = str(vvc.get("viewCount", {}).get("simpleText") or "").strip()
    views: Optional[int] = None
    if raw_orig.isdigit() and int(raw_orig) > 0:
        views = int(raw_orig)
    elif simple_views:
        if "no views" in simple_views.lower():
            views = 0
        else:
            m_sv = re.search(r"([\d,]+)", simple_views)
            if m_sv:
                views = int(m_sv.group(1).replace(",", ""))
    if views is None and raw_orig.isdigit():
        views = int(raw_orig)

    # Extract exact unrounded likes from engagementPanels (factoidRenderer) first, then primary buttons
    likes: Optional[int] = None
    panels_json = json.dumps(data.get("engagementPanels", []), ensure_ascii=False)
    m_fl = re.search(r'"accessibilityText"\s*:\s*"([\d,]+)\s+likes?\b"', panels_json, re.I)
    if m_fl:
        likes = int(m_fl.group(1).replace(",", ""))
    if likes is None:
        m_fv = re.search(
            r'"label"\s*:\s*"Likes"[^}]*"value"\s*:\s*"([\d,]+)"|"value"\s*:\s*"([\d,]+)"[^}]*"label"\s*:\s*"Likes"',
            panels_json,
        )
        if m_fv:
            likes = int((m_fv.group(1) or m_fv.group(2)).replace(",", ""))

    primary_json = json.dumps(primary, ensure_ascii=False)
    if likes is None:
        for pat in [
            r"like this video along with ([\d,]+) other",
            r'"accessibilityText"\s*:\s*"([\d,]+)\s+likes?\b"',
            r'"likeCount"\s*:\s*(\d+)',
        ]:
            m_l = re.search(pat, primary_json, re.I)
            if m_l:
                likes = int(m_l.group(1).replace(",", ""))
                break
    if likes is None and primary and ("Dislike this video" in primary_json or "likeCountEntity" in primary_json):
        likes = 0

    sub_text = (
        secondary.get("owner", {})
        .get("videoOwnerRenderer", {})
        .get("subscriberCountText", {})
        .get("simpleText", "")
    )
    subs: Optional[str] = None
    m_sub = re.search(r"([\d.,]+[KMB]?)\s+subscriber", sub_text or "", re.I)
    if m_sub:
        subs = m_sub.group(1)

    return {
        "title": title,
        "views": views,
        "likes": likes,
        "subs": subs,
        "has_primary": bool(primary),
    }


def _fetch_watch_metrics(video_id: str, session: Optional[requests.Session] = None) -> Dict[str, Any]:
    url = f"https://www.youtube.com/watch?v={video_id}"
    getter = session or _new_yt_session()
    try:
        resp = getter.get(url, headers=_YT_HEADERS, cookies=_YT_COOKIES, timeout=(3.0, 3.5))
    finally:
        if session is None:
            try:
                getter.close()
            except Exception:
                pass
    html = resp.text

    title_m = re.search(r"<title>(.*?)</title>", html)
    title = html_lib.unescape(title_m.group(1).replace(" - YouTube", "").strip()) if title_m else ""
    play_m = re.search(r'"status":"(.*?)","reason":"(.*?)"', html)
    unavailable = bool(play_m and play_m.group(1) == "ERROR")

    views: Optional[int] = None
    vm = re.search(r'"viewCount":"(\d+)"', html)
    if vm:
        views = int(vm.group(1))

    likes: Optional[int] = None
    for pat in [r'"accessibilityText":"([\d,]+)\s+likes?\b"', r'like this video along with ([\d,]+) other', r'"likeCount":(\d+)']:
        lm = re.search(pat, html, re.I)
        if lm:
            likes = int(lm.group(1).replace(",", ""))
            break

    pub_m = re.search(r'"publishDate":"([^"]+)"', html)
    published_at = pub_m.group(1) if pub_m else None

    dur_m = re.search(r'"lengthSeconds":"(\d+)"', html)
    duration_sec = int(dur_m.group(1)) if dur_m else None

    return {
        "id": video_id,
        "title": title,
        "views": views,
        "likes": likes,
        "published_at": published_at,
        "duration_sec": duration_sec,
        "unavailable": unavailable,
        "thumbnail": f"https://i.ytimg.com/vi/{video_id}/hqdefault.jpg",
        "play_url": f"https://www.youtube.com/watch?v={video_id}",
        "shorts_url": f"https://www.youtube.com/shorts/{video_id}",
    }


def _fetch_video_live_metrics(
    video_id: str,
    session: Optional[requests.Session] = None,
    needs_static_meta: bool = False,
    allow_watch_fallback: bool = False,
    batch_id: Optional[str] = None,
    batch_sessions: Optional[List[requests.Session]] = None,
) -> Dict[str, Any]:
    t0 = time.time()
    created_ephemeral: List[requests.Session] = []
    if session is not None:
        sess = session
    else:
        sess, is_eph = _get_batch_yt_session(batch_id=batch_id, batch_sessions=batch_sessions)
        if is_eph:
            created_ephemeral.append(sess)

    cached_static = _yt_static_meta.get(video_id, {})
    published_at = cached_static.get("published_at")
    duration_sec = cached_static.get("duration_sec")

    try:
        # 1. Fast compact InnerTube JSON via persistent keep-alive worker session (~3.3 KB payload)
        r_next = None
        last_exc: Optional[Exception] = None
        attempt_urls = (
            f"https://www.youtube.com/youtubei/v1/next?prettyPrint=false&$fields={_YT_NEXT_FIELDS}",
            f"https://www.youtube.com/youtubei/v1/next?prettyPrint=false&$fields={_YT_NEXT_FIELDS}",
            f"https://youtubei.googleapis.com/youtubei/v1/next?prettyPrint=false&$fields={_YT_NEXT_FIELDS}",
        )
        for idx, ep_url in enumerate(attempt_urls):
            if idx == 1:
                # Only retry www.youtube.com immediately if attempt 0 died fast on a closed keep-alive socket
                continue
            if idx > 0 and (time.time() - t0) > 4.6:
                break
            req_t0 = time.time()
            try:
                r_next = sess.post(
                    ep_url,
                    json={"context": _INNERTUBE_WEB_CTX, "videoId": video_id},
                    timeout=(4.0, 4.2) if idx == 0 else (3.0, 3.0),
                )
                if r_next.status_code == 200:
                    break
            except Exception as exc:
                last_exc = exc
                req_dt = time.time() - req_t0
                if session is None:
                    if batch_id:
                        _yt_thread_local.batch_session = None
                        sess, _ = _get_batch_yt_session(batch_id=batch_id, batch_sessions=batch_sessions)
                    else:
                        sess = _reset_worker_yt_session()
                # Immediate fast retry on fresh socket if GFE/NAT reset an idle keep-alive socket
                if idx == 0 and req_dt < 0.7 and (time.time() - t0) < 4.0:
                    try:
                        r_next = sess.post(
                            attempt_urls[1],
                            json={"context": _INNERTUBE_WEB_CTX, "videoId": video_id},
                            timeout=(3.0, 3.0),
                        )
                        if r_next.status_code == 200:
                            break
                    except Exception as exc2:
                        last_exc = exc2
                        if session is None and not batch_id:
                            sess = _reset_worker_yt_session()

        if r_next is not None and r_next.status_code == 200:
            parsed = _parse_innertube_next(r_next.json())
            if needs_static_meta and (not published_at or duration_sec is None):
                try:
                    r_pl = sess.post(
                        f"https://www.youtube.com/youtubei/v1/player?prettyPrint=false&$fields={_YT_PLAYER_FIELDS}",
                        json={"context": _INNERTUBE_WEB_CTX, "videoId": video_id},
                        timeout=(2.4, 2.2),
                    )
                    if r_pl.status_code == 200:
                        pl_js = r_pl.json()
                        vd = pl_js.get("videoDetails", {})
                        mc = pl_js.get("microformat", {}).get("playerMicroformatRenderer", {})
                        if str(vd.get("lengthSeconds") or "").isdigit():
                            duration_sec = int(vd["lengthSeconds"])
                        if mc.get("publishDate"):
                            published_at = str(mc["publishDate"])
                        if published_at or duration_sec is not None:
                            _yt_static_meta[video_id] = {
                                "published_at": published_at,
                                "duration_sec": duration_sec,
                            }
                except Exception:
                    pass

            if parsed["views"] is not None or parsed["has_primary"]:
                return {
                    "id": video_id,
                    "title": parsed["title"],
                    "views": parsed["views"],
                    "likes": parsed["likes"],
                    "subs": parsed["subs"],
                    "published_at": published_at,
                    "duration_sec": duration_sec,
                    "unavailable": False,
                    "thumbnail": f"https://i.ytimg.com/vi/{video_id}/hqdefault.jpg",
                    "play_url": f"https://www.youtube.com/watch?v={video_id}",
                    "shorts_url": f"https://www.youtube.com/shorts/{video_id}",
                }

        if not allow_watch_fallback:
            raise last_exc or RuntimeError(f"InnerTube HTTP {getattr(r_next, 'status_code', 'err')} for {video_id}")

        # 2. Fallback to fast single-shot /watch HTML only for unknown cold videos
        live = _fetch_watch_metrics(video_id, session=sess)
        if live.get("published_at") or live.get("duration_sec") is not None:
            _yt_static_meta[video_id] = {
                "published_at": live.get("published_at") or published_at,
                "duration_sec": live.get("duration_sec") if live.get("duration_sec") is not None else duration_sec,
            }
        return live
    finally:
        for es in created_ephemeral:
            try:
                es.close()
            except Exception:
                pass


def _discover_channel_videos(
    session: Optional[requests.Session] = None,
    force: bool = False,
    batch_id: Optional[str] = None,
    batch_sessions: Optional[List[requests.Session]] = None,
) -> Tuple[set[str], List[str], Optional[str], Optional[str]]:
    global _yt_disc_in_flight
    now = time.time()
    with _yt_lock:
        age = now - _yt_discovery_cache["timestamp"]
        if not force and _yt_discovery_cache["timestamp"] > 0 and age < YT_DISCOVERY_TTL_SEC:
            return (
                set(_yt_discovery_cache["shorts"]),
                list(_yt_discovery_cache["extra_ids"]),
                _yt_discovery_cache.get("subscribers"),
                None,
            )

    t0 = time.time()
    created_ephemeral: List[requests.Session] = []
    if session is not None:
        getter = session
    elif batch_id:
        getter, _ = _get_batch_yt_session(batch_id=batch_id, batch_sessions=batch_sessions)
    else:
        getter = _new_yt_session()
        created_ephemeral.append(getter)

    shorts_ids: set[str] = set()
    extra_ids: List[str] = []
    subs_val: Optional[str] = None
    err: Optional[str] = None
    try:
        for idx, ep_url in enumerate((
            "https://www.youtube.com/youtubei/v1/browse?prettyPrint=false",
            "https://youtubei.googleapis.com/youtubei/v1/browse?prettyPrint=false",
        )):
            if idx > 0 and (time.time() - t0) > 3.2:
                break
            try:
                rb = getter.post(
                    ep_url,
                    json={"context": _INNERTUBE_WEB_CTX, "browseId": YOUTUBE_CHANNEL_ID, "params": "EgZzaG9ydHPyBgQKAjoA"},
                    timeout=(3.0, 3.5),
                )
                if rb.status_code == 200:
                    txt = rb.text
                    sub_m = re.search(r"([\d.,]+[KMB]?)\s+subscribers?", txt, re.I)
                    if sub_m:
                        subs_val = sub_m.group(1)
                    for vid in re.findall(r'"(?:videoId|entityId)":"([a-zA-Z0-9_-]{11})"', txt):
                        shorts_ids.add(vid)
                        if vid not in extra_ids:
                            extra_ids.append(vid)
                    err = None
                    break
                else:
                    err = f"browse HTTP {rb.status_code}"
            except Exception as exc:
                err = str(exc)
    finally:
        with _yt_lock:
            _yt_disc_in_flight = False
        for es in created_ephemeral:
            try:
                es.close()
            except Exception:
                pass

    if shorts_ids or subs_val:
        with _yt_lock:
            _yt_discovery_cache["timestamp"] = time.time()
            if shorts_ids:
                _yt_discovery_cache["shorts"].update(shorts_ids)
                _yt_discovery_cache["extra_ids"] = extra_ids
            if subs_val:
                _yt_discovery_cache["subscribers"] = subs_val
        return set(_yt_discovery_cache["shorts"]), extra_ids, subs_val, err

    with _yt_lock:
        return (
            set(_yt_discovery_cache["shorts"]),
            list(_yt_discovery_cache["extra_ids"]),
            _yt_discovery_cache.get("subscribers"),
            err,
        )


def _trigger_bg_discovery_if_stale() -> None:
    global _yt_disc_in_flight
    with _yt_lock:
        age = time.time() - _yt_discovery_cache["timestamp"] if _yt_discovery_cache["timestamp"] > 0 else 999999.0
        if _yt_disc_in_flight or age < YT_DISCOVERY_TTL_SEC:
            return
        _yt_disc_in_flight = True

    def _run_disc() -> None:
        try:
            _discover_channel_videos(session=None, force=True)
        except Exception:
            with _yt_lock:
                global _yt_disc_in_flight
                _yt_disc_in_flight = False

    threading.Thread(target=_run_disc, daemon=True, name="yt-bg-discover").start()


def _merged_baseline_meta(
    runs_data: Optional[Dict[str, Any]] = None,
    studio_snap: Optional[Dict[str, Any]] = None,
) -> Dict[str, Dict[str, Any]]:
    merged: Dict[str, Dict[str, Any]] = {vid: dict(meta) for vid, meta in BASELINE_VIDEO_META.items()}
    snap = studio_snap if studio_snap is not None else _load_studio_snapshot()
    studio_videos = snap.get("videos", {}) if isinstance(snap, dict) else {}
    if isinstance(studio_videos, dict):
        for vid, sv in studio_videos.items():
            if not isinstance(sv, dict) or not vid:
                continue
            cur = merged.get(vid, {})
            sv_views = int(sv.get("views") or 0)
            cur_views = int(cur.get("views") or 0)
            merged[vid] = {
                "title": sv.get("title") or cur.get("title") or vid,
                "publishedAt": sv.get("published_at") or cur.get("publishedAt"),
                "duration": sv.get("duration") or cur.get("duration") or "0:45",
                "duration_sec": sv.get("duration_sec") if sv.get("duration_sec") is not None else cur.get("duration_sec"),
                "is_short": bool(sv.get("is_short", cur.get("is_short", True))),
                "views": max(sv_views, cur_views),
                "likes": int(sv.get("likes") if sv.get("likes") is not None else cur.get("likes", 0)),
                "comments": int(sv.get("comments") if sv.get("comments") is not None else cur.get("comments", 0)),
                "analytics_views": sv.get("analytics_views"),
                "analytics_minutes_watched": sv.get("analytics_minutes_watched"),
                "analytics_avg_view_duration": sv.get("analytics_avg_view_duration"),
            }

    data = runs_data if runs_data is not None else _read_json(RUNS_JSON_PATH, {"runs": []})
    for r in data.get("runs", []):
        yid = r.get("youtube_id")
        if yid and (r.get("status") == "published" or r.get("published_at")) and yid not in merged:
            dur_s = r.get("rendered_duration_sec")
            dur_str = f"{int(dur_s) // 60}:{int(round(dur_s)) % 60:02d}" if isinstance(dur_s, (int, float)) and dur_s > 0 else "0:45"
            merged[yid] = {
                "title": r.get("youtube_title") or r.get("title") or yid,
                "publishedAt": r.get("published_at") or r.get("created_at"),
                "duration": dur_str,
                "duration_sec": int(round(dur_s)) if isinstance(dur_s, (int, float)) and dur_s > 0 else None,
                "is_short": True,
                "views": 0,
                "likes": 0,
                "comments": 0,
            }
    return merged


def _build_baseline_yt() -> Dict[str, Any]:
    studio_snap = _load_studio_snapshot()
    mon_snap = _read_json(MONETIZATION_JSON_PATH, {}) or {}
    baseline_map = _merged_baseline_meta(studio_snap=studio_snap)
    videos_list = []
    for vid, base in baseline_map.items():
        views = int(base.get("views") or 0)
        likes = int(base.get("likes") or 0)
        videos_list.append(
            {
                "id": vid,
                "title": base["title"],
                "views": views,
                "likes": likes,
                "comments": int(base.get("comments") or 0),
                "published_at": base.get("publishedAt"),
                "duration": base.get("duration", "0:45"),
                "duration_sec": base.get("duration_sec"),
                "is_short": base.get("is_short", True),
                "analytics_views": base.get("analytics_views"),
                "analytics_minutes_watched": base.get("analytics_minutes_watched"),
                "analytics_avg_view_duration": base.get("analytics_avg_view_duration"),
                "thumbnail": f"https://i.ytimg.com/vi/{vid}/hqdefault.jpg",
                "play_url": f"https://www.youtube.com/watch?v={vid}",
                "shorts_url": f"https://www.youtube.com/shorts/{vid}",
                "studio_url": f"https://studio.youtube.com/video/{vid}/analytics/tab-overview/period-default",
                "engagement_pct": round((likes / views * 100), 1) if views > 0 else 0.0,
            }
        )
    videos_list.sort(key=lambda x: str(x.get("published_at") or ""), reverse=True)
    total_views = sum(v["views"] for v in videos_list)
    total_likes = sum(v["likes"] for v in videos_list)
    total_comments = sum(v["comments"] for v in videos_list)
    subs = str(studio_snap.get("subscribers") or "8")
    return {
        "channel_id": YOUTUBE_CHANNEL_ID,
        "channel_title": YOUTUBE_CHANNEL_TITLE,
        "channel_url": f"https://www.youtube.com/channel/{YOUTUBE_CHANNEL_ID}",
        "zapier_connected": True,
        "live_fetched": False,
        "fetch_error": None,
        "fetched_at": datetime.now().astimezone().isoformat(timespec="seconds"),
        "fetched_epoch": round(time.time(), 3),
        "age_sec": None,
        "cache_ttl_sec": YT_CACHE_TTL_SEC,
        "summary": {
            "total_videos": len(videos_list),
            "shorts_count": sum(1 for v in videos_list if v["is_short"]),
            "long_count": sum(1 for v in videos_list if not v["is_short"]),
            "subscribers": subs,
            "total_views": total_views,
            "total_likes": total_likes,
            "total_comments": total_comments,
            "avg_views": round(total_views / len(videos_list), 1) if videos_list else 0.0,
            "engagement_rate": round((total_likes / total_views * 100), 2) if total_views > 0 else 0.0,
        },
        "studio_analytics": _build_studio_summary(videos_list, studio_snap, mon_snap=mon_snap),
        "top_video": max(videos_list, key=lambda x: x["views"]) if videos_list else None,
        "videos": videos_list,
    }


def _refresh_youtube_analytics_sync(force_discovery: bool = False) -> Dict[str, Any]:
    global _yt_in_flight, _yt_live_in_ram
    t_start = time.time()
    videos_map: Dict[str, Dict[str, Any]] = {}
    fetch_error: Optional[str] = None
    live_online = False

    runs_data = _read_json(RUNS_JSON_PATH, {"runs": []})
    studio_snap = _load_studio_snapshot()
    studio_videos = studio_snap.get("videos", {}) if isinstance(studio_snap.get("videos"), dict) else {}
    mon_snap = _read_json(MONETIZATION_JSON_PATH, {}) or {}
    baseline_map = _merged_baseline_meta(runs_data, studio_snap=studio_snap)

    with _yt_lock:
        prev_snapshot = _yt_cache["data"] or _load_disk_yt_cache()
        disc_age = time.time() - _yt_discovery_cache["timestamp"] if _yt_discovery_cache["timestamp"] > 0 else 999999.0
        cached_shorts = set(_yt_discovery_cache["shorts"])
        cached_subs = _yt_discovery_cache.get("subscribers")
    prev_by_id = {v["id"]: v for v in (prev_snapshot or {}).get("videos", []) if isinstance(v, dict) and v.get("id")}
    prev_epoch = float((prev_snapshot or {}).get("fetched_epoch") or 0.0)
    studio_epoch = float(studio_snap.get("synced_epoch") or 0.0)
    prev_subs = (prev_snapshot or {}).get("summary", {}).get("subscribers") or studio_snap.get("subscribers") or cached_subs or "8"

    seed_ids: List[str] = list(baseline_map.keys())
    for vid_st in studio_videos:
        if vid_st not in seed_ids:
            seed_ids.append(vid_st)
    for vid_prev in prev_by_id:
        if vid_prev not in seed_ids:
            seed_ids.append(vid_prev)
    for r in runs_data.get("runs", []):
        yid = r.get("youtube_id")
        if yid and yid not in seed_ids:
            seed_ids.append(yid)
    job_snap = _read_json(UPLOAD_JOB_PATH, None)
    if isinstance(job_snap, dict):
        j_yid = job_snap.get("youtube_id")
        if j_yid and j_yid not in seed_ids:
            seed_ids.append(j_yid)

    discovered_shorts: set[str] = set(cached_shorts)
    subscribers_display: str = str(prev_subs or "8")
    v3_data: Optional[Dict[str, Any]] = None
    batch_id = f"{t_start:.6f}-{threading.get_ident()}"
    batch_sessions: List[requests.Session] = []

    try:
        # Path A: Official YouTube Studio Data API v3 / OAuth (<0.4s batch call when configured)
        try:
            v3_data = _fetch_via_youtube_data_api_v3(seed_ids, force_discovery=force_discovery)
        except Exception as exc:
            v3_data = None
            fetch_error = f"API v3 fallback: {exc}"

        if v3_data and isinstance(v3_data.get("videos"), dict) and v3_data["videos"]:
            for vid, item in v3_data["videos"].items():
                st_v = studio_videos.get(vid, {}) if isinstance(studio_videos.get(vid), dict) else {}
                item["analytics_views"] = st_v.get("analytics_views")
                item["analytics_minutes_watched"] = st_v.get("analytics_minutes_watched")
                item["analytics_avg_view_duration"] = st_v.get("analytics_avg_view_duration")
                item["studio_url"] = f"https://studio.youtube.com/video/{vid}/analytics/tab-overview/period-default"
                videos_map[vid] = item
            if v3_data.get("subscribers"):
                subscribers_display = str(v3_data["subscribers"])
            live_online = True
        else:
            # Path B: Persistent keep-alive InnerTube workers ($fields=~3.3KB) + Studio merge + strict budget
            pool = _get_yt_executor()
            need_discovery = bool(force_discovery)

            def _fallback_video_item(vid: str, err_msg: Optional[str] = None) -> Optional[Dict[str, Any]]:
                base = baseline_map.get(vid, {})
                prev_v = prev_by_id.get(vid, {})
                st_v = studio_videos.get(vid, {}) if isinstance(studio_videos.get(vid), dict) else {}
                fallback_source = st_v if (studio_epoch > prev_epoch and st_v) else (prev_v or st_v or base)
                if not fallback_source:
                    return None
                views = int(fallback_source.get("views", 0))
                likes = int(fallback_source.get("likes", 0))
                out: Dict[str, Any] = {
                    "id": vid,
                    "title": fallback_source.get("title", vid),
                    "views": views,
                    "likes": likes,
                    "comments": int(st_v.get("comments") if st_v.get("comments") is not None else fallback_source.get("comments", 0)),
                    "published_at": fallback_source.get("published_at") or fallback_source.get("publishedAt"),
                    "duration": fallback_source.get("duration", "0:45"),
                    "duration_sec": fallback_source.get("duration_sec"),
                    "is_short": (vid in discovered_shorts) or fallback_source.get("is_short", True),
                    "analytics_views": st_v.get("analytics_views", fallback_source.get("analytics_views")),
                    "analytics_minutes_watched": st_v.get("analytics_minutes_watched", fallback_source.get("analytics_minutes_watched")),
                    "analytics_avg_view_duration": st_v.get("analytics_avg_view_duration", fallback_source.get("analytics_avg_view_duration")),
                    "thumbnail": f"https://i.ytimg.com/vi/{vid}/hqdefault.jpg",
                    "play_url": f"https://www.youtube.com/watch?v={vid}",
                    "shorts_url": f"https://www.youtube.com/shorts/{vid}",
                    "studio_url": f"https://studio.youtube.com/video/{vid}/analytics/tab-overview/period-default",
                    "engagement_pct": round((likes / views * 100), 1) if views > 0 else 0.0,
                }
                if err_msg:
                    out["_err"] = err_msg
                return out

            def _load_one(vid: str):
                base = baseline_map.get(vid, {})
                prev_v = prev_by_id.get(vid, {})
                st_v = studio_videos.get(vid, {}) if isinstance(studio_videos.get(vid), dict) else {}
                needs_static = not (base.get("publishedAt") or prev_v.get("published_at") or st_v.get("published_at"))
                allow_watch = not bool(prev_v or base or st_v)
                try:
                    live = _fetch_video_live_metrics(
                        vid,
                        session=None,
                        needs_static_meta=needs_static,
                        allow_watch_fallback=allow_watch,
                    )
                    if live.get("unavailable"):
                        return None, True
                    fallback_src = st_v if (studio_epoch > prev_epoch and st_v) else (prev_v or st_v or base)
                    fallback_views = int(fallback_src.get("views") or 0)
                    fallback_likes = int(fallback_src.get("likes") or 0)

                    raw_views = live.get("views")
                    if raw_views is None:
                        views = fallback_views
                    elif raw_views == 0 and fallback_views > 5:
                        views = fallback_views
                    else:
                        views = int(raw_views)
                        if st_v and studio_epoch > (time.time() - 120) and int(st_v.get("views") or 0) > views:
                            views = int(st_v["views"])

                    raw_likes = live.get("likes")
                    likes = fallback_likes if raw_likes is None else int(raw_likes)

                    dur_sec = live.get("duration_sec")
                    if dur_sec is None:
                        dur_sec = (
                            st_v.get("duration_sec")
                            if st_v.get("duration_sec") is not None
                            else (prev_v.get("duration_sec") if prev_v.get("duration_sec") is not None else base.get("duration_sec"))
                        )
                    dur_text = (
                        f"{dur_sec // 60}:{dur_sec % 60:02d}"
                        if dur_sec is not None
                        else (st_v.get("duration") or prev_v.get("duration") or base.get("duration") or "0:45")
                    )
                    comments_val = int(
                        st_v.get("comments")
                        if st_v.get("comments") is not None
                        else (prev_v.get("comments") if prev_v.get("comments") is not None else base.get("comments", 0))
                    )
                    return (
                        {
                            "id": vid,
                            "title": live.get("title") or st_v.get("title") or prev_v.get("title") or base.get("title", vid),
                            "views": views,
                            "likes": likes,
                            "comments": comments_val,
                            "published_at": live.get("published_at") or st_v.get("published_at") or prev_v.get("published_at") or base.get("publishedAt"),
                            "duration": dur_text,
                            "duration_sec": dur_sec,
                            "is_short": (vid in discovered_shorts)
                            or (dur_sec is not None and dur_sec <= 65)
                            or prev_v.get("is_short", st_v.get("is_short", base.get("is_short", True))),
                            "analytics_views": st_v.get("analytics_views", prev_v.get("analytics_views")),
                            "analytics_minutes_watched": st_v.get("analytics_minutes_watched", prev_v.get("analytics_minutes_watched")),
                            "analytics_avg_view_duration": st_v.get("analytics_avg_view_duration", prev_v.get("analytics_avg_view_duration")),
                            "thumbnail": live["thumbnail"],
                            "play_url": live["play_url"],
                            "shorts_url": live["shorts_url"],
                            "studio_url": f"https://studio.youtube.com/video/{vid}/analytics/tab-overview/period-default",
                            "engagement_pct": round((likes / views * 100), 1) if views > 0 else 0.0,
                            "_subs": live.get("subs"),
                        },
                        raw_views is not None,
                    )
                except Exception as exc:
                    return _fallback_video_item(vid, str(exc)), False

            def _ingest_result(item: Optional[Dict[str, Any]], was_live: bool) -> None:
                nonlocal subscribers_display, fetch_error, live_online
                if not item:
                    return
                item_subs = item.pop("_subs", None)
                item_err = item.pop("_err", None)
                if item_subs and was_live:
                    subscribers_display = item_subs
                if item_err and not fetch_error:
                    fetch_error = item_err
                if item["id"] in discovered_shorts:
                    item["is_short"] = True
                videos_map[item["id"]] = item
                if was_live:
                    live_online = True

            def _collect_futures(futs_map: Dict[Any, str], budget_sec: float) -> None:
                nonlocal fetch_error
                try:
                    for fut in as_completed(futs_map.keys(), timeout=max(0.5, budget_sec)):
                        try:
                            item, was_live = fut.result()
                        except Exception as exc:
                            vid_f = futs_map[fut]
                            item, was_live = _fallback_video_item(vid_f, str(exc)), False
                        _ingest_result(item, was_live)
                except FuturesTimeoutError:
                    if not fetch_error:
                        fetch_error = f"partial batch timeout (>{budget_sec:.1f}s)"
                for fut, vid in futs_map.items():
                    if vid in videos_map:
                        continue
                    if fut.done() and not fut.cancelled():
                        try:
                            item, was_live = fut.result(timeout=0.02)
                            _ingest_result(item, was_live)
                            continue
                        except Exception:
                            pass
                    else:
                        fut.cancel()
                    fb = _fallback_video_item(vid, "timed out waiting for YouTube socket")
                    _ingest_result(fb, False)

            extra_ids: List[str] = []
            seed_futs = {pool.submit(_load_one, vid): vid for vid in seed_ids[:20]}
            f_disc = (
                pool.submit(_discover_channel_videos, None, force_discovery, batch_id, batch_sessions)
                if need_discovery
                else None
            )

            batch_budget = 13.0 if not _yt_live_in_ram else 7.6
            _collect_futures(seed_futs, budget_sec=batch_budget)
            if not need_discovery and live_online:
                _trigger_bg_discovery_if_stale()

            if f_disc is not None:
                try:
                    rem_disc = max(0.8, 7.8 - (time.time() - t_start))
                    d_shorts, d_extra, d_subs, d_err = f_disc.result(timeout=rem_disc)
                    discovered_shorts.update(d_shorts)
                    for vid in discovered_shorts:
                        if vid in videos_map:
                            videos_map[vid]["is_short"] = True
                    if d_subs:
                        subscribers_display = d_subs
                        live_online = True
                    if d_err and not fetch_error:
                        fetch_error = d_err
                    for vid in d_extra:
                        if vid not in seed_ids and vid not in extra_ids:
                            extra_ids.append(vid)
                except Exception as exc:
                    if not fetch_error:
                        fetch_error = f"discovery timeout: {exc}"

            if extra_ids:
                extra_futs = {pool.submit(_load_one, vid): vid for vid in extra_ids[: max(0, 20 - len(seed_futs))]}
                if extra_futs:
                    _collect_futures(extra_futs, budget_sec=max(1.0, 7.2 - (time.time() - t_start)))

        videos_list = sorted(
            videos_map.values(),
            key=lambda x: str(x.get("published_at") or ""),
            reverse=True,
        )

        total_views = sum(v["views"] for v in videos_list)
        total_likes = sum(v["likes"] for v in videos_list)
        total_comments = sum(int(v.get("comments") or 0) for v in videos_list)
        avg_views = round(total_views / len(videos_list), 1) if videos_list else 0.0
        engagement_rate = round((total_likes / total_views * 100), 2) if total_views > 0 else 0.0
        top_video = max(videos_list, key=lambda x: x["views"]) if videos_list else None
        now_ts = time.time()

        studio_summary = _build_studio_summary(videos_list, studio_snap, api_v3_meta=v3_data, mon_snap=mon_snap)
        result = {
            "channel_id": YOUTUBE_CHANNEL_ID,
            "channel_title": YOUTUBE_CHANNEL_TITLE,
            "channel_url": f"https://www.youtube.com/channel/{YOUTUBE_CHANNEL_ID}",
            "zapier_connected": True,
            "live_fetched": live_online,
            "fetch_error": None if live_online else fetch_error,
            "fetched_at": datetime.now().astimezone().isoformat(timespec="seconds"),
            "fetched_epoch": round(now_ts, 3),
            "fetch_ms": round((now_ts - t_start) * 1000),
            "age_sec": 0.0,
            "cache_ttl_sec": YT_CACHE_TTL_SEC,
            "summary": {
                "total_videos": len(videos_list),
                "shorts_count": sum(1 for v in videos_list if v["is_short"]),
                "long_count": sum(1 for v in videos_list if not v["is_short"]),
                "subscribers": subscribers_display,
                "total_views": total_views,
                "total_likes": total_likes,
                "total_comments": total_comments,
                "avg_views": avg_views,
                "engagement_rate": engagement_rate,
            },
            "studio_analytics": studio_summary,
            "top_video": top_video,
            "videos": videos_list,
        }

        if live_online and not CLOUD_MODE and videos_list:
            try:
                _write_json_atomic(YT_LIVE_CACHE_PATH, result)
            except Exception:
                pass

        with _yt_lock:
            if live_online:
                _yt_live_in_ram = True
            prev_cached = _yt_cache["data"]
            prev_ts = float(_yt_cache["timestamp"] or 0.0)
            keep_prev_live = (
                not live_online
                and prev_cached is not None
                and prev_cached.get("live_fetched")
                and prev_ts > 0.0
                and (now_ts - prev_ts) < 30.0
            )
            if keep_prev_live:
                result_out = _with_yt_meta(prev_cached, prev_ts)
            else:
                _yt_cache["timestamp"] = now_ts if (live_online or prev_ts == 0.0) else prev_ts
                _yt_cache["data"] = result
                result_out = result
        return result_out
    finally:
        with _yt_lock:
            sessions_to_close = list(batch_sessions)
            batch_sessions.clear()
            _yt_in_flight = False
            _yt_done_cond.notify_all()
        for bs in sessions_to_close:
            try:
                bs.close()
            except Exception:
                pass


def fetch_youtube_analytics(force: bool = False, manual: bool = False, discover: bool = False) -> Dict[str, Any]:
    global _yt_in_flight
    now = time.time()
    run_sync = False

    with _yt_lock:
        if _yt_cache["data"] is None:
            disk_seed = _load_disk_yt_cache()
            if disk_seed is not None:
                _yt_cache["data"] = {**disk_seed, "live_fetched": False}
                _yt_cache["timestamp"] = 0.0

        cached = _yt_cache["data"]
        ts = _yt_cache["timestamp"]
        age = (now - ts) if ts > 0 else 999999.0
        stale = age >= YT_CACHE_TTL_SEC
        is_cached_live = bool(cached is not None and cached.get("live_fetched"))
        fresh_enough = is_cached_live and (age < (1.0 if manual else YT_CACHE_TTL_SEC))

        if force and fresh_enough and not discover:
            return _with_yt_meta(cached, ts)
        if not force and cached is not None and not stale:
            return _with_yt_meta(cached, ts)

        if not force and not IS_VERCEL:
            if not _yt_in_flight:
                _yt_in_flight = True
                threading.Thread(
                    target=_refresh_youtube_analytics_sync,
                    kwargs={"force_discovery": bool(discover)},
                    daemon=True,
                ).start()
            return _with_yt_meta(cached, ts) if cached is not None else _build_baseline_yt()

        if IS_VERCEL:
            if _yt_in_flight:
                deadline = time.time() + 14.0
                while _yt_in_flight:
                    rem = deadline - time.time()
                    if rem <= 0:
                        break
                    _yt_done_cond.wait(timeout=rem)
                latest = _yt_cache["data"]
                latest_ts = _yt_cache["timestamp"]
                return _with_yt_meta(latest, latest_ts) if latest is not None else _build_baseline_yt()
            _yt_in_flight = True
            run_sync = True
        else:
            if not _yt_in_flight:
                _yt_in_flight = True
                threading.Thread(
                    target=_refresh_youtube_analytics_sync,
                    kwargs={"force_discovery": bool(discover)},
                    daemon=True,
                ).start()
            wait_sec = 13.5 if (not is_cached_live or not _yt_live_in_ram) else (8.0 if (manual or age >= 25.0) else 7.8)
            deadline = time.time() + wait_sec
            while _yt_in_flight:
                rem = deadline - time.time()
                if rem <= 0:
                    break
                _yt_done_cond.wait(timeout=rem)
            latest = _yt_cache["data"]
            latest_ts = _yt_cache["timestamp"]
            if latest is not None:
                return _with_yt_meta(latest, latest_ts)
            return _build_baseline_yt()

    if run_sync:
        return _refresh_youtube_analytics_sync(force_discovery=bool(discover))
    return _build_baseline_yt()


def get_projects_pipeline(yt_data: Dict[str, Any], active_project: Optional[str] = None) -> List[Dict[str, Any]]:
    runs_data = _read_json(RUNS_JSON_PATH, {"runs": []})
    runs_by_slug = {r["slug"]: r for r in runs_data.get("runs", []) if r.get("slug")}
    yt_by_id = {v["id"]: v for v in yt_data.get("videos", [])}

    projects: List[Dict[str, Any]] = []
    seen_slugs = set()
    dirs = []
    for r_root in (D_PROJECTS_ROOT, LOCAL_PROJECTS_ROOT, CLOUD_DATA_DIR if CLOUD_MODE else None):
        if r_root and r_root.exists():
            for d in r_root.iterdir():
                if d.is_dir() and not d.name.startswith(".") and d.name not in EXCLUDED_DIRS and d.name not in seen_slugs:
                    dirs.append(d)
                    seen_slugs.add(d.name)

    now = time.time()
    for proj_dir in dirs:
        slug = proj_dir.name
        if not ((proj_dir / "script.json").exists() or (proj_dir / "index.html").exists() or slug in runs_by_slug):
            continue

        run_meta = runs_by_slug.get(slug, {})
        script = _read_json(proj_dir / "script.json", {})
        words = _read_json(proj_dir / "data" / "words.json", [])
        lines_obj = _read_json(proj_dir / "data" / "lines.json", {})
        cues_obj = _read_json(proj_dir / "data" / "cues.json", {})
        lines_list = lines_obj.get("lines", []) if isinstance(lines_obj, dict) else (lines_obj if isinstance(lines_obj, list) else [])
        cues_list = cues_obj.get("cues", []) if isinstance(cues_obj, dict) else (cues_obj if isinstance(cues_obj, list) else [])
        lines_duration = lines_obj.get("duration") if isinstance(lines_obj, dict) else None

        narration_wav = proj_dir / "data" / "narration.wav"
        mix_wav = proj_dir / "data" / "mix.wav"
        shots_js = proj_dir / "src" / "shots.js"
        index_html = proj_dir / "index.html"

        declared_video = run_meta.get("video_file")
        mp4_path = find_project_mp4(slug, declared_video)
        if not mp4_path:
            renders_dir = proj_dir / "renders"
            mp4_files = sorted(renders_dir.glob("*.mp4"), key=lambda p: p.stat().st_mtime, reverse=True) if renders_dir.exists() else []
            if declared_video and (proj_dir / declared_video).exists():
                mp4_path = proj_dir / declared_video
            elif mp4_files:
                mp4_path = mp4_files[0]

        mp4_size = mp4_path.stat().st_size if mp4_path and mp4_path.exists() else 0
        mp4_is_actively_writing = bool(mp4_path and mp4_path.exists() and (now - mp4_path.stat().st_mtime) < 35)
        mp4_ready = bool(mp4_path and mp4_size > 100_000 and not mp4_is_actively_writing)

        sheet_path = proj_dir / "review" / "all.jpg"
        cover_dir = proj_dir / "review" / "cover"
        cover_files = sorted(cover_dir.glob("*.jpg"), key=lambda p: p.stat().st_mtime, reverse=True) if cover_dir.exists() else []
        cover_path = cover_files[0] if cover_files else None

        youtube_id = run_meta.get("youtube_id")
        yt_video = yt_by_id.get(youtube_id) if youtube_id else None
        is_posted = yt_video is not None or run_meta.get("status") == "published"

        voice_dur = _wav_duration(narration_wav)
        mix_dur = _wav_duration(mix_wav)
        snapshot_ready = bool(CLOUD_MODE and run_meta.get("mp4_ready_snapshot"))
        effective_mp4_ready = mp4_ready or snapshot_ready
        eff_mp4_name = mp4_path.name if (mp4_path and mp4_path.exists()) else run_meta.get("rendered_mp4_name")
        eff_mp4_size_mb = (
            round(mp4_size / (1024 * 1024), 2)
            if mp4_size
            else run_meta.get("rendered_size_mb")
        )

        stages = [
            {"key": "scaffold", "label": "Setup", "done": (index_html.exists() and (proj_dir / "src" / "main.js").exists()) or snapshot_ready or is_posted},
            {"key": "script", "label": "Script", "done": bool(script.get("lines"))},
            {"key": "voice", "label": "AI Voice", "done": narration_wav.exists() or snapshot_ready or is_posted},
            {"key": "words", "label": "Subtitles", "done": isinstance(words, list) and len(words) > 0},
            {"key": "scenes", "label": "3D Shots", "done": (shots_js.exists() and (proj_dir / "data" / "cues.json").exists()) or snapshot_ready or is_posted},
            {"key": "mix", "label": "Audio Mix", "done": mix_wav.exists() or snapshot_ready or is_posted},
            {"key": "render", "label": "MP4 Render", "done": effective_mp4_ready},
            {"key": "youtube", "label": "YouTube", "done": is_posted},
        ]

        done_count = sum(1 for s in stages if s["done"])
        progress_pct = round(done_count / len(stages) * 100)

        q_status = run_meta.get("status") or "draft"
        q_order = run_meta.get("queue_order")

        if is_posted:
            status_badge = "posted"
            status_text = "Posted on YouTube"
            queue_status = "published"
        elif q_status == "queued" and effective_mp4_ready:
            status_badge = "queued"
            status_text = f"Queue #{q_order or '?'} · Ready for Upload"
            queue_status = "queued"
        elif mp4_is_actively_writing or active_project == slug or q_status == "running":
            status_badge = "processing"
            status_text = f"Rendering MP4 ({round(mp4_size / (1024 * 1024), 1)} MB)..." if mp4_is_actively_writing else "Processing Assets..."
            queue_status = "queued" if q_status == "queued" else "processing"
        elif q_status == "queued":
            status_badge = "processing"
            status_text = f"Queue #{q_order or '?'} · Preparing Render"
            queue_status = "queued"
        elif effective_mp4_ready:
            status_badge = "ready"
            status_text = "Rendered — Ready for Manual Upload"
            queue_status = "ready"
        elif done_count >= 4:
            status_badge = "draft"
            status_text = "Assets In Progress"
            queue_status = "draft"
        else:
            status_badge = "draft"
            status_text = "Initialized"
            queue_status = "draft"

        raw_lines = script.get("lines", [])
        script_lines = []
        for idx, sl in enumerate(raw_lines):
            timing_line = lines_list[idx] if idx < len(lines_list) and isinstance(lines_list[idx], dict) else {}
            script_lines.append(
                {
                    "index": idx + 1,
                    "text": sl.get("text", ""),
                    "caps": sl.get("caps"),
                    "start": timing_line.get("start"),
                    "end": timing_line.get("end"),
                }
            )
        full_script_text = "\n".join(sl.get("text", "") for sl in raw_lines if sl.get("text"))
        sources = script.get("sources", [])
        yt_meta = _build_default_metadata(slug, script, run_meta)

        word_count = len(words) if isinstance(words, list) and words else sum(len(l.get("text", "").split()) for l in raw_lines)
        hook_text = raw_lines[0].get("text", "") if raw_lines else ""

        projects.append(
            {
                "slug": slug,
                "title": script.get("title") or run_meta.get("title") or slug,
                "style": run_meta.get("style", "tall-tale"),
                "voice": script.get("voice", "am_michael"),
                "music": script.get("music", "bounce"),
                "hook_text": hook_text,
                "line_count": len(raw_lines),
                "word_count": word_count,
                "cues_count": len(cues_list),
                "duration_sec": mix_dur or voice_dur or lines_duration or run_meta.get("rendered_duration_sec") or (lines_list[-1].get("end") if lines_list else None),
                "updated_at": _file_mtime_iso(mp4_path or mix_wav or narration_wav or (proj_dir / "script.json") or proj_dir),
                "published_at": run_meta.get("published_at") or (yt_video.get("published_at") if yt_video else None),
                "stages": stages,
                "done_count": done_count,
                "total_stages": len(stages),
                "progress_pct": progress_pct,
                "status_badge": status_badge,
                "status_text": status_text,
                "queue_status": queue_status,
                "queue_order": q_order if not is_posted and queue_status == "queued" else None,
                "ready_to_upload": effective_mp4_ready and not is_posted,
                "script_ready": bool(raw_lines),
                "full_script_text": full_script_text,
                "script_lines": script_lines,
                "sources": sources,
                "youtube_title": yt_meta["youtube_title"],
                "youtube_description": yt_meta["youtube_description"],
                "youtube_tags": yt_meta["youtube_tags"],
                "privacy_status": yt_meta["privacy_status"],
                "category_id": yt_meta["category_id"],
                "mp4_url": f"/media/{slug}/renders/{mp4_path.name}" if (mp4_path and mp4_path.exists()) else None,
                "mp4_name": eff_mp4_name,
                "mp4_size_mb": eff_mp4_size_mb,
                "mp4_ready": effective_mp4_ready,
                "narration_url": f"/media/{slug}/data/narration.wav" if narration_wav.exists() else None,
                "sheet_url": f"/media/{slug}/review/all.jpg" if sheet_path.exists() else None,
                "cover_url": f"/media/{slug}/review/cover/{cover_path.name}" if cover_path else None,
                "is_posted": is_posted,
                "youtube": yt_video
                or (
                    {
                        "id": youtube_id,
                        "play_url": run_meta.get("youtube_url"),
                        "title": run_meta.get("youtube_title") or script.get("title"),
                        "views": None,
                        "likes": None,
                    }
                    if youtube_id
                    else None
                ),
                "notes": run_meta.get("notes"),
            }
        )

    def _sort_key(p: Dict[str, Any]):
        if p["queue_status"] == "queued":
            return (0, p["queue_order"] if p["queue_order"] is not None else 9999, p["slug"])
        if p["ready_to_upload"]:
            return (1, 0, p["slug"])
        if p["is_posted"]:
            return (3, 0, p["slug"])
        return (2, 0, p["slug"])

    projects.sort(key=_sort_key)
    return projects


def _kill_proc_tree(proc: Optional[subprocess.Popen]) -> None:
    if proc is None:
        return
    try:
        if proc.poll() is None:
            if os.name == "nt":
                subprocess.run(
                    ["taskkill", "/F", "/T", "/PID", str(proc.pid)],
                    stdout=subprocess.DEVNULL,
                    stderr=subprocess.DEVNULL,
                    timeout=5,
                    creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
                )
            else:
                proc.kill()
    except Exception:
        try:
            proc.kill()
        except Exception:
            pass


def _is_job_cancelled(job_id: Optional[str]) -> bool:
    if not job_id:
        return False
    if job_id in _cancelled_jobs:
        return True
    cur = _read_json(UPLOAD_JOB_PATH, None)
    if not cur or cur.get("job_id") != job_id or cur.get("status") == "cancelled":
        return True
    return False


def _verify_staged_url_sync(url: str) -> Tuple[bool, str]:
    if not url or not url.startswith("http"):
        return False, "Invalid staged URL"
    try:
        res = subprocess.run(
            [
                "curl.exe",
                "-4",
                "-sSL",
                "-r",
                "0-31",
                "--max-time",
                "20",
                "-A",
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/126.0.0.0",
                "-o",
                os.devnull,
                "-w",
                "%{http_code} %{content_type}",
                url,
            ],
            capture_output=True,
            text=True,
            timeout=25,
            creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
        )
        parts = (res.stdout or "").strip().split(None, 1)
        code = int(parts[0]) if parts and parts[0].isdigit() else 0
        ctype = (parts[1] if len(parts) > 1 else "").lower()
        if code in (200, 206) and "text/html" not in ctype:
            return True, f"HTTP {code}"
        head = requests.head(url, timeout=15, allow_redirects=True)
        h_ct = (head.headers.get("content-type") or "").lower()
        if head.status_code < 400 and "text/html" not in h_ct:
            return True, f"HTTP {head.status_code}"
        return False, f"HTTP {code or head.status_code} ({ctype or h_ct or 'unknown'})"
    except Exception as exc:
        return False, str(exc)


def _scan_transcript_for_upload(conv_id: str) -> Dict[str, Any]:
    """Scan all transcript steps for YouTube publish completion, errors, or live activity."""
    tpath = BRAIN_DIR / conv_id / ".system_generated" / "logs" / "transcript.jsonl"
    if not tpath.exists():
        return {"exists": False}
    try:
        mtime = tpath.stat().st_mtime
        lines = tpath.read_text(encoding="utf-8", errors="replace").splitlines()
        youtube_id: Optional[str] = None
        last_error: Optional[str] = None
        last_type: Optional[str] = None
        last_status: Optional[str] = None
        last_text: str = ""
        last_tool: Optional[str] = None

        for raw in lines:
            if not raw.strip():
                continue
            try:
                step = json.loads(raw)
            except Exception:
                continue
            last_type = step.get("type")
            last_status = step.get("status")
            idx = step.get("step_index", 0)
            content = str(step.get("content") or "")
            if last_type == "PLANNER_RESPONSE" and content:
                last_text = content
            for tc in step.get("tool_calls") or []:
                last_tool = tc.get("name") or last_tool
            if idx == 0:
                continue

            m_watch = re.search(r"https?://(?:www\.)?youtube\.com/watch\?v=([a-zA-Z0-9_-]{11})", content)
            if m_watch:
                youtube_id = m_watch.group(1)
            elif '"uploadStatus":"uploaded"' in content or '"play_url"' in content:
                m_json_id = re.search(r'"id"\s*:\s*"([a-zA-Z0-9_-]{11})"', content)
                if m_json_id:
                    youtube_id = m_json_id.group(1)

            if step.get("status") == "ERROR" and step.get("error"):
                last_error = str(step.get("error"))
            elif "Encountered error in tool execution:" in content and '"error"' in content:
                m_err = re.search(r'"error"\s*:\s*"([^"]+)"', content)
                if m_err:
                    last_error = m_err.group(1)

        finished = bool(last_type == "PLANNER_RESPONSE" and last_status == "DONE" and (time.time() - mtime) >= 6)
        return {
            "exists": True,
            "age_sec": max(0.0, time.time() - mtime),
            "steps": len(lines),
            "youtube_id": youtube_id,
            "last_error": last_error,
            "last_text": last_text,
            "last_tool": last_tool,
            "finished": finished,
        }
    except Exception:
        return {"exists": False}


def _find_matching_brain_conv(job_id: str, min_epoch: float) -> Optional[str]:
    if not BRAIN_DIR.exists() or not job_id:
        return None
    try:
        candidates = sorted(
            [d for d in BRAIN_DIR.iterdir() if d.is_dir()],
            key=lambda p: p.stat().st_mtime,
            reverse=True,
        )[:12]
        for d in candidates:
            tpath = d / ".system_generated" / "logs" / "transcript.jsonl"
            if not tpath.exists():
                continue
            if tpath.stat().st_mtime < (min_epoch - 10):
                continue
            with tpath.open("r", encoding="utf-8", errors="replace") as f:
                first_line = f.readline()
            if job_id in first_line:
                return d.name
    except Exception:
        pass
    return None


def _finalize_published_run(job: Dict[str, Any], vid: str) -> Dict[str, Any]:
    now_iso = job.get("completed_at") or datetime.now().astimezone().isoformat(timespec="seconds")
    yurl = f"https://www.youtube.com/watch?v={vid}"

    updated_job = _update_upload_job(
        {
            "status": "published",
            "step": "Published live to YouTube!",
            "youtube_id": vid,
            "youtube_url": yurl,
            "error": None,
            "completed_at": now_iso,
        },
        expected_job_id=job.get("job_id"),
    ) or {**job, "status": "published", "youtube_id": vid, "youtube_url": yurl, "completed_at": now_iso}

    slug = (updated_job.get("slug") or "").strip()
    is_lf = updated_job.get("source_type") == "longform_project" or is_longform_project(slug)
    if slug and not CLOUD_MODE:
        if is_lf:
            if LONGFORM_QUEUE_PATH.exists():
                lf_data = _read_json(LONGFORM_QUEUE_PATH, {})
                for it in lf_data.get("queue", []):
                    if it.get("slug") == slug:
                        it["status"] = "published"
                        it["youtube_id"] = vid
                        it["youtube_url"] = yurl
                        it["published_at"] = now_iso
                        if updated_job.get("title"):
                            it["youtube_title"] = updated_job["title"]
                        if updated_job.get("description"):
                            it["youtube_description"] = updated_job["description"]
                        if updated_job.get("tags"):
                            it["youtube_tags"] = updated_job["tags"]
                        it["privacy_status"] = updated_job.get("privacy_status") or "public"
                        it["category_id"] = updated_job.get("category_id") or "27"
                        break
                _write_json_atomic(LONGFORM_QUEUE_PATH, lf_data)
        else:
            with _runs_lock:
                runs_data = _read_json(
                    RUNS_JSON_PATH,
                    {"channel_id": YOUTUBE_CHANNEL_ID, "channel_title": YOUTUBE_CHANNEL_TITLE, "runs": []},
                )
                for r in runs_data.get("runs", []):
                    if r.get("slug") == slug:
                        r["status"] = "published"
                        r["stage"] = "completed"
                        r["queue_order"] = None
                        r["youtube_id"] = vid
                        r["youtube_url"] = yurl
                        if updated_job.get("title"):
                            r["youtube_title"] = updated_job["title"]
                        if updated_job.get("description"):
                            r["youtube_description"] = updated_job["description"]
                        if updated_job.get("tags"):
                            r["youtube_tags"] = updated_job["tags"]
                        r["privacy_status"] = updated_job.get("privacy_status") or "public"
                        r["category_id"] = updated_job.get("category_id") or "23"
                        r["published_at"] = r.get("published_at") or now_iso
                        r["notes"] = f"Published live on {YOUTUBE_CHANNEL_TITLE} channel as {vid}."
                        break
                _normalize_queue_locked(runs_data)
                for r in runs_data.get("runs", []):
                    if r.get("status") == "queued" and r.get("queue_order"):
                        qo = r["queue_order"]
                        r["notes"] = (
                            "Queued #1: Next scheduled automatic upload at 7:00 PM IST (only 1 queued video uploads per day)."
                            if qo == 1
                            else f"Queued #{qo}: Held in queue for future daily auto-upload."
                        )
                for root in (D_PROJECTS_ROOT, LOCAL_PROJECTS_ROOT):
                    rp = root / "runs.json"
                    if rp.exists():
                        _write_json_atomic(rp, runs_data)

    with _yt_lock:
        _yt_cache["timestamp"] = 0.0
    threading.Thread(target=fetch_youtube_analytics, kwargs={"force": True}, daemon=True).start()
    if not CLOUD_MODE and (BASE_DIR / "sync_cloud_data.py").exists():
        try:
            subprocess.Popen(
                [str(PYTHON_BIN), str(BASE_DIR / "sync_cloud_data.py")],
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
            )
        except Exception:
            pass
    return updated_job


def _inspect_upload_job() -> Dict[str, Any]:
    if CLOUD_MODE:
        return {
            "active": False,
            "status": "idle",
            "cloud_mode": True,
            "step": "Cloud Monitor mode — trigger Zapier uploads from your local CrewTube server.",
        }
    job = _read_json(UPLOAD_JOB_PATH, None)
    if not job:
        for root in (D_PROJECTS_ROOT, LOCAL_PROJECTS_ROOT):
            job = _read_json(root / "upload_job.json", None)
            if job:
                break
    if not job:
        return {"active": False, "status": "idle", "step": "No manual upload running."}

    job_id = job.get("job_id")
    if job.get("status") == "cancelled" or (job_id and job_id in _cancelled_jobs):
        return {"active": False, "status": "idle", "step": "Upload cancelled."}

    # Ensure published jobs also finalize runs.json idempotently
    if job.get("status") == "published" and job.get("youtube_id") and job.get("slug"):
        runs_data = _read_json(RUNS_JSON_PATH, {"runs": []})
        match_run = next((r for r in runs_data.get("runs", []) if r.get("slug") == job["slug"]), None)
        if match_run and match_run.get("status") != "published":
            job = _finalize_published_run(job, job["youtube_id"])

    # Live conversation tracking when agent is uploading
    conv_id = job.get("conversation_id")
    transcript_age: Optional[float] = None
    if conv_id and job.get("status") in ("dispatching_agent", "uploading"):
        scan = _scan_transcript_for_upload(conv_id)
        if scan.get("exists"):
            transcript_age = scan.get("age_sec")
            if scan.get("youtube_id"):
                job = _finalize_published_run(job, scan["youtube_id"])
            elif scan.get("finished") and job_id not in _active_worker_jobs:
                err_txt = scan.get("last_error") or scan.get("last_text") or "Uploader conversation finished without returning a YouTube video ID."
                job["status"] = "error"
                job["step"] = "YouTube upload did not complete"
                job["error"] = str(err_txt)[:500]
                _update_upload_job(
                    {"status": job["status"], "step": job["step"], "error": job["error"]},
                    expected_job_id=job_id,
                )

    status = job.get("status", "idle")
    started_at = job.get("started_at")
    is_stale = False
    if started_at and status in ("staging", "dispatching_agent", "uploading"):
        try:
            age = (datetime.now().astimezone() - datetime.fromisoformat(started_at)).total_seconds()
            worker_alive = job_id in _active_worker_jobs
            agent_alive = transcript_age is not None and transcript_age < 240
            if not worker_alive and not agent_alive and age > 15:
                is_stale = True
                err_msg = (
                    "Background upload stopped when the local server restarted before completing YouTube dispatch. Retry cleanly."
                )
                job["status"] = "error"
                job["step"] = "Previous upload was interrupted"
                job["error"] = err_msg
                _update_upload_job(
                    {"status": job["status"], "step": job["step"], "error": err_msg},
                    expected_job_id=job_id,
                )
            elif age > 2100:
                is_stale = True
        except Exception:
            pass

    job["active"] = (job.get("status") in ("staging", "dispatching_agent", "uploading")) and not is_stale
    return job


def _update_upload_job(updates: Dict[str, Any], expected_job_id: Optional[str] = None) -> Optional[Dict[str, Any]]:
    with _upload_lock:
        if expected_job_id and expected_job_id in _cancelled_jobs:
            return None
        job = _read_json(UPLOAD_JOB_PATH, None)
        if not job:
            for root in (D_PROJECTS_ROOT, LOCAL_PROJECTS_ROOT):
                job = _read_json(root / "upload_job.json", None)
                if job:
                    break
        if expected_job_id:
            if not job or job.get("job_id") != expected_job_id or job.get("status") == "cancelled":
                return None
        job = job or {}
        job.update(updates)
        job["updated_at"] = datetime.now().astimezone().isoformat(timespec="seconds")
        for root in (D_PROJECTS_ROOT, LOCAL_PROJECTS_ROOT):
            if root.exists():
                _write_json_atomic(root / "upload_job.json", job)
        return job


def _run_manual_upload_worker(job_id: str, local_mp4_path: Path, reuse_staged_url: Optional[str] = None) -> None:
    stage_proc: Optional[subprocess.Popen] = None
    dispatch_proc: Optional[subprocess.Popen] = None
    try:
        if _is_job_cancelled(job_id):
            return

        size_mb = round(local_mp4_path.stat().st_size / (1024 * 1024), 1) if local_mp4_path.exists() else 0.0
        staged_url: Optional[str] = None

        # 0. Fast-path reuse if identical file already has a verified live staged URL
        if reuse_staged_url:
            _update_upload_job({"step": f"Verifying cached cloud URL for {size_mb:.1f} MB MP4..."}, expected_job_id=job_id)
            ok, _ = _verify_staged_url_sync(reuse_staged_url)
            if ok:
                staged_url = reuse_staged_url

        # 1. Stage to direct binary HTTPS host (uguu.se -> catbox.moe -> x0.at over IPv4)
        if not staged_url:
            upload_script = resolve_helper_script("upload_media.py")
            stage_proc = subprocess.Popen(
                [str(PYTHON_BIN), str(upload_script), str(local_mp4_path)],
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
                bufsize=1,
                creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
            )
            with _upload_lock:
                _active_upload_procs[job_id] = stage_proc

            out_lines: List[str] = []
            err_lines: List[str] = []
            stage_state = {"host": "uguu.se", "pct": None}

            def _drain_stdout():
                if stage_proc and stage_proc.stdout:
                    for line in stage_proc.stdout:
                        out_lines.append(line.rstrip("\r\n"))

            def _drain_stderr():
                if stage_proc and stage_proc.stderr:
                    for line in stage_proc.stderr:
                        clean = line.rstrip("\r\n")
                        if clean.startswith("HOST:"):
                            stage_state["host"] = clean.split(":", 1)[1].strip() or stage_state["host"]
                            stage_state["pct"] = 0
                        elif clean.startswith("PROGRESS:"):
                            try:
                                stage_state["pct"] = int(float(clean.split(":", 1)[1].strip()))
                            except Exception:
                                pass
                        elif clean:
                            err_lines.append(clean)

            t_out = threading.Thread(target=_drain_stdout, daemon=True)
            t_err = threading.Thread(target=_drain_stderr, daemon=True)
            t_out.start()
            t_err.start()

            start_ts = time.time()
            last_tick = 0.0
            while stage_proc.poll() is None:
                if _is_job_cancelled(job_id):
                    _kill_proc_tree(stage_proc)
                    return
                elapsed = int(time.time() - start_ts)
                if elapsed >= 1800:
                    _kill_proc_tree(stage_proc)
                    t_out.join(timeout=2)
                    t_err.join(timeout=2)
                    _update_upload_job(
                        {
                            "status": "error",
                            "step": "Cloud staging timed out",
                            "error": f"Staging {size_mb:.1f} MB exceeded 1800s limit across hosts. Check uplink speed and retry.",
                        },
                        expected_job_id=job_id,
                    )
                    return
                if time.time() - last_tick >= 2.0:
                    last_tick = time.time()
                    pct_part = f" — {stage_state['pct']}%" if stage_state["pct"] is not None else ""
                    _update_upload_job(
                        {"step": f"Staging {size_mb:.1f} MB via {stage_state['host']}{pct_part} ({elapsed}s)..."},
                        expected_job_id=job_id,
                    )
                time.sleep(0.4)

            t_out.join(timeout=5)
            t_err.join(timeout=5)
            if _is_job_cancelled(job_id):
                return

            stdout_text = "\n".join(out_lines).strip()
            stderr_text = "\n".join(err_lines).strip()
            if stage_proc.returncode != 0 or not stdout_text.startswith("http"):
                err = stderr_text or stdout_text or f"Failed to stage MP4 file (exit {stage_proc.returncode})."
                _update_upload_job(
                    {"status": "error", "step": "Cloud staging failed", "error": err[:500]},
                    expected_job_id=job_id,
                )
                return

            staged_url = stdout_text.splitlines()[-1].strip()
            ok, reason = _verify_staged_url_sync(staged_url)
            if not ok:
                _update_upload_job(
                    {"status": "error", "step": "Staged URL verification failed", "error": reason},
                    expected_job_id=job_id,
                )
                return

        if _is_job_cancelled(job_id):
            return

        _update_upload_job(
            {
                "staged_url": staged_url,
                "status": "dispatching_agent",
                "step": "Staged! Starting Zapier YouTube publisher...",
            },
            expected_job_id=job_id,
        )

        # 2. Launch non-blocking Popen to language_server agentapi (no space-split flags, no 90s false timeout)
        prompt = (
            f"Job {job_id}: Read C:\\Users\\DELL\\faceless-shorts\\UPLOAD_PROMPT.md and immediately "
            f"execute every step using C:\\Users\\DELL\\faceless-shorts\\upload_job.json to publish the video to YouTube without asking."
        )
        if LANGUAGE_SERVER_EXE.exists():
            cmd = [
                str(LANGUAGE_SERVER_EXE),
                "agentapi",
                "new-conversation",
                "--model=flash",
                "--title=ManualUpload",
                "--",
                prompt,
            ]
        else:
            cmd = [
                "cmd",
                "/c",
                str(AGENTAPI_BAT),
                "new-conversation",
                "--model=flash",
                "--title=ManualUpload",
                "--",
                prompt,
            ]

        dispatch_epoch = time.time()
        dispatch_proc = subprocess.Popen(
            cmd,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            cwd=str(LOCAL_PROJECTS_ROOT if LOCAL_PROJECTS_ROOT.exists() else BASE_DIR.parent),
            creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
        )
        with _upload_lock:
            _active_upload_procs[job_id] = dispatch_proc

        d_out: List[str] = []
        d_err: List[str] = []

        def _drain_d_out():
            if dispatch_proc and dispatch_proc.stdout:
                d_out.append(dispatch_proc.stdout.read())

        def _drain_d_err():
            if dispatch_proc and dispatch_proc.stderr:
                d_err.append(dispatch_proc.stderr.read())

        td_out = threading.Thread(target=_drain_d_out, daemon=True)
        td_err = threading.Thread(target=_drain_d_err, daemon=True)
        td_out.start()
        td_err.start()

        conv_id: Optional[str] = None
        d_start = time.time()
        while (time.time() - d_start) < 300:
            if _is_job_cancelled(job_id):
                _kill_proc_tree(dispatch_proc)
                return

            # Check stdout chunks or matching brain directory if already spawned
            conv_id = _find_matching_brain_conv(job_id, dispatch_epoch)
            if dispatch_proc.poll() is not None:
                td_out.join(timeout=3)
                td_err.join(timeout=3)
                combined = "".join(d_out) + "\n" + "".join(d_err)
                m_uuid = re.search(r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}", combined, re.IGNORECASE)
                if m_uuid:
                    conv_id = m_uuid.group(0)
                break
            if conv_id:
                break

            d_elapsed = int(time.time() - d_start)
            if d_elapsed >= 4 and d_elapsed % 4 == 0:
                _update_upload_job(
                    {"step": f"Connecting to Zapier uploader agent ({d_elapsed}s)..."},
                    expected_job_id=job_id,
                )
            time.sleep(1.0)

        if not conv_id:
            conv_id = _find_matching_brain_conv(job_id, dispatch_epoch)
        if not conv_id:
            if dispatch_proc.poll() is None:
                _kill_proc_tree(dispatch_proc)
            combined_err = ("".join(d_out) + " " + "".join(d_err)).strip()
            _update_upload_job(
                {
                    "status": "error",
                    "step": "Uploader agent failed to start",
                    "error": combined_err[:400] or "Timed out after 300s waiting for Antigravity agentapi.",
                },
                expected_job_id=job_id,
            )
            return

        _update_upload_job(
            {
                "conversation_id": conv_id,
                "status": "uploading",
                "step": f"Publishing video to {YOUTUBE_CHANNEL_TITLE} via Zapier...",
            },
            expected_job_id=job_id,
        )

        # 3. Monitor upload_job.json AND transcript.jsonl up to 20 minutes without premature timeout
        upload_start = time.time()
        while (time.time() - upload_start) < 1200:
            time.sleep(2.0)
            if _is_job_cancelled(job_id):
                return

            cur = _read_json(UPLOAD_JOB_PATH, None)
            if not cur or cur.get("job_id") != job_id:
                return
            if cur.get("status") == "published" and cur.get("youtube_id"):
                _finalize_published_run(cur, cur["youtube_id"])
                return
            if cur.get("status") == "error":
                return

            scan = _scan_transcript_for_upload(conv_id)
            if scan.get("exists"):
                if scan.get("youtube_id"):
                    _finalize_published_run(cur, scan["youtube_id"])
                    return
                if scan.get("finished"):
                    err_txt = scan.get("last_error") or scan.get("last_text") or "Uploader conversation finished without returning a YouTube video ID."
                    _update_upload_job(
                        {
                            "status": "error",
                            "step": "YouTube upload did not complete",
                            "error": str(err_txt)[:500],
                        },
                        expected_job_id=job_id,
                    )
                    return

            elapsed = int(time.time() - upload_start)
            if elapsed >= 6 and elapsed % 4 == 0:
                tool_hint = f" [{scan.get('last_tool')}]" if scan.get("exists") and scan.get("last_tool") else ""
                _update_upload_job(
                    {"step": f"Publishing video to {YOUTUBE_CHANNEL_TITLE} via Zapier{tool_hint} ({elapsed}s)..."},
                    expected_job_id=job_id,
                )

        _update_upload_job(
            {
                "status": "error",
                "step": "Upload monitor timed out after 20 minutes",
                "error": f"Check conversation {conv_id} or YouTube Studio before retrying to avoid duplicates.",
            },
            expected_job_id=job_id,
        )
    except Exception as exc:
        if not _is_job_cancelled(job_id):
            _update_upload_job(
                {"status": "error", "step": "Manual upload error", "error": str(exc)},
                expected_job_id=job_id,
            )
    finally:
        with _upload_lock:
            _active_upload_procs.pop(job_id, None)
        if _is_job_cancelled(job_id):
            _kill_proc_tree(stage_proc)
            _kill_proc_tree(dispatch_proc)
        elif stage_proc and stage_proc.poll() is None:
            _kill_proc_tree(stage_proc)
        _active_worker_jobs.discard(job_id)


def get_system_health() -> List[Dict[str, Any]]:
    studio_snap = _load_studio_snapshot()
    studio_synced_at = studio_snap.get("synced_at")
    cfg = _get_studio_config()
    has_direct_api = bool((cfg.get("youtube_api_key") or "").strip() or (cfg.get("oauth_access_token") or "").strip())

    if CLOUD_MODE:
        runs_ok = RUNS_JSON_PATH.exists()
        snap = _read_json(CLOUD_DATA_DIR / "automation_snapshot.json", {})
        queued_n = len([r for r in _read_json(RUNS_JSON_PATH, {"runs": []}).get("runs", []) if r.get("status") == "queued"])
        studio_ok = STUDIO_ANALYTICS_PATH.exists() or has_direct_api
        return [
            {
                "name": "Vercel Cloud Runtime",
                "ok": True,
                "detail": "FastAPI serverless + IST timezone clock",
            },
            {
                "name": "Live YouTube Sync",
                "ok": True,
                "detail": f"Data API v3 direct ({YOUTUBE_CHANNEL_TITLE})" if has_direct_api else f"Real-time views & subs ({YOUTUBE_CHANNEL_TITLE})",
            },
            {
                "name": "YouTube Studio Analytics",
                "ok": studio_ok,
                "detail": f"Synced {studio_synced_at}" if studio_synced_at else "Connect Data API v3 or sync via local Studio OAuth",
            },
            {
                "name": "Queue & Script Snapshot",
                "ok": runs_ok,
                "detail": f"{queued_n} queued Shorts metadata & sheets synced" if runs_ok else "Snapshot missing",
            },
            {
                "name": "Workstation Scheduler (7 PM IST)",
                "ok": bool(snap.get("enabled", True)),
                "detail": "Armed on local Windows machine (1/day FIFO)",
            },
            {
                "name": "YouTube Zapier Connection",
                "ok": True,
                "detail": f"Connected ({YOUTUBE_CHANNEL_TITLE})",
            },
        ]

    kokoro_onnx = Path(r"C:\Users\DELL\.faceless-shorts\kokoro\kokoro-v1.0.onnx")
    kokoro_bin = Path(r"C:\Users\DELL\.faceless-shorts\kokoro\voices-v1.0.bin")
    ffmpeg_bin = Path(r"C:\Users\DELL\bin\ffmpeg.exe")
    venv_py = Path(r"C:\Users\DELL\.faceless-shorts\venv\Scripts\python.exe")
    node_bin = Path(r"C:\Program Files\nodejs\node.exe")
    whisper_dir = Path(r"C:\Users\DELL\.cache\huggingface\hub")

    whisper_ready = whisper_dir.exists() and any("whisper" in p.name.lower() for p in whisper_dir.iterdir() if p.is_dir())
    if not whisper_ready:
        local_cache = Path(r"C:\Users\DELL\.faceless-shorts")
        whisper_ready = local_cache.exists()

    return [
        {
            "name": "Kokoro AI Voice Model",
            "ok": kokoro_onnx.exists() and kokoro_bin.exists(),
            "detail": f"{round((kokoro_onnx.stat().st_size + kokoro_bin.stat().st_size)/(1024*1024))} MB ready"
            if (kokoro_onnx.exists() and kokoro_bin.exists())
            else "Missing model files",
        },
        {
            "name": "Whisper Subtitle Engine",
            "ok": whisper_ready and venv_py.exists(),
            "detail": "small.en local model & Python 3.11 venv" if venv_py.exists() else "Venv missing",
        },
        {
            "name": "FFmpeg Encoder",
            "ok": ffmpeg_bin.exists(),
            "detail": "FFmpeg 9.0.2 in C:\\Users\\DELL\\bin" if ffmpeg_bin.exists() else "Not found",
        },
        {
            "name": "Node.js + Three.js Renderer",
            "ok": node_bin.exists(),
            "detail": "Node v24 + headless Chrome capture" if node_bin.exists() else "Node missing",
        },
        {
            "name": "YouTube Studio & Zapier OAuth",
            "ok": STUDIO_ANALYTICS_PATH.exists() or FINALIZE_STUDIO_SYNC_PY.exists(),
            "detail": f"Connected ({YOUTUBE_CHANNEL_TITLE}) · Synced {studio_synced_at or 'ready'}"
            if has_direct_api or STUDIO_ANALYTICS_PATH.exists()
            else f"Connected ({YOUTUBE_CHANNEL_TITLE})",
        },
        {
            "name": "FIFO Queue & Manual Upload",
            "ok": resolve_helper_script("AUTO_PROMPT.md").exists() and resolve_helper_script("UPLOAD_PROMPT.md").exists() and resolve_helper_script("upload_media.py").exists(),
            "detail": "AUTO_PROMPT.md (1/day FIFO) + UPLOAD_PROMPT.md + STUDIO_SYNC ready",
        },
    ]


def _parse_sub_count(raw: Any) -> int:
    s = str(raw or "0").strip().upper().replace(",", "")
    if not s:
        return 0
    mult = 1
    if s.endswith("K"):
        mult = 1000
        s = s[:-1]
    elif s.endswith("M"):
        mult = 1_000_000
        s = s[:-1]
    elif s.endswith("B"):
        mult = 1_000_000_000
        s = s[:-1]
    try:
        return int(float(s) * mult)
    except Exception:
        return 0


def _parse_iso_dt(ts: Optional[str]) -> Optional[datetime]:
    if not ts:
        return None
    try:
        dt = datetime.fromisoformat(str(ts).strip().replace("Z", "+00:00"))
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=ZoneInfo("UTC"))
        return dt
    except Exception:
        return None


def get_monetization_overview(yt_data: Dict[str, Any]) -> Dict[str, Any]:
    snap = _read_json(MONETIZATION_JSON_PATH, {}) or {}
    studio_snap = _load_studio_snapshot()
    studio_summary = yt_data.get("studio_analytics") if isinstance(yt_data.get("studio_analytics"), dict) else {}
    ypp_enabled = bool(
        studio_summary.get("ypp_enabled")
        if studio_summary.get("ypp_enabled") is not None
        else snap.get("ypp_enabled", studio_snap.get("ypp_enabled", False))
    )
    currency = str(snap.get("default_currency") or "USD").upper()
    if currency not in ("USD", "INR"):
        currency = "USD"
    try:
        usd_to_inr = float(snap.get("usd_to_inr_rate") or 84.5)
    except Exception:
        usd_to_inr = 84.5
    try:
        shorts_rpm_usd = float(snap.get("shorts_rpm_usd") or 0.05)
    except Exception:
        shorts_rpm_usd = 0.05

    summary = yt_data.get("summary", {})
    videos = yt_data.get("videos", [])
    subs_count = _parse_sub_count(summary.get("subscribers", 7))
    lifetime_views = int(summary.get("total_views") or sum(int(v.get("views") or 0) for v in videos))

    now_utc = datetime.now(ZoneInfo("UTC"))
    cutoff_90d = now_utc - timedelta(days=90)
    cutoff_30d = now_utc - timedelta(days=30)

    shorts_views_90d = 0
    recent_shorts_count = 0
    recent_shorts_views = 0
    for v in videos:
        views = int(v.get("views") or 0)
        dt = _parse_iso_dt(v.get("published_at"))
        is_short = bool(v.get("is_short", True))
        if is_short and (dt is None or dt >= cutoff_90d):
            shorts_views_90d += views
        if is_short and dt is not None and dt >= cutoff_30d:
            recent_shorts_count += 1
            recent_shorts_views += views

    avg_recent_views = round(recent_shorts_views / recent_shorts_count) if recent_shorts_count else (
        round(lifetime_views / len(videos)) if videos else 0
    )

    video_rev_map = snap.get("video_revenue", {}) if isinstance(snap.get("video_revenue"), dict) else {}
    official_total_usd = float(snap.get("official_revenue_usd") or 0.0) if ypp_enabled else 0.0
    per_video = []
    for v in videos:
        vid = v.get("id", "")
        views = int(v.get("views") or 0)
        v_rev_entry = video_rev_map.get(vid, {}) if ypp_enabled else {}
        actual_usd = float(v_rev_entry.get("estimated_revenue_usd") or 0.0) if ypp_enabled else 0.0
        sim_usd = round((views / 1000.0) * shorts_rpm_usd, 4)
        per_video.append(
            {
                "id": vid,
                "title": v.get("title", vid),
                "thumbnail": v.get("thumbnail"),
                "published_at": v.get("published_at"),
                "duration": v.get("duration", "0:45"),
                "is_short": bool(v.get("is_short", True)),
                "views": views,
                "likes": int(v.get("likes") or 0),
                "engagement_pct": v.get("engagement_pct", 0.0),
                "view_share_pct": round((views / lifetime_views * 100), 1) if lifetime_views > 0 else 0.0,
                "official_revenue_usd": round(actual_usd, 4),
                "estimated_if_ypp_usd": sim_usd,
                "play_url": v.get("play_url"),
                "shorts_url": v.get("shorts_url"),
                "studio_earn_url": f"https://studio.youtube.com/video/{vid}/analytics/tab-earn_video",
            }
        )

    sim_lifetime_usd = round((lifetime_views / 1000.0) * shorts_rpm_usd, 4)
    sim_90d_usd = round((shorts_views_90d / 1000.0) * shorts_rpm_usd, 4)
    adsense_min_usd = 100.0

    t1_subs_goal = 500
    t1_shorts_goal = 3_000_000
    t1_watch_goal = 3_000.0
    t2_subs_goal = 1_000
    t2_shorts_goal = 10_000_000
    t2_watch_goal = 4_000.0
    watch_hours_365d = float(snap.get("long_form_watch_hours_365d") or 0.0)

    mins_watched_settled = int(
        studio_snap.get("analytics_minutes_watched")
        if studio_snap.get("analytics_minutes_watched") is not None
        else (snap.get("analytics_minutes_watched") or 0)
    )
    views_settled = int(
        studio_snap.get("analytics_views_settled")
        if studio_snap.get("analytics_views_settled") is not None
        else (snap.get("analytics_views_settled") or 0)
    )
    subs_gained_settled = int(
        studio_snap.get("analytics_subscribers_gained")
        if studio_snap.get("analytics_subscribers_gained") is not None
        else (snap.get("analytics_subscribers_gained") or 0)
    )

    return {
        "channel_id": YOUTUBE_CHANNEL_ID,
        "channel_title": YOUTUBE_CHANNEL_TITLE,
        "channel_country": snap.get("channel_country", "IN"),
        "ypp_enabled": ypp_enabled,
        "ypp_status_label": "Partner Monetization Active" if ypp_enabled else "Pre-Monetization (YPP Not Enabled)",
        "official_revenue_usd": round(official_total_usd, 2),
        "official_ad_revenue_usd": round(float(snap.get("official_ad_revenue_usd") or 0.0) if ypp_enabled else 0.0, 2),
        "monetized_playbacks": int(snap.get("monetized_playbacks") or 0) if ypp_enabled else 0,
        "analytics_minutes_watched": mins_watched_settled,
        "analytics_avg_view_duration_sec": int(studio_snap.get("analytics_avg_view_duration_sec") or 0),
        "analytics_views_settled": views_settled,
        "analytics_subscribers_gained": subs_gained_settled,
        "channel_views_settled": studio_summary.get("channel_views_settled") or studio_snap.get("channel_views_settled"),
        "studio_synced_at": studio_snap.get("synced_at") or snap.get("api_checked_at"),
        "api_source": studio_summary.get("source") or snap.get("api_source", "YouTube Data API v3 + YouTube Analytics API v2"),
        "api_checked_at": snap.get("api_checked_at") or studio_snap.get("synced_at"),
        "studio_earn_url": f"https://studio.youtube.com/channel/{YOUTUBE_CHANNEL_ID}/monetization",
        "default_currency": currency,
        "usd_to_inr_rate": usd_to_inr,
        "shorts_rpm_usd": shorts_rpm_usd,
        "shorts_creator_share_pct": 45,
        "adsense_threshold_usd": adsense_min_usd,
        "adsense_progress_pct": round(min(100.0, (official_total_usd / adsense_min_usd) * 100.0), 2),
        "subscribers_count": subs_count,
        "lifetime_views": lifetime_views,
        "shorts_views_90d": shorts_views_90d,
        "recent_shorts_count": recent_shorts_count,
        "avg_recent_views": avg_recent_views,
        "simulated_lifetime_usd": sim_lifetime_usd,
        "simulated_90d_usd": sim_90d_usd,
        "tiers": {
            "tier1": {
                "name": "Tier 1 · Fan Funding & Early Access",
                "subs_current": subs_count,
                "subs_goal": t1_subs_goal,
                "subs_pct": round(min(100.0, subs_count / t1_subs_goal * 100.0), 2),
                "shorts_views_current": shorts_views_90d,
                "shorts_views_goal": t1_shorts_goal,
                "shorts_views_pct": round(min(100.0, shorts_views_90d / t1_shorts_goal * 100.0), 4),
                "watch_hours_current": watch_hours_365d,
                "watch_hours_goal": t1_watch_goal,
                "watch_hours_pct": round(min(100.0, watch_hours_365d / t1_watch_goal * 100.0), 3),
            },
            "tier2": {
                "name": "Tier 2 · Full Ad Revenue Sharing (45% Shorts Pool)",
                "subs_current": subs_count,
                "subs_goal": t2_subs_goal,
                "subs_pct": round(min(100.0, subs_count / t2_subs_goal * 100.0), 2),
                "shorts_views_current": shorts_views_90d,
                "shorts_views_goal": t2_shorts_goal,
                "shorts_views_pct": round(min(100.0, shorts_views_90d / t2_shorts_goal * 100.0), 4),
                "watch_hours_current": watch_hours_365d,
                "watch_hours_goal": t2_watch_goal,
                "watch_hours_pct": round(min(100.0, watch_hours_365d / t2_watch_goal * 100.0), 3),
            },
        },
        "per_video": per_video,
    }


def get_longform_overview() -> Dict[str, Any]:
    if not LOCAL_LONGFORM_ROOT.exists() and CLOUD_LONGFORM_JSON.exists():
        return _read_json(CLOUD_LONGFORM_JSON, {"available": False})

    root = LOCAL_LONGFORM_ROOT
    if not root.exists():
        return {
            "available": False,
            "queue": [],
            "stories": [],
            "schedule": {
                "description": "Every Tuesday and Friday at 8:00 PM IST (Twice Weekly)",
                "cron": "CRON_TZ=Asia/Kolkata 0 20 * * 2,5",
                "time_ist": "8:00 PM IST",
                "cloud_storage_provider": "google_drive",
                "storage_location": "D:\\faceless-longform (314 GB Free)",
            },
            "summary": {
                "total_stories": 0,
                "total_queued": 0,
                "total_ready": 0,
                "format": "1920x1080 (16:9 Widescreen)",
                "fps": 24,
            },
        }

    q_data = _read_json(root / "queue" / "queue.json", {})
    queue_items = q_data.get("queue", [])
    enriched_queue = []
    for item in queue_items:
        it = dict(item)
        slug = it.get("slug")
        mp4_file = it.get("mp4_file")
        if mp4_file:
            p = Path(mp4_file)
            if p.exists():
                it["mp4_url"] = f"/media-longform/{slug}/renders/{p.name}"
                it["mp4_name"] = p.name
                it["mp4_size_mb"] = round(p.stat().st_size / (1024 * 1024), 2)
                it["mp4_ready"] = True
            else:
                it["mp4_url"] = None
                it["mp4_ready"] = False
        rev_dir = root / slug / "review" / "ch1"
        if rev_dir.exists():
            imgs = sorted(rev_dir.glob("*.jpg"))
            if imgs:
                it["thumb_url"] = f"/media-longform/{slug}/review/ch1/{imgs[0].name}"
                it["preview_frames"] = [f"/media-longform/{slug}/review/ch1/{im.name}" for im in imgs]
        enriched_queue.append(it)

    stories = []
    try:
        dirs = [
            d for d in root.iterdir()
            if d.is_dir() and not d.name.startswith(".") and d.name not in {"queue", "scheduler", "__pycache__"}
        ]
    except Exception:
        dirs = []

    for p in sorted(dirs):
        ch_json = p / "chapters.json"
        if not ch_json.exists():
            continue
        ch_meta = _read_json(ch_json, {})
        slug = p.name
        rendered_ch1 = p / "renders" / "ch1.mp4"
        has_mp4 = rendered_ch1.exists()

        chapters_detail = []
        chapters_list = ch_meta.get("chapters", [])
        for ch_info in chapters_list:
            ch_num = ch_info.get("chapter", 1)
            ch_script = _read_json(p / "chapters" / f"ch{ch_num}_script.json", {})
            wav_file = p / "chapters" / f"ch{ch_num}_narration.wav"
            ch_dur = round(wav_file.stat().st_size / (24000 * 2), 2) if wav_file.exists() else ch_info.get("target_duration_sec", 180)
            ch_status = "rendered" if (ch_num == 1 and has_mp4) else ("audio_ready" if wav_file.exists() else "scripted")

            ch_frames = []
            ch_rev = p / "review" / f"ch{ch_num}"
            if ch_rev.exists():
                ch_frames = [f"/media-longform/{slug}/review/ch{ch_num}/{im.name}" for im in sorted(ch_rev.glob("*.jpg"))]

            chapters_detail.append({
                "chapter": ch_num,
                "title": ch_info.get("title", f"Chapter {ch_num}"),
                "summary": ch_info.get("summary", ""),
                "duration_sec": ch_dur,
                "status": ch_status,
                "lines_count": len(ch_script.get("lines", [])),
                "script_lines": ch_script.get("lines", []),
                "narration_url": f"/media-longform/{slug}/chapters/ch{ch_num}_narration.wav" if wav_file.exists() else None,
                "preview_frames": ch_frames,
            })

        all_frames = []
        rev_ch1 = p / "review" / "ch1"
        if rev_ch1.exists():
            all_frames = [f"/media-longform/{slug}/review/ch1/{im.name}" for im in sorted(rev_ch1.glob("*.jpg"))]

        ch1_wav = p / "chapters" / "ch1_narration.wav"
        ch1_dur = round(ch1_wav.stat().st_size / (24000 * 2), 2) if ch1_wav.exists() else 78.38

        stories.append({
            "slug": slug,
            "title": ch_meta.get("title", slug),
            "topic": ch_meta.get("topic", ""),
            "format": ch_meta.get("format", "16:9 Widescreen (1920x1080)"),
            "target_duration_mins": ch_meta.get("total_target_duration_mins", 15),
            "total_chapters": len(chapters_list),
            "rendered_chapters": 1 if has_mp4 else 0,
            "has_render": has_mp4,
            "mp4_url": f"/media-longform/{slug}/renders/ch1.mp4" if has_mp4 else None,
            "mp4_name": "ch1.mp4" if has_mp4 else None,
            "mp4_size_mb": round(rendered_ch1.stat().st_size / (1024 * 1024), 2) if has_mp4 else 0,
            "duration_sec": ch1_dur if has_mp4 else 0,
            "preview_frames": all_frames,
            "thumb_url": all_frames[0] if all_frames else None,
            "chapters": chapters_detail,
        })

    return {
        "available": True,
        "schedule": {
            "description": q_data.get("schedule_description", "Every Tuesday and Friday at 8:00 PM IST (Twice Weekly)"),
            "cron": q_data.get("schedule", "CRON_TZ=Asia/Kolkata 0 20 * * 2,5"),
            "next_scheduled_day": "Tuesday & Friday",
            "time_ist": "8:00 PM IST",
            "cloud_storage_provider": q_data.get("cloud_storage_provider", "google_drive"),
            "storage_location": "D:\\faceless-longform (314 GB Free)",
        },
        "queue": enriched_queue,
        "stories": stories,
        "summary": {
            "total_stories": len(stories),
            "total_queued": len(enriched_queue),
            "total_ready": len([it for it in enriched_queue if it.get("mp4_ready")]),
            "format": "1920x1080 (16:9 Widescreen)",
            "fps": 24,
        },
    }


@app.get("/", response_class=HTMLResponse)
def serve_home():
    index_file = STATIC_DIR / "index.html"
    if not index_file.exists():
        raise HTTPException(status_code=404, detail="Dashboard UI not found")
    return FileResponse(
        index_file,
        headers={"Cache-Control": "no-store, no-cache, must-revalidate, max-age=0"},
    )


@app.get("/favicon.ico", include_in_schema=False)
def serve_favicon():
    svg = (
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 36 36">'
        '<rect width="36" height="36" rx="9" fill="#0E1422"/>'
        '<rect x="4" y="7" width="28" height="22" rx="6" fill="#E11D48"/>'
        '<polygon points="15,13 24,18 15,23" fill="#FFFFFF"/>'
        "</svg>"
    )
    return Response(content=svg, media_type="image/svg+xml")


@app.get("/api/health")
def api_health():
    return JSONResponse({"ok": True, "cloud_mode": CLOUD_MODE, "is_vercel": IS_VERCEL})


_NO_CACHE_HEADERS = {
    "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
    "Pragma": "no-cache",
}


@app.get("/api/overview")
def api_overview(refresh_yt: bool = Query(False)):
    yt_data = fetch_youtube_analytics(force=refresh_yt)
    automation = get_automation_status()
    active_proj = automation.get("active_processes", {}).get("active_project")
    projects = get_projects_pipeline(yt_data, active_project=active_proj)
    monetization = get_monetization_overview(yt_data)
    health = get_system_health()

    queued = [p for p in projects if p["queue_status"] == "queued"]
    ready_queued = [p for p in queued if p["ready_to_upload"]]
    published = [p for p in projects if p["is_posted"]]
    upload_job = _inspect_upload_job()

    queue_summary = {
        "queued_count": len(queued),
        "ready_count": len(ready_queued),
        "published_count": len(published),
        "next_up": queued[0] if queued else None,
        "queue_slugs": [p["slug"] for p in queued],
        "upload_job": upload_job,
    }

    return JSONResponse(
        {
            "cloud_mode": CLOUD_MODE,
            "server_time": datetime.now().astimezone().isoformat(timespec="seconds"),
            "automation": automation,
            "projects": projects,
            "queue_summary": queue_summary,
            "youtube": yt_data,
            "monetization": monetization,
            "system_health": health,
            "longform": get_longform_overview(),
        },
        headers=_NO_CACHE_HEADERS,
    )


@app.get("/api/longform")
def api_longform():
    return JSONResponse(get_longform_overview(), headers=_NO_CACHE_HEADERS)


@app.get("/api/youtube")
def api_youtube(refresh: int = Query(0), with_mon: int = Query(0), manual: int = Query(0), discover: int = Query(0)):
    yt_data = fetch_youtube_analytics(force=bool(refresh), manual=bool(manual), discover=bool(discover))
    if with_mon:
        payload = {**yt_data, "monetization": get_monetization_overview(yt_data)}
        return JSONResponse(payload, headers=_NO_CACHE_HEADERS)
    return JSONResponse(yt_data, headers=_NO_CACHE_HEADERS)


def _mask_secret(val: str) -> str:
    s = str(val or "").strip()
    if not s:
        return ""
    if len(s) <= 8:
        return "••••"
    return f"{s[:4]}••••{s[-4:]}"


def _studio_config_status() -> Dict[str, Any]:
    cfg = _get_studio_config()
    snap = _load_studio_snapshot()
    api_key = (cfg.get("youtube_api_key") or "").strip()
    oauth_tok = (cfg.get("oauth_access_token") or "").strip()
    oauth_rt = (cfg.get("oauth_refresh_token") or "").strip()
    oauth_cid = (cfg.get("oauth_client_id") or "").strip()
    oauth_csec = (cfg.get("oauth_client_secret") or "").strip()
    return {
        "cloud_mode": CLOUD_MODE,
        "api_key_configured": bool(api_key),
        "api_key_masked": _mask_secret(api_key),
        "oauth_connected": bool(oauth_tok or (oauth_rt and oauth_cid and oauth_csec)),
        "oauth_client_configured": bool(oauth_cid and oauth_csec),
        "zapier_oauth_connected": True,
        "studio_synced_at": snap.get("synced_at"),
        "studio_source": snap.get("source"),
        "studio_channel_url": f"https://studio.youtube.com/channel/{YOUTUBE_CHANNEL_ID}/analytics/tab-overview/period-default",
    }


def _update_studio_sync_job(updates: Dict[str, Any], expected_job_id: Optional[str] = None) -> Dict[str, Any]:
    with _studio_sync_lock:
        cur = _read_json(STUDIO_SYNC_JOB_PATH, None)
        if expected_job_id and isinstance(cur, dict) and cur.get("job_id") and cur.get("job_id") != expected_job_id:
            return cur
        job = dict(cur) if isinstance(cur, dict) else {}
        job.update(updates)
        job["updated_at"] = datetime.now().astimezone().isoformat(timespec="seconds")
        if not CLOUD_MODE:
            _write_json_atomic(STUDIO_SYNC_JOB_PATH, job)
        return job


def _inspect_studio_sync_job() -> Dict[str, Any]:
    if CLOUD_MODE:
        snap = _load_studio_snapshot()
        return {
            "active": False,
            "status": "snapshot" if snap else "idle",
            "cloud_mode": True,
            "synced_at": snap.get("synced_at"),
            "step": "Cloud Monitor mode — run Zapier Studio Sync from local http://127.0.0.1:8765 or set YOUTUBE_API_KEY env var.",
        }
    job = _read_json(STUDIO_SYNC_JOB_PATH, None)
    if not isinstance(job, dict) or not job.get("job_id"):
        snap = _load_studio_snapshot()
        return {
            "active": False,
            "status": "idle",
            "synced_at": snap.get("synced_at"),
            "step": "Ready to sync live YouTube Studio & Analytics v2.",
        }
    status = str(job.get("status") or "idle")
    job_id = str(job.get("job_id"))
    is_active = status in ("starting", "dispatching_agent", "syncing")
    if is_active:
        started_at = job.get("started_at")
        worker_alive = job_id in _active_studio_sync_jobs
        try:
            age = (datetime.now().astimezone() - datetime.fromisoformat(str(started_at))).total_seconds() if started_at else 0.0
        except Exception:
            age = 0.0
        if not worker_alive and age > 15:
            job["status"] = "error"
            job["step"] = "Studio sync interrupted by server restart"
            job["error"] = "Previous Studio sync stopped before completion. Click Sync YouTube Studio to retry."
            _update_studio_sync_job(job, expected_job_id=job_id)
            is_active = False
        elif age > 360:
            is_active = False
    out = dict(job)
    out["active"] = is_active
    return out


def _run_oauth_direct_studio_sync(cfg: Dict[str, Any], job_id: str) -> Dict[str, Any]:
    with _new_yt_session() as sess:
        tok = _refresh_oauth_token_if_needed(cfg, sess, force=False)
        if not tok:
            raise RuntimeError("OAuth access token missing or expired.")
        hdrs = {"Authorization": f"Bearer {tok}"}

        r_ch = sess.get(
            "https://www.googleapis.com/youtube/v3/channels",
            params={"mine": "true", "part": "snippet,statistics,contentDetails,status"},
            headers=hdrs,
            timeout=(3.0, 5.0),
        )
        if r_ch.status_code == 401:
            tok = _refresh_oauth_token_if_needed(cfg, sess, force=True)
            if not tok:
                raise RuntimeError("OAuth token rejected by Google.")
            hdrs = {"Authorization": f"Bearer {tok}"}
            r_ch = sess.get(
                "https://www.googleapis.com/youtube/v3/channels",
                params={"mine": "true", "part": "snippet,statistics,contentDetails,status"},
                headers=hdrs,
                timeout=(3.0, 5.0),
            )
        if r_ch.status_code != 200:
            raise RuntimeError(f"Channels API HTTP {r_ch.status_code}: {r_ch.text[:220]}")
        ch_js = r_ch.json()
        ch_item = (ch_js.get("items") or [{}])[0]
        uploads_pid = ch_item.get("contentDetails", {}).get("relatedPlaylists", {}).get("uploads") or (
            "UU" + YOUTUBE_CHANNEL_ID[2:]
        )

        r_pl = sess.get(
            "https://www.googleapis.com/youtube/v3/playlistItems",
            params={"playlistId": uploads_pid, "part": "contentDetails", "maxResults": "25"},
            headers=hdrs,
            timeout=(3.0, 5.0),
        )
        vids_ids: List[str] = []
        if r_pl.status_code == 200:
            vids_ids = [
                str(it.get("contentDetails", {}).get("videoId") or "")
                for it in r_pl.json().get("items", [])
                if isinstance(it, dict)
            ]
            vids_ids = [v for v in vids_ids if v]
        if not vids_ids:
            vids_ids = list(BASELINE_VIDEO_META.keys())

        r_vids = sess.get(
            "https://www.googleapis.com/youtube/v3/videos",
            params={"id": ",".join(vids_ids[:50]), "part": "snippet,statistics,contentDetails,status"},
            headers=hdrs,
            timeout=(3.0, 5.0),
        )
        if r_vids.status_code != 200:
            raise RuntimeError(f"Videos API HTTP {r_vids.status_code}: {r_vids.text[:220]}")
        vids_js = r_vids.json()

        today_str = datetime.now().astimezone().strftime("%Y-%m-%d")
        an_ch_js: Dict[str, Any] = {}
        an_v_js: Dict[str, Any] = {}
        try:
            r_ac = sess.get(
                "https://youtubeanalytics.googleapis.com/v2/reports",
                params={
                    "ids": "channel==MINE",
                    "startDate": "2026-06-01",
                    "endDate": today_str,
                    "metrics": "views,likes,comments,estimatedMinutesWatched,averageViewDuration,subscribersGained",
                },
                headers=hdrs,
                timeout=(3.0, 5.0),
            )
            if r_ac.status_code == 200:
                an_ch_js = r_ac.json()
            r_av = sess.get(
                "https://youtubeanalytics.googleapis.com/v2/reports",
                params={
                    "ids": "channel==MINE",
                    "startDate": "2026-06-01",
                    "endDate": today_str,
                    "dimensions": "video",
                    "metrics": "views,likes,comments,estimatedMinutesWatched,averageViewDuration",
                    "sort": "-views",
                    "maxResults": "25",
                },
                headers=hdrs,
                timeout=(3.0, 5.0),
            )
            if r_av.status_code == 200:
                an_v_js = r_av.json()
        except Exception:
            pass

    import importlib.util

    spec = importlib.util.spec_from_file_location("finalize_studio_sync", str(FINALIZE_STUDIO_SYNC_PY))
    mod = importlib.util.module_from_spec(spec)
    assert spec and spec.loader
    spec.loader.exec_module(mod)
    snap = mod.build_studio_snapshot(
        ch_js,
        vids_js,
        an_ch_js,
        an_v_js,
        source_label="YouTube Studio Direct OAuth (Data API v3 + Analytics v2)",
    )
    return mod.apply_studio_snapshot(snap, job_id=job_id)


def _run_studio_sync_worker(job_id: str) -> None:
    dispatch_proc: Optional[subprocess.Popen] = None
    try:
        _update_studio_sync_job(
            {"status": "dispatching_agent", "step": "Connecting to Zapier YouTube Studio OAuth agent..."},
            expected_job_id=job_id,
        )
        prompt = (
            f"StudioSync {job_id}: Read C:\\Users\\DELL\\faceless-shorts\\STUDIO_SYNC_PROMPT.md and immediately "
            f"execute every step using Zapier YouTubeV4CLIAPI and finalize_studio_sync.py for job_id {job_id} without asking."
        )
        if LANGUAGE_SERVER_EXE.exists():
            cmd = [
                str(LANGUAGE_SERVER_EXE),
                "agentapi",
                "new-conversation",
                "--model=flash",
                "--title=StudioSync",
                "--",
                prompt,
            ]
        else:
            cmd = [
                "cmd",
                "/c",
                str(AGENTAPI_BAT),
                "new-conversation",
                "--model=flash",
                "--title=StudioSync",
                "--",
                prompt,
            ]
        dispatch_epoch = time.time()
        dispatch_proc = subprocess.Popen(
            cmd,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            cwd=str(LOCAL_PROJECTS_ROOT if LOCAL_PROJECTS_ROOT.exists() else BASE_DIR.parent),
            creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
        )
        d_out: List[str] = []
        d_err: List[str] = []
        td_out = threading.Thread(target=lambda: d_out.append(dispatch_proc.stdout.read()) if dispatch_proc.stdout else None, daemon=True)
        td_err = threading.Thread(target=lambda: d_err.append(dispatch_proc.stderr.read()) if dispatch_proc.stderr else None, daemon=True)
        td_out.start()
        td_err.start()

        conv_id: Optional[str] = None
        d_start = time.time()
        while (time.time() - d_start) < 120:
            conv_id = _find_matching_brain_conv(job_id, dispatch_epoch)
            if dispatch_proc.poll() is not None:
                td_out.join(timeout=2)
                td_err.join(timeout=2)
                combined = "".join(d_out) + "\n" + "".join(d_err)
                m_uuid = re.search(r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}", combined, re.IGNORECASE)
                if m_uuid:
                    conv_id = m_uuid.group(0)
                break
            if conv_id:
                break
            elapsed = int(time.time() - d_start)
            if elapsed >= 4 and elapsed % 4 == 0:
                _update_studio_sync_job({"step": f"Starting Zapier Studio sync ({elapsed}s)..."}, expected_job_id=job_id)
            time.sleep(1.0)

        if not conv_id:
            conv_id = _find_matching_brain_conv(job_id, dispatch_epoch)
        if not conv_id:
            combined_err = ("".join(d_out) + " " + "".join(d_err)).strip()
            _update_studio_sync_job(
                {
                    "status": "error",
                    "step": "Studio sync agent failed to start",
                    "error": combined_err[:380] or "Timed out starting Zapier Studio sync agent.",
                },
                expected_job_id=job_id,
            )
            return

        _update_studio_sync_job(
            {
                "conversation_id": conv_id,
                "status": "syncing",
                "step": "Fetching channels, videos & Analytics API v2 via Zapier YouTube OAuth...",
            },
            expected_job_id=job_id,
        )

        wait_start = time.time()
        while (time.time() - wait_start) < 240:
            time.sleep(2.0)
            cur = _read_json(STUDIO_SYNC_JOB_PATH, None)
            if isinstance(cur, dict) and cur.get("job_id") == job_id:
                if cur.get("status") == "completed":
                    with _yt_lock:
                        _yt_cache["timestamp"] = 0.0
                    fetch_youtube_analytics(force=True, manual=True, discover=True)
                    return
                if cur.get("status") == "error":
                    return

            scan = _scan_transcript_for_upload(conv_id)
            if scan.get("exists") and scan.get("finished"):
                cur2 = _read_json(STUDIO_SYNC_JOB_PATH, None)
                if isinstance(cur2, dict) and cur2.get("job_id") == job_id and cur2.get("status") == "completed":
                    with _yt_lock:
                        _yt_cache["timestamp"] = 0.0
                    fetch_youtube_analytics(force=True, manual=True, discover=True)
                    return
                err_txt = scan.get("last_error") or scan.get("last_text") or "Zapier Studio sync finished without writing studio_analytics.json."
                _update_studio_sync_job(
                    {"status": "error", "step": "Studio sync did not complete", "error": str(err_txt)[:400]},
                    expected_job_id=job_id,
                )
                return

            el = int(time.time() - wait_start)
            if el >= 6 and el % 4 == 0:
                tool_hint = f" [{scan.get('last_tool')}]" if scan.get("exists") and scan.get("last_tool") else ""
                _update_studio_sync_job(
                    {"step": f"Syncing YouTube Studio Analytics v2{tool_hint} ({el}s)..."},
                    expected_job_id=job_id,
                )

        _update_studio_sync_job(
            {"status": "error", "step": "Studio sync timed out after 4 minutes", "error": f"Check conversation {conv_id}"},
            expected_job_id=job_id,
        )
    except Exception as exc:
        _update_studio_sync_job({"status": "error", "step": "Studio sync failed", "error": str(exc)}, expected_job_id=job_id)
    finally:
        _active_studio_sync_jobs.discard(job_id)


@app.get("/api/youtube/studio-config")
def api_get_studio_config():
    return JSONResponse(_studio_config_status(), headers=_NO_CACHE_HEADERS)


@app.post("/api/youtube/studio-config")
def api_post_studio_config(payload: Dict[str, Any] = Body(...)):
    _require_local_write("saving YouTube Studio API configuration")
    if payload.get("clear"):
        if STUDIO_CONFIG_PATH.exists():
            try:
                STUDIO_CONFIG_PATH.unlink()
            except Exception:
                pass
        with _yt_lock:
            _yt_cache["timestamp"] = 0.0
            _yt_discovery_cache["timestamp"] = 0.0
        yt = fetch_youtube_analytics(force=True, manual=True, discover=True)
        return JSONResponse({"ok": True, "config": _studio_config_status(), "youtube": yt})

    cfg = _get_studio_config()
    with _new_yt_session() as sess:
        if "youtube_api_key" in payload:
            key_val = str(payload.get("youtube_api_key") or "").strip()
            if key_val:
                test_r = None
                last_net_exc: Optional[Exception] = None
                for ch_ep in (
                    "https://www.googleapis.com/youtube/v3/channels",
                    "https://youtube.googleapis.com/youtube/v3/channels",
                ):
                    try:
                        test_r = sess.get(
                            ch_ep,
                            params={"part": "snippet,statistics", "id": YOUTUBE_CHANNEL_ID, "key": key_val},
                            timeout=(4.2, 4.0),
                        )
                        break
                    except requests.RequestException as exc:
                        last_net_exc = exc
                if test_r is None:
                    raise HTTPException(
                        status_code=502,
                        detail=f"Could not reach Google YouTube Data API v3 to validate key: {last_net_exc}",
                    )
                if test_r.status_code != 200:
                    try:
                        msg = test_r.json().get("error", {}).get("message") or test_r.text[:200]
                    except Exception:
                        msg = test_r.text[:200]
                    raise HTTPException(status_code=400, detail=f"YouTube Data API v3 key rejected ({test_r.status_code}): {msg}")
                cfg["youtube_api_key"] = key_val
            else:
                cfg.pop("youtube_api_key", None)

        for k in ("oauth_access_token", "oauth_refresh_token", "oauth_client_id", "oauth_client_secret", "zapier_webhook_url"):
            if k in payload:
                val = str(payload.get(k) or "").strip()
                if val:
                    cfg[k] = val
                else:
                    cfg.pop(k, None)

        has_oauth_creds = bool(
            (cfg.get("oauth_access_token") or "").strip()
            or (
                (cfg.get("oauth_refresh_token") or "").strip()
                and (cfg.get("oauth_client_id") or "").strip()
                and (cfg.get("oauth_client_secret") or "").strip()
            )
        )
        if has_oauth_creds and any(k in payload for k in ("oauth_access_token", "oauth_refresh_token", "oauth_client_id", "oauth_client_secret")):
            tok = _refresh_oauth_token_if_needed(cfg, sess, force=False)
            if not tok:
                raise HTTPException(status_code=400, detail="Could not obtain valid YouTube OAuth access token from provided credentials.")
            r_test = None
            last_oauth_exc: Optional[Exception] = None
            for ch_ep in (
                "https://www.googleapis.com/youtube/v3/channels",
                "https://youtube.googleapis.com/youtube/v3/channels",
            ):
                try:
                    r_test = sess.get(
                        ch_ep,
                        params={"part": "snippet,statistics,status", "mine": "true"},
                        headers={"Authorization": f"Bearer {tok}"},
                        timeout=(4.2, 4.0),
                    )
                    break
                except requests.RequestException as exc:
                    last_oauth_exc = exc
            if r_test is None:
                raise HTTPException(
                    status_code=502,
                    detail=f"Could not reach Google YouTube API to verify OAuth token: {last_oauth_exc}",
                )
            if r_test.status_code != 200:
                raise HTTPException(status_code=400, detail=f"YouTube OAuth token rejected ({r_test.status_code}): {r_test.text[:200]}")

    cfg["updated_at"] = datetime.now().astimezone().isoformat(timespec="seconds")
    _write_json_atomic(STUDIO_CONFIG_PATH, cfg)

    with _yt_lock:
        _yt_cache["timestamp"] = 0.0
        _yt_discovery_cache["timestamp"] = 0.0
    yt = fetch_youtube_analytics(force=True, manual=True, discover=True)
    return JSONResponse({"ok": True, "config": _studio_config_status(), "youtube": yt})


@app.get("/api/youtube/studio-sync/status")
def api_studio_sync_status():
    return JSONResponse(_inspect_studio_sync_job(), headers=_NO_CACHE_HEADERS)


@app.post("/api/youtube/studio-sync")
def api_studio_sync():
    _require_local_write("YouTube Studio live sync")
    cur_job = _inspect_studio_sync_job()
    if cur_job.get("active"):
        return JSONResponse({"ok": True, "already_running": True, "job": cur_job})

    job_id = f"ss_{uuid.uuid4().hex[:8]}"
    now_iso = datetime.now().astimezone().isoformat(timespec="seconds")
    cfg = _get_studio_config()
    has_direct_oauth = bool(
        (cfg.get("oauth_access_token") or "").strip()
        or (
            (cfg.get("oauth_refresh_token") or "").strip()
            and (cfg.get("oauth_client_id") or "").strip()
            and (cfg.get("oauth_client_secret") or "").strip()
        )
    )

    if has_direct_oauth:
        _update_studio_sync_job(
            {
                "job_id": job_id,
                "status": "syncing",
                "step": "Querying Google YouTube Studio & Analytics API v2 directly...",
                "started_at": now_iso,
                "error": None,
            }
        )
        try:
            snap = _run_oauth_direct_studio_sync(cfg, job_id)
            with _yt_lock:
                _yt_cache["timestamp"] = 0.0
            yt = fetch_youtube_analytics(force=True, manual=True, discover=True)
            return JSONResponse(
                {
                    "ok": True,
                    "mode": "direct_oauth",
                    "job": _inspect_studio_sync_job(),
                    "studio_analytics": snap,
                    "youtube": yt,
                },
                headers=_NO_CACHE_HEADERS,
            )
        except Exception as exc:
            _update_studio_sync_job(
                {"status": "error", "step": "Direct OAuth sync failed", "error": str(exc)},
                expected_job_id=job_id,
            )
            raise HTTPException(status_code=500, detail=str(exc))

    job = {
        "job_id": job_id,
        "status": "starting",
        "step": "Starting YouTube Studio OAuth sync via Zapier...",
        "conversation_id": None,
        "started_at": now_iso,
        "updated_at": now_iso,
        "error": None,
    }
    _write_json_atomic(STUDIO_SYNC_JOB_PATH, job)
    _active_studio_sync_jobs.add(job_id)
    threading.Thread(target=_run_studio_sync_worker, args=(job_id,), daemon=True).start()
    return JSONResponse({"ok": True, "mode": "zapier_oauth", "job": {**job, "active": True}}, headers=_NO_CACHE_HEADERS)


@app.get("/api/monetization")
def api_monetization(refresh: int = Query(0)):
    yt_data = fetch_youtube_analytics(force=bool(refresh))
    return JSONResponse(get_monetization_overview(yt_data), headers=_NO_CACHE_HEADERS)


@app.post("/api/monetization/settings")
def api_monetization_settings(payload: Dict[str, Any] = Body(...)):
    _require_local_write("saving monetization benchmark settings")
    with _mon_lock:
        snap = _read_json(MONETIZATION_JSON_PATH, {}) or {}
        if payload.get("default_currency") in ("USD", "INR"):
            snap["default_currency"] = payload["default_currency"]
        if payload.get("shorts_rpm_usd") is not None:
            try:
                rpm = max(0.001, min(10.0, float(payload["shorts_rpm_usd"])))
                snap["shorts_rpm_usd"] = round(rpm, 4)
            except Exception:
                raise HTTPException(status_code=400, detail="Invalid shorts_rpm_usd value")
        if payload.get("usd_to_inr_rate") is not None:
            try:
                fx = max(10.0, min(500.0, float(payload["usd_to_inr_rate"])))
                snap["usd_to_inr_rate"] = round(fx, 2)
            except Exception:
                raise HTTPException(status_code=400, detail="Invalid usd_to_inr_rate value")
        snap["updated_at"] = datetime.now().astimezone().isoformat(timespec="seconds")
        _write_json_atomic(MONETIZATION_JSON_PATH, snap)
    yt_data = fetch_youtube_analytics(force=False)
    return JSONResponse({"ok": True, "monetization": get_monetization_overview(yt_data)})


@app.get("/api/projects/{slug}/script")
def api_project_script(slug: str):
    proj_dir = find_project_dir(slug)
    if not proj_dir or not proj_dir.is_dir():
        raise HTTPException(status_code=404, detail="Project not found")

    runs_data = _read_json(RUNS_JSON_PATH, {"runs": []})
    run_meta = next((r for r in runs_data.get("runs", []) if r.get("slug") == slug), {})
    script = _read_json(proj_dir / "script.json", {})
    lines_obj = _read_json(proj_dir / "data" / "lines.json", {})
    lines_list = lines_obj.get("lines", []) if isinstance(lines_obj, dict) else []

    raw_lines = script.get("lines", [])
    script_lines = []
    for idx, sl in enumerate(raw_lines):
        tl = lines_list[idx] if idx < len(lines_list) and isinstance(lines_list[idx], dict) else {}
        script_lines.append(
            {
                "index": idx + 1,
                "text": sl.get("text", ""),
                "caps": sl.get("caps"),
                "start": tl.get("start"),
                "end": tl.get("end"),
            }
        )

    renders_dir = proj_dir / "renders"
    mp4_files = sorted(renders_dir.glob("*.mp4"), key=lambda p: p.stat().st_mtime, reverse=True) if renders_dir.exists() else []
    declared_video = run_meta.get("video_file")
    mp4_path = proj_dir / declared_video if declared_video and (proj_dir / declared_video).exists() else (mp4_files[0] if mp4_files else None)
    cover_dir = proj_dir / "review" / "cover"
    cover_files = sorted(cover_dir.glob("*.jpg"), key=lambda p: p.stat().st_mtime, reverse=True) if cover_dir.exists() else []
    yt_meta = _build_default_metadata(slug, script, run_meta)

    return JSONResponse(
        {
            "cloud_mode": CLOUD_MODE,
            "slug": slug,
            "title": script.get("title") or run_meta.get("title") or slug,
            "voice": script.get("voice", "am_michael"),
            "music": script.get("music", "bounce"),
            "queue_status": run_meta.get("status", "draft"),
            "queue_order": run_meta.get("queue_order"),
            "full_script_text": "\n".join(sl.get("text", "") for sl in raw_lines if sl.get("text")),
            "script_lines": script_lines,
            "sources": script.get("sources", []),
            "mp4_url": f"/media/{slug}/renders/{mp4_path.name}" if (mp4_path and mp4_path.exists()) else None,
            "mp4_name": mp4_path.name if (mp4_path and mp4_path.exists()) else run_meta.get("rendered_mp4_name"),
            "mp4_size_mb": round(mp4_path.stat().st_size / (1024 * 1024), 2) if (mp4_path and mp4_path.exists()) else run_meta.get("rendered_size_mb"),
            "narration_url": f"/media/{slug}/data/narration.wav" if (proj_dir / "data" / "narration.wav").exists() else None,
            "sheet_url": f"/media/{slug}/review/all.jpg" if (proj_dir / "review" / "all.jpg").exists() else None,
            "cover_url": f"/media/{slug}/review/cover/{cover_files[0].name}" if cover_files else None,
            **yt_meta,
        }
    )


def _require_local_write(action_label: str) -> None:
    if CLOUD_MODE:
        raise HTTPException(
            status_code=403,
            detail=f"Cloud Monitor mode on Vercel is read-only ({action_label} runs on your local CrewTube server at http://127.0.0.1:8765).",
        )


@app.post("/api/queue/reorder")
def api_queue_reorder(payload: Dict[str, Any] = Body(...)):
    _require_local_write("queue reordering")
    with _runs_lock:
        runs_data = _read_json(RUNS_JSON_PATH, {"channel_id": YOUTUBE_CHANNEL_ID, "channel_title": YOUTUBE_CHANNEL_TITLE, "runs": []})
        _normalize_queue_locked(runs_data)
        runs = runs_data["runs"]
        queued = [r for r in runs if r.get("status") == "queued"]
        queued.sort(key=lambda r: int(r.get("queue_order") or 999))

        explicit_order = payload.get("order")
        if isinstance(explicit_order, list) and explicit_order:
            rank = {str(s): idx + 1 for idx, s in enumerate(explicit_order)}
            queued.sort(key=lambda r: rank.get(r["slug"], 9999))
            for idx, r in enumerate(queued, start=1):
                r["queue_order"] = idx
        else:
            slug = payload.get("slug")
            action = str(payload.get("action") or "").lower()
            if not slug:
                raise HTTPException(status_code=400, detail="Missing slug or order")
            idx = next((i for i, r in enumerate(queued) if r.get("slug") == slug), None)
            if idx is None:
                raise HTTPException(status_code=404, detail=f"Project '{slug}' is not currently queued")

            if action == "up" and idx > 0:
                queued[idx - 1], queued[idx] = queued[idx], queued[idx - 1]
            elif action == "down" and idx < len(queued) - 1:
                queued[idx + 1], queued[idx] = queued[idx], queued[idx + 1]
            elif action == "top" and idx > 0:
                item = queued.pop(idx)
                queued.insert(0, item)
            elif action == "bottom" and idx < len(queued) - 1:
                item = queued.pop(idx)
                queued.append(item)

            for pos, r in enumerate(queued, start=1):
                r["queue_order"] = pos

        _write_json_atomic(RUNS_JSON_PATH, runs_data)
        return JSONResponse(
            {
                "ok": True,
                "queue": [{"slug": r["slug"], "title": r.get("title"), "queue_order": r["queue_order"]} for r in queued],
            }
        )


@app.post("/api/queue/metadata")
def api_queue_metadata(payload: Dict[str, Any] = Body(...)):
    _require_local_write("saving queue metadata")
    slug = str(payload.get("slug") or "").strip()
    if not slug:
        raise HTTPException(status_code=400, detail="Missing slug")
    proj_dir = find_project_dir(slug)
    if proj_dir is None:
        raise HTTPException(status_code=404, detail="Project directory not found")

    if is_longform_project(slug):
        if LONGFORM_QUEUE_PATH.exists():
            lf_q = _read_json(LONGFORM_QUEUE_PATH, {})
            for item in lf_q.get("queue", []):
                if item.get("slug") == slug:
                    if payload.get("youtube_title") is not None:
                        item["youtube_title"] = str(payload["youtube_title"]).strip()
                    if payload.get("youtube_description") is not None:
                        item["youtube_description"] = str(payload["youtube_description"]).strip()
                    if payload.get("youtube_tags") is not None:
                        item["youtube_tags"] = _normalize_tags(payload["youtube_tags"])
                    if payload.get("privacy_status") in ("public", "unlisted", "private"):
                        item["privacy_status"] = payload["privacy_status"]
                    if payload.get("category_id") is not None:
                        item["category_id"] = str(payload["category_id"]).strip()
                    break
            _write_json_atomic(LONGFORM_QUEUE_PATH, lf_q)
        return JSONResponse({"ok": True, "slug": slug, "type": "longform"})

    with _runs_lock:
        runs_data = _read_json(RUNS_JSON_PATH, {"channel_id": YOUTUBE_CHANNEL_ID, "channel_title": YOUTUBE_CHANNEL_TITLE, "runs": []})
        runs = runs_data.setdefault("runs", [])
        entry = next((r for r in runs if r.get("slug") == slug), None)
        script = _read_json(proj_dir / "script.json", {})
        if entry is None:
            renders = sorted((proj_dir / "renders").glob("*.mp4")) if (proj_dir / "renders").exists() else []
            entry = {
                "slug": slug,
                "title": script.get("title") or slug,
                "style": "tall-tale",
                "created_at": datetime.now().astimezone().isoformat(timespec="seconds"),
                "status": "queued",
                "stage": "ready_in_queue" if renders else "draft",
                "queue_order": 999,
                "video_file": f"renders/{renders[0].name}" if renders else None,
            }
            runs.append(entry)

        if payload.get("youtube_title") is not None:
            entry["youtube_title"] = str(payload["youtube_title"]).strip()
        if payload.get("youtube_description") is not None:
            entry["youtube_description"] = str(payload["youtube_description"]).strip()
        if payload.get("youtube_tags") is not None:
            entry["youtube_tags"] = _normalize_tags(payload["youtube_tags"])
        if payload.get("privacy_status") in ("public", "unlisted", "private"):
            entry["privacy_status"] = payload["privacy_status"]
        if payload.get("category_id") is not None:
            entry["category_id"] = str(payload["category_id"]).strip()

        requested_status = payload.get("queue_status")
        if requested_status in ("queued", "draft") and entry.get("status") != "published":
            entry["status"] = requested_status
            if requested_status == "queued" and entry.get("queue_order") is None:
                entry["queue_order"] = 999

        _normalize_queue_locked(runs_data)
        _write_json_atomic(RUNS_JSON_PATH, runs_data)
        return JSONResponse({"ok": True, "run": entry})


@app.get("/api/upload/status")
def api_upload_status():
    return JSONResponse(_inspect_upload_job(), headers=_NO_CACHE_HEADERS)


@app.post("/api/upload/clear")
def api_upload_clear():
    _require_local_write("clearing upload status")
    with _upload_lock:
        cur = _read_json(UPLOAD_JOB_PATH, None)
        cur_id = cur.get("job_id") if isinstance(cur, dict) else None
        if cur_id:
            _cancelled_jobs.add(cur_id)
            _active_worker_jobs.discard(cur_id)
            proc = _active_upload_procs.pop(cur_id, None)
            _kill_proc_tree(proc)
        for jid, proc in list(_active_upload_procs.items()):
            _cancelled_jobs.add(jid)
            _active_worker_jobs.discard(jid)
            _kill_proc_tree(proc)
            _active_upload_procs.pop(jid, None)
        if cur and cur.get("status") in ("staging", "dispatching_agent", "uploading"):
            cur["status"] = "cancelled"
            cur["step"] = "Upload cancelled"
            _write_json_atomic(UPLOAD_JOB_PATH, cur)
        for root in (D_PROJECTS_ROOT, LOCAL_PROJECTS_ROOT):
            jp = root / "upload_job.json"
            if jp.exists():
                try:
                    jp.unlink()
                except Exception:
                    pass
    return JSONResponse({"ok": True, "status": "idle", "cancelled": True})


@app.post("/api/upload/manual")
async def api_upload_manual(request: Request):
    _require_local_write("manual Zapier upload")
    cur_job = _inspect_upload_job()
    if cur_job.get("active"):
        raise HTTPException(
            status_code=409,
            detail=f"An upload job is already running ({cur_job.get('step')}). Cancel it first or wait for it to finish.",
        )

    content_type = request.headers.get("content-type", "")
    slug: Optional[str] = None
    title: str = ""
    description: str = ""
    tags_raw: Any = None
    privacy_status: str = "public"
    category_id: str = "23"
    force_reupload: bool = False
    source_type: str = "queued_project"
    mp4_path: Optional[Path] = None

    if "multipart/form-data" in content_type.lower():
        raw_body = await request.body()
        if len(raw_body) > 1024 * 1024 * 1024:
            raise HTTPException(status_code=413, detail="Uploaded file exceeds 1 GB staging cap.")
        try:
            fields, files = _parse_multipart(content_type, raw_body)
        except Exception as exc:
            raise HTTPException(status_code=400, detail=f"Invalid form upload: {exc}")

        slug = (fields.get("slug") or "").strip() or None
        title = (fields.get("title") or "").strip()
        description = (fields.get("description") or "").strip()
        tags_raw = fields.get("tags")
        privacy_status = (fields.get("privacy_status") or "public").strip()
        category_id = (fields.get("category_id") or "23").strip()
        force_reupload = str(fields.get("force") or "").lower() in ("1", "true", "yes")

        uploaded_file = files.get("file")
        if uploaded_file is not None:
            content_bytes = uploaded_file.get("content") or b""
            if len(content_bytes) < 4096:
                raise HTTPException(status_code=400, detail="Uploaded video file is empty or too small (< 4 KB).")
            if len(content_bytes) > 1000 * 1024 * 1024:
                raise HTTPException(status_code=413, detail="Video exceeds 1000 MB limit for automated upload hosts. Compress below 500 MB first.")
            source_type = "custom_file"
            raw_name = uploaded_file.get("filename") or "custom-video.mp4"
            safe_name = re.sub(r"[^a-zA-Z0-9._-]+", "-", raw_name).strip("-.") or "custom-video.mp4"
            if not safe_name.lower().endswith((".mp4", ".mov", ".webm", ".mkv")):
                safe_name += ".mp4"
            MANUAL_UPLOADS_DIR.mkdir(parents=True, exist_ok=True)
            ts = datetime.now().strftime("%Y%m%d-%H%M%S")
            mp4_path = MANUAL_UPLOADS_DIR / f"{ts}_{safe_name}"
            with mp4_path.open("wb") as fp:
                fp.write(content_bytes)
            if not title:
                title = Path(raw_name).stem.replace("-", " ").replace("_", " ").strip().title()
    else:
        try:
            data = await request.json()
        except Exception:
            raise HTTPException(status_code=400, detail="Expected JSON or multipart form payload")
        slug = (data.get("slug") or "").strip() or None
        title = (data.get("title") or data.get("youtube_title") or "").strip()
        description = (data.get("description") or data.get("youtube_description") or "").strip()
        tags_raw = data.get("tags") or data.get("youtube_tags")
        privacy_status = str(data.get("privacy_status") or "public").strip()
        category_id = str(data.get("category_id") or "").strip()
        force_reupload = bool(data.get("force"))

    is_lf = is_longform_project(slug) if slug else False

    if mp4_path is None:
        if not slug:
            raise HTTPException(status_code=400, detail="Select a queued video project OR choose a local .mp4 file to upload.")
        proj_dir = find_project_dir(slug)
        if proj_dir is None:
            raise HTTPException(status_code=404, detail=f"Project '{slug}' not found.")

        if is_lf:
            source_type = "longform_project"
            lf_q = _read_json(LONGFORM_QUEUE_PATH, {})
            lf_item = next((it for it in lf_q.get("queue", []) if it.get("slug") == slug), {})
            if (lf_item.get("status") == "published" or lf_item.get("youtube_id")) and not force_reupload:
                existing_url = lf_item.get("youtube_url") or f"https://www.youtube.com/watch?v={lf_item.get('youtube_id')}"
                raise HTTPException(
                    status_code=409,
                    detail=f"'{slug}' is already published on YouTube ({existing_url}). Pick another story or check force reupload.",
                )
            ch_meta = _read_json(proj_dir / "chapters.json", {})
            if not title:
                title = lf_item.get("youtube_title") or ch_meta.get("title") or slug
            if not description:
                description = lf_item.get("youtube_description") or ch_meta.get("topic") or ""
            if not tags_raw:
                tags_raw = lf_item.get("youtube_tags") or ["Documentary", "History", "TrueStory"]
            privacy_status = privacy_status or lf_item.get("privacy_status") or "public"
            category_id = category_id if (category_id and category_id != "23") else (lf_item.get("category_id") or "27")

            rel_video = lf_item.get("mp4_file")
            mp4_path = find_project_mp4(slug, rel_video)
            if not mp4_path and (proj_dir / "renders").exists():
                renders = sorted((proj_dir / "renders").glob("*.mp4"), key=lambda p: p.stat().st_mtime, reverse=True)
                mp4_path = renders[0] if renders else None
        else:
            runs_data = _read_json(RUNS_JSON_PATH, {"runs": []})
            run_meta = next((r for r in runs_data.get("runs", []) if r.get("slug") == slug), {})
            if (run_meta.get("status") == "published" or run_meta.get("youtube_id")) and not force_reupload:
                existing_url = run_meta.get("youtube_url") or f"https://www.youtube.com/watch?v={run_meta.get('youtube_id')}"
                raise HTTPException(
                    status_code=409,
                    detail=f"'{slug}' is already published on YouTube ({existing_url}). Pick another Short or custom MP4.",
                )

            script = _read_json(proj_dir / "script.json", {})
            defaults = _build_default_metadata(slug, script, run_meta)

            if not title:
                title = defaults["youtube_title"]
            if not description:
                description = defaults["youtube_description"]
            if not tags_raw:
                tags_raw = defaults["youtube_tags"]
            privacy_status = privacy_status or defaults["privacy_status"]
            category_id = category_id or defaults["category_id"]

            rel_video = run_meta.get("video_file")
            mp4_path = find_project_mp4(slug, rel_video)
            if not mp4_path and (proj_dir / "renders").exists():
                renders = sorted((proj_dir / "renders").glob("*.mp4"), key=lambda p: p.stat().st_mtime, reverse=True)
                mp4_path = renders[0] if renders else None

        if not mp4_path or not mp4_path.exists() or mp4_path.stat().st_size < 50_000:
            raise HTTPException(status_code=409, detail=f"MP4 video for '{slug}' is still rendering or not ready yet.")

    category_id = category_id or ("27" if is_lf else "23")
    title, description, tags, privacy_status, category_id = _sanitize_youtube_meta(
        title, description, tags_raw, privacy_status, category_id, is_longform=is_lf
    )

    if is_lf and slug:
        if LONGFORM_QUEUE_PATH.exists():
            lf_q = _read_json(LONGFORM_QUEUE_PATH, {})
            for item in lf_q.get("queue", []):
                if item.get("slug") == slug:
                    item["youtube_title"] = title
                    item["youtube_description"] = description
                    item["youtube_tags"] = tags
                    item["privacy_status"] = privacy_status
                    item["category_id"] = category_id
                    break
            _write_json_atomic(LONGFORM_QUEUE_PATH, lf_q)
    elif source_type == "queued_project" and slug:
        with _runs_lock:
            for root in (D_PROJECTS_ROOT, LOCAL_PROJECTS_ROOT):
                rp = root / "runs.json"
                if not rp.exists():
                    continue
                latest_runs = _read_json(rp, {"runs": []})
                entry = next((r for r in latest_runs.get("runs", []) if r.get("slug") == slug), None)
                if entry is not None:
                    entry["youtube_title"] = title
                    entry["youtube_description"] = description
                    entry["youtube_tags"] = tags
                    entry["privacy_status"] = privacy_status
                    entry["category_id"] = category_id
                    _write_json_atomic(rp, latest_runs)

    st = mp4_path.stat()
    source_sig = f"{mp4_path}|{st.st_size}|{int(st.st_mtime)}"
    reuse_staged_url: Optional[str] = None
    prev = _read_json(UPLOAD_JOB_PATH, None)
    if (
        isinstance(prev, dict)
        and prev.get("status") != "published"
        and prev.get("source_sig") == source_sig
        and str(prev.get("staged_url") or "").startswith("https://")
    ):
        try:
            prev_ts = datetime.fromisoformat(str(prev.get("updated_at") or prev.get("started_at")))
            if (datetime.now().astimezone() - prev_ts).total_seconds() < 5400:
                reuse_staged_url = str(prev["staged_url"])
        except Exception:
            pass

    job_id = uuid.uuid4().hex[:10]
    job = {
        "job_id": job_id,
        "source_type": source_type,
        "source_sig": source_sig,
        "slug": slug,
        "local_mp4_path": str(mp4_path),
        "title": title,
        "description": description,
        "tags": tags,
        "category_id": category_id,
        "privacy_status": privacy_status,
        "staged_url": reuse_staged_url,
        "status": "staging",
        "step": "Verifying cached cloud URL..." if reuse_staged_url else "Staging MP4 to cloud host...",
        "conversation_id": None,
        "youtube_id": None,
        "youtube_url": None,
        "error": None,
        "started_at": datetime.now().astimezone().isoformat(timespec="seconds"),
        "updated_at": datetime.now().astimezone().isoformat(timespec="seconds"),
        "completed_at": None,
    }
    with _upload_lock:
        _cancelled_jobs.discard(job_id)
        for root in (D_PROJECTS_ROOT, LOCAL_PROJECTS_ROOT):
            if root.exists():
                _write_json_atomic(root / "upload_job.json", job)
        _active_worker_jobs.add(job_id)

    threading.Thread(target=_run_manual_upload_worker, args=(job_id, mp4_path, reuse_staged_url), daemon=True).start()
    return JSONResponse({"ok": True, "job": {**job, "active": True}})


def _prewarm_dns_host(host: str) -> None:
    try:
        _yt_get_ipv4s(host, 443)
    except Exception:
        pass


def _yt_live_poller_loop() -> None:
    global _yt_in_flight
    if not CLOUD_MODE and os.name == "nt":
        threading.Thread(target=_refresh_proc_tools_bg, daemon=True).start()
        for h in ("www.youtube.com", "youtubei.googleapis.com", "www.googleapis.com", "oauth2.googleapis.com"):
            threading.Thread(target=_prewarm_dns_host, args=(h,), daemon=True, name="yt-dns-prewarm").start()
    try:
        fetch_youtube_analytics(force=True, manual=False, discover=False)
    except Exception:
        pass
    _trigger_bg_discovery_if_stale()
    while True:
        time.sleep(4.2)
        try:
            run_now = False
            with _yt_lock:
                ts = float(_yt_cache["timestamp"] or 0.0)
                if not _yt_in_flight and (ts == 0.0 or (time.time() - ts) >= 4.0):
                    _yt_in_flight = True
                    run_now = True
            if run_now:
                _refresh_youtube_analytics_sync(force_discovery=False)
        except Exception:
            pass


@app.on_event("startup")
def _warmup_local_yt_pool() -> None:
    if not IS_VERCEL:
        threading.Thread(target=_yt_live_poller_loop, daemon=True, name="yt-live-poller").start()


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="127.0.0.1", port=8765, log_level="info")
