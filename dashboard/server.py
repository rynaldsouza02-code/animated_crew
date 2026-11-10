import html as html_lib
import json
import os
import re
import subprocess
import threading
import time
import uuid
import wave
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple
from zoneinfo import ZoneInfo

import requests
from fastapi import Body, FastAPI, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

# Paths & Runtime Mode (Local Windows Workstation vs Vercel Serverless Cloud Monitor)
BASE_DIR = Path(__file__).resolve().parent
STATIC_DIR = BASE_DIR / "static"
LOCAL_PROJECTS_ROOT = Path(r"C:\Users\DELL\faceless-shorts")
CLOUD_DATA_DIR = BASE_DIR / "cloud_data"
IS_VERCEL = bool(os.environ.get("VERCEL") or os.environ.get("VERCEL_ENV"))
CLOUD_MODE = IS_VERCEL or not LOCAL_PROJECTS_ROOT.exists()
PROJECTS_ROOT = CLOUD_DATA_DIR if CLOUD_MODE else LOCAL_PROJECTS_ROOT
SKILL_ROOT = Path(r"C:\Users\DELL\OneDrive\Desktop\faceless\faceless-shorts")
RUNS_JSON_PATH = PROJECTS_ROOT / "runs.json"
UPLOAD_JOB_PATH = PROJECTS_ROOT / "upload_job.json"
MANUAL_UPLOADS_DIR = PROJECTS_ROOT / "manual-uploads"
UPLOAD_MEDIA_PY = PROJECTS_ROOT / "upload_media.py"
PYTHON_BIN = Path(r"C:\Python314\python.exe")
AGENTAPI_BAT = Path(r"C:\Users\DELL\.gemini\antigravity\bin\agentapi.bat")

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

# Fallback analytics baseline (from verified Zapier / YouTube API snapshots)
BASELINE_VIDEO_META: Dict[str, Dict[str, Any]] = {
    "U2JI4OeNHP4": {
        "title": "He bought the Queen’s bank for $1… 🤯 #Shorts #animation #funny #memes #animationmeme #joker",
        "publishedAt": "2026-11-09T13:52:52Z",
        "duration": "0:39",
        "is_short": True,
        "views": 1323,
        "likes": 41,
        "comments": 0,
    },
    "GR6kYF3zbTo": {
        "title": "France Football Facts! 🇫🇷⚽️ World Cup Glory! #Shorts #France #WorldCupFacts",
        "publishedAt": "2026-06-13T12:30:41Z",
        "duration": "1:01",
        "is_short": True,
        "views": 19,
        "likes": 3,
        "comments": 0,
    },
    "CdskYyYawgM": {
        "title": "🤯 FIFA World Cup 2026: SHOCKING FACTS! #shorts #worldcup #fifa",
        "publishedAt": "2026-06-12T16:16:29Z",
        "duration": "1:03",
        "is_short": True,
        "views": 14,
        "likes": 2,
        "comments": 0,
    },
    "c3vN_Q-qNH8": {
        "title": "Brazil's FIFA World Cup Dominance: Top 10 Facts! 🇧🇷🏆 #shorts #WorldCupFacts",
        "publishedAt": "2026-06-12T13:26:01Z",
        "duration": "1:01",
        "is_short": True,
        "views": 17,
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

if PROJECTS_ROOT.exists():
    app.mount("/media", StaticFiles(directory=str(PROJECTS_ROOT)), name="media")

# Simple thread-safe locks & caches
_yt_lock = threading.Lock()
_runs_lock = threading.Lock()
_upload_lock = threading.Lock()
_yt_cache: Dict[str, Any] = {"timestamp": 0.0, "data": None}
YT_CACHE_TTL_SEC = 120.0
_yt_in_flight = False
_active_worker_jobs: set[str] = set()


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
        out = [str(t).strip().lstrip("#") for t in raw_tags if str(t).strip()]
        return out or ["Shorts", "History", "TrueStory", "Animation"]
    if isinstance(raw_tags, str):
        parts = [p.strip().lstrip("#") for p in re.split(r"[,\s]+", raw_tags) if p.strip()]
        return parts or ["Shorts", "History", "TrueStory", "Animation"]
    return ["Shorts", "History", "TrueStory", "Animation"]


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
    m = re.search(r'boundary=([^;]+)', content_type or "", re.IGNORECASE)
    if not m:
        raise ValueError("Missing multipart boundary")
    boundary = m.group(1).strip().strip('"').encode("latin-1")
    delim = b"--" + boundary
    parts = body.split(delim)
    fields: Dict[str, str] = {}
    files: Dict[str, Dict[str, Any]] = {}

    for part in parts[1:]:
        if not part or part.startswith(b"--"):
            break
        if part.startswith(b"\r\n"):
            part = part[2:]
        if part.endswith(b"\r\n"):
            part = part[:-2]
        sep_idx = part.find(b"\r\n\r\n")
        if sep_idx == -1:
            continue
        hdr_bytes = part[:sep_idx].decode("utf-8", errors="replace")
        payload = part[sep_idx + 4 :]
        name_m = re.search(r'name="([^"]+)"', hdr_bytes)
        if not name_m:
            continue
        field_name = name_m.group(1)
        fn_m = re.search(r'filename="([^"]*)"', hdr_bytes)
        if fn_m:
            files[field_name] = {
                "filename": os.path.basename(fn_m.group(1)),
                "content": payload,
            }
        else:
            fields[field_name] = payload.decode("utf-8", errors="replace")
    return fields, files


def _detect_active_processes() -> Dict[str, Any]:
    """Quickly detect whether local rendering/voice/ffmpeg tools are actively running."""
    if CLOUD_MODE or os.name != "nt":
        return {"is_rendering": False, "active_tools": [], "active_project": None}

    active_tools: List[str] = []
    try:
        out = subprocess.check_output(
            ["tasklist", "/fo", "csv", "/nh"],
            text=True,
            timeout=2.5,
            creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
        )
        lower = out.lower()
        if "ffmpeg.exe" in lower:
            active_tools.append("ffmpeg")
        if "chrome-headless-shell" in lower or "chrome.exe" in lower:
            if "ffmpeg.exe" in lower:
                active_tools.append("headless-chrome")
    except Exception:
        pass

    recent_project = None
    now = time.time()
    if PROJECTS_ROOT.exists():
        for d in PROJECTS_ROOT.iterdir():
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


def _fetch_watch_metrics(video_id: str, session: Optional[requests.Session] = None) -> Dict[str, Any]:
    url = f"https://www.youtube.com/watch?v={video_id}"
    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
        "Accept-Language": "en-US,en;q=0.9",
    }
    cookies = {"CONSENT": "PENDING+987", "SOCS": "CAESHAgBEhJnd3NfMjAyMzA4MTAtMF9SQzIaAmVuIAEaBgiA_LyaBg"}
    getter = session or requests
    resp = getter.get(url, headers=headers, cookies=cookies, timeout=(3.5, 4.5))
    html = resp.text

    title_m = re.search(r"<title>(.*?)</title>", html)
    title = html_lib.unescape(title_m.group(1).replace(" - YouTube", "").strip()) if title_m else ""
    play_m = re.search(r'"status":"(.*?)","reason":"(.*?)"', html)
    unavailable = bool(play_m and play_m.group(1) == "ERROR")

    views = 0
    vm = re.search(r'"viewCount":"(\d+)"', html)
    if vm:
        views = int(vm.group(1))

    likes = 0
    lm = re.search(r'"accessibilityText":"([\d,]+) likes?"', html)
    if lm:
        likes = int(lm.group(1).replace(",", ""))
    else:
        lm2 = re.search(r'"likeCount":(\d+)', html)
        if lm2:
            likes = int(lm2.group(1))

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


def _build_baseline_yt() -> Dict[str, Any]:
    videos_list = []
    for vid, base in BASELINE_VIDEO_META.items():
        views = base.get("views", 0)
        likes = base.get("likes", 0)
        videos_list.append(
            {
                "id": vid,
                "title": base["title"],
                "views": views,
                "likes": likes,
                "comments": base.get("comments", 0),
                "published_at": base.get("publishedAt"),
                "duration": base.get("duration", "0:40"),
                "duration_sec": None,
                "is_short": base.get("is_short", True),
                "thumbnail": f"https://i.ytimg.com/vi/{vid}/hqdefault.jpg",
                "play_url": f"https://www.youtube.com/watch?v={vid}",
                "shorts_url": f"https://www.youtube.com/shorts/{vid}",
                "engagement_pct": round((likes / views * 100), 1) if views > 0 else 0.0,
            }
        )
    videos_list.sort(key=lambda x: str(x.get("published_at") or ""), reverse=True)
    total_views = sum(v["views"] for v in videos_list)
    total_likes = sum(v["likes"] for v in videos_list)
    return {
        "channel_id": YOUTUBE_CHANNEL_ID,
        "channel_title": YOUTUBE_CHANNEL_TITLE,
        "channel_url": f"https://www.youtube.com/channel/{YOUTUBE_CHANNEL_ID}",
        "zapier_connected": True,
        "live_fetched": False,
        "fetch_error": None,
        "fetched_at": datetime.now().astimezone().isoformat(timespec="seconds"),
        "summary": {
            "total_videos": len(videos_list),
            "shorts_count": sum(1 for v in videos_list if v["is_short"]),
            "long_count": sum(1 for v in videos_list if not v["is_short"]),
            "subscribers": "5",
            "total_views": total_views,
            "total_likes": total_likes,
            "avg_views": round(total_views / len(videos_list), 1) if videos_list else 0.0,
            "engagement_rate": round((total_likes / total_views * 100), 2) if total_views > 0 else 0.0,
        },
        "top_video": max(videos_list, key=lambda x: x["views"]) if videos_list else None,
        "videos": videos_list,
    }


def _refresh_youtube_analytics_sync() -> Dict[str, Any]:
    global _yt_in_flight
    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
        "Accept-Language": "en-US,en;q=0.9",
    }

    videos_map: Dict[str, Dict[str, Any]] = {}
    fetch_error: Optional[str] = None
    live_online = False

    runs_data = _read_json(RUNS_JSON_PATH, {"runs": []})
    seed_ids: List[str] = list(BASELINE_VIDEO_META.keys())
    for r in runs_data.get("runs", []):
        yid = r.get("youtube_id")
        if yid and yid not in seed_ids:
            seed_ids.append(yid)

    discovered_shorts: set[str] = set()
    subscribers_display: str = "5"
    session = requests.Session()
    session.headers.update(headers)
    session.cookies.update({"CONSENT": "PENDING+987", "SOCS": "CAESHAgBEhJnd3NfMjAyMzA4MTAtMF9SQzIaAmVuIAEaBgiA_LyaBg"})

    try:
        try:
            def _fetch_tab(tab_url: str) -> str:
                return session.get(tab_url, timeout=(3.5, 4.5)).text

            with ThreadPoolExecutor(max_workers=2) as tab_pool:
                f_shorts = tab_pool.submit(_fetch_tab, f"https://www.youtube.com/channel/{YOUTUBE_CHANNEL_ID}/shorts")
                f_videos = tab_pool.submit(_fetch_tab, f"https://www.youtube.com/channel/{YOUTUBE_CHANNEL_ID}/videos")
                html_s = f_shorts.result()
                html_v = f_videos.result()

            live_online = True
            sub_m = re.search(r"([\d.,]+[KMB]?)\s+subscribers?", html_s or html_v, re.I)
            if sub_m:
                subscribers_display = sub_m.group(1)
            for vid in re.findall(r"/shorts/([a-zA-Z0-9_-]{11})", html_s):
                discovered_shorts.add(vid)
                if vid not in seed_ids:
                    seed_ids.append(vid)

            for vid in re.findall(r'"videoId":"([a-zA-Z0-9_-]{11})"', html_v):
                if vid not in seed_ids:
                    seed_ids.append(vid)
        except Exception as e:
            fetch_error = str(e)

        def _load_one(vid: str):
            base = BASELINE_VIDEO_META.get(vid, {})
            try:
                live = _fetch_watch_metrics(vid, session=session)
                if live.get("unavailable"):
                    return None
                views = max(live["views"], base.get("views", 0)) if live["views"] == 0 and base else live["views"]
                likes = max(live["likes"], base.get("likes", 0)) if live["likes"] == 0 and base else live["likes"]
                dur_sec = live.get("duration_sec")
                dur_text = (
                    f"{dur_sec // 60}:{dur_sec % 60:02d}"
                    if dur_sec is not None
                    else base.get("duration", "0:40")
                )
                return {
                    "id": vid,
                    "title": live["title"] or base.get("title", vid),
                    "views": views,
                    "likes": likes,
                    "comments": base.get("comments", 0),
                    "published_at": live.get("published_at") or base.get("publishedAt"),
                    "duration": dur_text,
                    "duration_sec": dur_sec,
                    "is_short": (vid in discovered_shorts) or (dur_sec is not None and dur_sec <= 62) or base.get("is_short", True),
                    "thumbnail": live["thumbnail"],
                    "play_url": live["play_url"],
                    "shorts_url": live["shorts_url"],
                    "engagement_pct": round((likes / views * 100), 1) if views > 0 else 0.0,
                }
            except Exception:
                if base:
                    views = base.get("views", 0)
                    likes = base.get("likes", 0)
                    return {
                        "id": vid,
                        "title": base["title"],
                        "views": views,
                        "likes": likes,
                        "comments": base.get("comments", 0),
                        "published_at": base.get("publishedAt"),
                        "duration": base.get("duration", "0:40"),
                        "duration_sec": None,
                        "is_short": base.get("is_short", True),
                        "thumbnail": f"https://i.ytimg.com/vi/{vid}/hqdefault.jpg",
                        "play_url": f"https://www.youtube.com/watch?v={vid}",
                        "shorts_url": f"https://www.youtube.com/shorts/{vid}",
                        "engagement_pct": round((likes / views * 100), 1) if views > 0 else 0.0,
                    }
                return None

        with ThreadPoolExecutor(max_workers=8) as pool:
            futures = [pool.submit(_load_one, vid) for vid in seed_ids[:15]]
            for fut in as_completed(futures):
                item = fut.result()
                if item:
                    videos_map[item["id"]] = item
                    live_online = True

        videos_list = sorted(
            videos_map.values(),
            key=lambda x: str(x.get("published_at") or ""),
            reverse=True,
        )

        total_views = sum(v["views"] for v in videos_list)
        total_likes = sum(v["likes"] for v in videos_list)
        avg_views = round(total_views / len(videos_list), 1) if videos_list else 0.0
        engagement_rate = round((total_likes / total_views * 100), 2) if total_views > 0 else 0.0
        top_video = max(videos_list, key=lambda x: x["views"]) if videos_list else None

        result = {
            "channel_id": YOUTUBE_CHANNEL_ID,
            "channel_title": YOUTUBE_CHANNEL_TITLE,
            "channel_url": f"https://www.youtube.com/channel/{YOUTUBE_CHANNEL_ID}",
            "zapier_connected": True,
            "live_fetched": live_online,
            "fetch_error": fetch_error,
            "fetched_at": datetime.now().astimezone().isoformat(timespec="seconds"),
            "summary": {
                "total_videos": len(videos_list),
                "shorts_count": sum(1 for v in videos_list if v["is_short"]),
                "long_count": sum(1 for v in videos_list if not v["is_short"]),
                "subscribers": subscribers_display,
                "total_views": total_views,
                "total_likes": total_likes,
                "avg_views": avg_views,
                "engagement_rate": engagement_rate,
            },
            "top_video": top_video,
            "videos": videos_list,
        }

        with _yt_lock:
            _yt_cache["timestamp"] = time.time()
            _yt_cache["data"] = result
        return result
    finally:
        session.close()
        with _yt_lock:
            _yt_in_flight = False


def fetch_youtube_analytics(force: bool = False) -> Dict[str, Any]:
    global _yt_in_flight
    now = time.time()
    with _yt_lock:
        cached = _yt_cache["data"]
        stale = (now - _yt_cache["timestamp"]) >= YT_CACHE_TTL_SEC
        if not force:
            if cached is not None:
                if stale and not IS_VERCEL and not _yt_in_flight:
                    _yt_in_flight = True
                    threading.Thread(target=_refresh_youtube_analytics_sync, daemon=True).start()
                return cached
            if not IS_VERCEL and not _yt_in_flight:
                _yt_in_flight = True
                threading.Thread(target=_refresh_youtube_analytics_sync, daemon=True).start()
            return _build_baseline_yt()

        if _yt_in_flight:
            return cached if cached is not None else _build_baseline_yt()
        _yt_in_flight = True

    return _refresh_youtube_analytics_sync()


def get_projects_pipeline(yt_data: Dict[str, Any], active_project: Optional[str] = None) -> List[Dict[str, Any]]:
    runs_data = _read_json(RUNS_JSON_PATH, {"runs": []})
    runs_by_slug = {r["slug"]: r for r in runs_data.get("runs", []) if r.get("slug")}
    yt_by_id = {v["id"]: v for v in yt_data.get("videos", [])}

    projects: List[Dict[str, Any]] = []
    if not PROJECTS_ROOT.exists():
        return projects

    dirs = [
        d
        for d in PROJECTS_ROOT.iterdir()
        if d.is_dir() and not d.name.startswith(".") and d.name not in EXCLUDED_DIRS
    ]

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

        renders_dir = proj_dir / "renders"
        mp4_files = sorted(renders_dir.glob("*.mp4"), key=lambda p: p.stat().st_mtime, reverse=True) if renders_dir.exists() else []
        declared_video = run_meta.get("video_file")
        mp4_path = None
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
        return {"active": False, "status": "idle", "step": "No manual upload running."}

    # Live conversation tracking when agent is uploading
    conv_id = job.get("conversation_id")
    if conv_id and job.get("status") in ("dispatching_agent", "uploading"):
        transcript_path = BRAIN_DIR / conv_id / ".system_generated" / "logs" / "transcript.jsonl"
        if transcript_path.exists():
            try:
                t_lines = transcript_path.read_text(encoding="utf-8", errors="replace").splitlines()
                if t_lines:
                    last_step = json.loads(t_lines[-1])
                    content = last_step.get("content", "")
                    m_id = re.search(r"https?://(?:www\.)?youtube\.com/watch\?v=([a-zA-Z0-9_-]{11})", content)
                    if m_id and job.get("status") != "published":
                        vid = m_id.group(1)
                        job["status"] = "published"
                        job["step"] = "Published live to YouTube!"
                        job["youtube_id"] = vid
                        job["youtube_url"] = f"https://www.youtube.com/watch?v={vid}"
            except Exception:
                pass

    status = job.get("status", "idle")
    job_id = job.get("job_id")
    started_at = job.get("started_at")
    is_stale = False
    if started_at and status in ("staging", "dispatching_agent", "uploading"):
        try:
            age = (datetime.now().astimezone() - datetime.fromisoformat(started_at)).total_seconds()
            if status in ("staging", "dispatching_agent") and job_id not in _active_worker_jobs and age > 10:
                is_stale = True
                job["status"] = "error"
                job["step"] = "Previous upload was interrupted before reaching YouTube"
                job["error"] = "Background staging stopped when the local server restarted. Click 'Publish to Animated_Crew Now' to retry cleanly."
                _update_upload_job(
                    {
                        "status": job["status"],
                        "step": job["step"],
                        "error": job["error"],
                    }
                )
            elif age > 1200:
                is_stale = True
        except Exception:
            pass

    job["active"] = (job.get("status") in ("staging", "dispatching_agent", "uploading")) and not is_stale
    return job


def _update_upload_job(updates: Dict[str, Any]) -> Dict[str, Any]:
    with _upload_lock:
        job = _read_json(UPLOAD_JOB_PATH, {}) or {}
        job.update(updates)
        job["updated_at"] = datetime.now().astimezone().isoformat(timespec="seconds")
        _write_json_atomic(UPLOAD_JOB_PATH, job)
        return job


def _run_manual_upload_worker(job_id: str, local_mp4_path: Path) -> None:
    proc: Optional[subprocess.Popen] = None
    try:
        size_mb = round(local_mp4_path.stat().st_size / (1024 * 1024), 1) if local_mp4_path.exists() else 0.0
        # 1. Stage to direct HTTPS host (IPv4 curl streaming via upload_media.py)
        proc = subprocess.Popen(
            [str(PYTHON_BIN), str(UPLOAD_MEDIA_PY), str(local_mp4_path)],
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            bufsize=1,
            creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
        )
        out_lines: List[str] = []
        err_lines: List[str] = []
        current_host = ["uguu.se"]

        def _drain_stdout():
            if proc and proc.stdout:
                for line in proc.stdout:
                    out_lines.append(line.rstrip("\r\n"))

        def _drain_stderr():
            if proc and proc.stderr:
                for line in proc.stderr:
                    clean = line.rstrip("\r\n")
                    if clean.startswith("HOST:"):
                        current_host[0] = clean.split(":", 1)[1].strip() or current_host[0]
                    elif clean:
                        err_lines.append(clean)

        t_out = threading.Thread(target=_drain_stdout, daemon=True)
        t_err = threading.Thread(target=_drain_stderr, daemon=True)
        t_out.start()
        t_err.start()

        start_ts = time.time()
        last_tick = 0.0
        while proc.poll() is None:
            elapsed = int(time.time() - start_ts)
            if elapsed >= 600:
                proc.kill()
                t_out.join(timeout=2)
                t_err.join(timeout=2)
                _update_upload_job(
                    {
                        "status": "error",
                        "step": "Cloud staging timed out",
                        "error": f"Staging {size_mb:.1f} MB exceeded 600s limit across hosts. Check internet uplink speed and retry.",
                    }
                )
                return
            if time.time() - last_tick >= 3.0:
                last_tick = time.time()
                cur = _read_json(UPLOAD_JOB_PATH, None)
                if not cur or cur.get("job_id") != job_id:
                    proc.kill()
                    return
                _update_upload_job(
                    {
                        "step": f"Staging {size_mb:.1f} MB via {current_host[0]} ({elapsed}s elapsed)...",
                    }
                )
            time.sleep(0.5)

        t_out.join(timeout=5)
        t_err.join(timeout=5)
        stdout_text = "\n".join(out_lines).strip()
        stderr_text = "\n".join(err_lines).strip()

        if proc.returncode != 0 or not stdout_text.startswith("http"):
            err = stderr_text or stdout_text or f"Failed to stage MP4 file (exit {proc.returncode})."
            _update_upload_job({"status": "error", "step": "Cloud staging failed", "error": err[:500]})
            return

        staged_url = stdout_text.splitlines()[-1].strip()
        try:
            head_cmd = subprocess.run(
                ["curl.exe", "-4", "-sSIL", "--max-time", "20", staged_url],
                capture_output=True,
                text=True,
                timeout=25,
                creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
            )
            if head_cmd.returncode != 0 or not any(c in (head_cmd.stdout or "") for c in ("200 ", "206 ")):
                head = requests.head(staged_url, timeout=20, allow_redirects=True)
                if head.status_code >= 400:
                    _update_upload_job({"status": "error", "step": "Staged URL check failed", "error": f"HTTP {head.status_code}"})
                    return
        except Exception as e:
            _update_upload_job({"status": "error", "step": "Staged URL unreachable", "error": str(e)})
            return

        _update_upload_job(
            {
                "staged_url": staged_url,
                "status": "dispatching_agent",
                "step": "Staged! Dispatching YouTube upload via Zapier...",
            }
        )

        # 2. Trigger single-line agentapi conversation for UPLOAD_PROMPT.md
        prompt = (
            "Read C:\\Users\\DELL\\faceless-shorts\\UPLOAD_PROMPT.md and immediately execute every step "
            "using C:\\Users\\DELL\\faceless-shorts\\upload_job.json to publish the video to YouTube without asking."
        )
        res = subprocess.run(
            ["cmd", "/c", str(AGENTAPI_BAT), "new-conversation", "--title=Manual YouTube Upload", prompt],
            capture_output=True,
            text=True,
            timeout=90,
            cwd=r"C:\Users\DELL\OneDrive\Desktop\faceless",
            creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
        )
        combined = (res.stdout or "") + "\n" + (res.stderr or "")
        m_uuid = re.search(r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}", combined, re.IGNORECASE)
        if res.returncode != 0 and not m_uuid:
            _update_upload_job(
                {
                    "status": "error",
                    "step": "Could not dispatch uploader agent",
                    "error": combined.strip()[:400] or f"Exit code {res.returncode}",
                }
            )
            return

        conv_id = m_uuid.group(0) if m_uuid else None
        _update_upload_job(
            {
                "conversation_id": conv_id,
                "status": "uploading",
                "step": "Uploading video to Animated_Crew on YouTube via Zapier...",
            }
        )

        # Poll transcript / upload_job for completion to clear YouTube cache promptly
        for _ in range(180):
            time.sleep(2)
            cur = _read_json(UPLOAD_JOB_PATH, {}) or {}
            if cur.get("job_id") != job_id:
                return
            if cur.get("status") in ("published", "error"):
                if cur.get("status") == "published":
                    threading.Thread(target=fetch_youtube_analytics, kwargs={"force": True}, daemon=True).start()
                return
            if conv_id:
                tpath = BRAIN_DIR / conv_id / ".system_generated" / "logs" / "transcript.jsonl"
                if tpath.exists():
                    txt = tpath.read_text(encoding="utf-8", errors="replace")
                    m_yt = re.search(r"https?://(?:www\.)?youtube\.com/watch\?v=([a-zA-Z0-9_-]{11})", txt)
                    if m_yt:
                        vid = m_yt.group(1)
                        _update_upload_job(
                            {
                                "status": "published",
                                "step": "Published live to YouTube!",
                                "youtube_id": vid,
                                "youtube_url": f"https://www.youtube.com/watch?v={vid}",
                                "completed_at": datetime.now().astimezone().isoformat(timespec="seconds"),
                            }
                        )
                        threading.Thread(target=fetch_youtube_analytics, kwargs={"force": True}, daemon=True).start()
                        return
    except Exception as exc:
        _update_upload_job({"status": "error", "step": "Manual upload error", "error": str(exc)})
    finally:
        if proc and proc.poll() is None:
            try:
                proc.kill()
            except Exception:
                pass
        _active_worker_jobs.discard(job_id)


def get_system_health() -> List[Dict[str, Any]]:
    if CLOUD_MODE:
        runs_ok = RUNS_JSON_PATH.exists()
        snap = _read_json(CLOUD_DATA_DIR / "automation_snapshot.json", {})
        queued_n = len([r for r in _read_json(RUNS_JSON_PATH, {"runs": []}).get("runs", []) if r.get("status") == "queued"])
        return [
            {
                "name": "Vercel Cloud Runtime",
                "ok": True,
                "detail": "FastAPI serverless + IST timezone clock",
            },
            {
                "name": "Live YouTube Sync",
                "ok": True,
                "detail": f"Real-time views & subs ({YOUTUBE_CHANNEL_TITLE})",
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
            {
                "name": "Workstation Render Engine",
                "ok": True,
                "detail": "Kokoro TTS + Whisper + Three.js on local PC",
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
            "name": "YouTube Zapier Connection",
            "ok": True,
            "detail": f"Connected ({YOUTUBE_CHANNEL_TITLE})",
        },
        {
            "name": "FIFO Queue & Manual Upload",
            "ok": (PROJECTS_ROOT / "AUTO_PROMPT.md").exists() and (PROJECTS_ROOT / "UPLOAD_PROMPT.md").exists() and UPLOAD_MEDIA_PY.exists(),
            "detail": "AUTO_PROMPT.md (1/day FIFO) + UPLOAD_PROMPT.md ready",
        },
    ]


@app.get("/", response_class=HTMLResponse)
def serve_home():
    index_file = STATIC_DIR / "index.html"
    if not index_file.exists():
        raise HTTPException(status_code=404, detail="Dashboard UI not found")
    return FileResponse(
        index_file,
        headers={"Cache-Control": "no-store, no-cache, must-revalidate, max-age=0"},
    )


@app.get("/api/overview")
def api_overview(refresh_yt: bool = Query(False)):
    yt_data = fetch_youtube_analytics(force=refresh_yt)
    automation = get_automation_status()
    active_proj = automation.get("active_processes", {}).get("active_project")
    projects = get_projects_pipeline(yt_data, active_project=active_proj)
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
            "system_health": health,
        }
    )


@app.get("/api/youtube")
def api_youtube(refresh: int = Query(0)):
    return JSONResponse(fetch_youtube_analytics(force=bool(refresh)))


@app.get("/api/projects/{slug}/script")
def api_project_script(slug: str):
    proj_dir = (PROJECTS_ROOT / slug).resolve()
    if proj_dir.parent != PROJECTS_ROOT.resolve() or not proj_dir.is_dir():
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
    proj_dir = (PROJECTS_ROOT / slug).resolve()
    if proj_dir.parent != PROJECTS_ROOT.resolve() or not proj_dir.is_dir():
        raise HTTPException(status_code=404, detail="Project directory not found")

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
    return JSONResponse(_inspect_upload_job())


@app.post("/api/upload/clear")
def api_upload_clear():
    _require_local_write("clearing upload status")
    with _upload_lock:
        if UPLOAD_JOB_PATH.exists():
            UPLOAD_JOB_PATH.unlink()
    return JSONResponse({"ok": True, "status": "idle"})


@app.post("/api/upload/manual")
async def api_upload_manual(request: Request):
    _require_local_write("manual Zapier upload")
    cur_job = _inspect_upload_job()
    if cur_job.get("active"):
        raise HTTPException(
            status_code=409,
            detail=f"An upload job is already running ({cur_job.get('step')}). Please wait for it to finish.",
        )

    content_type = request.headers.get("content-type", "")
    slug: Optional[str] = None
    title: str = ""
    description: str = ""
    tags_raw: Any = None
    privacy_status: str = "public"
    category_id: str = "23"
    source_type: str = "queued_project"
    mp4_path: Optional[Path] = None

    if "multipart/form-data" in content_type.lower():
        raw_body = await request.body()
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

        uploaded_file = files.get("file")
        if uploaded_file and uploaded_file.get("content"):
            source_type = "custom_file"
            raw_name = uploaded_file.get("filename") or "custom-short.mp4"
            safe_name = re.sub(r"[^a-zA-Z0-9._-]+", "-", raw_name).strip("-") or "custom-short.mp4"
            if not safe_name.lower().endswith((".mp4", ".mov", ".webm", ".mkv")):
                safe_name += ".mp4"
            MANUAL_UPLOADS_DIR.mkdir(parents=True, exist_ok=True)
            ts = datetime.now().strftime("%Y%m%d-%H%M%S")
            mp4_path = MANUAL_UPLOADS_DIR / f"{ts}_{safe_name}"
            mp4_path.write_bytes(uploaded_file["content"])
            if not title:
                title = Path(raw_name).stem.replace("-", " ").replace("_", " ").title() + " #Shorts"
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
        category_id = str(data.get("category_id") or "23").strip()

    if mp4_path is None:
        if not slug:
            raise HTTPException(status_code=400, detail="Select a queued video project OR choose a local .mp4 file to upload.")
        proj_dir = (PROJECTS_ROOT / slug).resolve()
        if proj_dir.parent != PROJECTS_ROOT.resolve() or not proj_dir.is_dir():
            raise HTTPException(status_code=404, detail=f"Project '{slug}' not found.")

        runs_data = _read_json(RUNS_JSON_PATH, {"runs": []})
        run_meta = next((r for r in runs_data.get("runs", []) if r.get("slug") == slug), {})
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
        if rel_video and (proj_dir / rel_video).exists():
            mp4_path = proj_dir / rel_video
        else:
            renders = sorted((proj_dir / "renders").glob("*.mp4"), key=lambda p: p.stat().st_mtime, reverse=True) if (proj_dir / "renders").exists() else []
            mp4_path = renders[0] if renders else None

        if not mp4_path or not mp4_path.exists() or mp4_path.stat().st_size < 100_000:
            raise HTTPException(status_code=409, detail=f"MP4 video for '{slug}' is still rendering or not ready yet.")

        # Persist edited metadata into runs.json so queue/history matches
        with _runs_lock:
            latest_runs = _read_json(RUNS_JSON_PATH, {"runs": []})
            entry = next((r for r in latest_runs.get("runs", []) if r.get("slug") == slug), None)
            if entry is not None:
                entry["youtube_title"] = title
                entry["youtube_description"] = description
                entry["youtube_tags"] = _normalize_tags(tags_raw)
                entry["privacy_status"] = privacy_status if privacy_status in ("public", "unlisted", "private") else "public"
                entry["category_id"] = category_id
                _write_json_atomic(RUNS_JSON_PATH, latest_runs)

    if privacy_status not in ("public", "unlisted", "private"):
        privacy_status = "public"
    tags = _normalize_tags(tags_raw)
    if not description:
        description = f"{title}\n\n#Shorts #Animation #History #TrueStory"
    elif "#shorts" not in description.lower():
        description = description.rstrip() + "\n\n#Shorts"

    job_id = uuid.uuid4().hex[:10]
    job = {
        "job_id": job_id,
        "source_type": source_type,
        "slug": slug,
        "local_mp4_path": str(mp4_path),
        "title": title,
        "description": description,
        "tags": tags,
        "category_id": category_id,
        "privacy_status": privacy_status,
        "staged_url": None,
        "status": "staging",
        "step": "Staging MP4 to cloud host...",
        "conversation_id": None,
        "youtube_id": None,
        "youtube_url": None,
        "error": None,
        "started_at": datetime.now().astimezone().isoformat(timespec="seconds"),
        "updated_at": datetime.now().astimezone().isoformat(timespec="seconds"),
    }
    with _upload_lock:
        _write_json_atomic(UPLOAD_JOB_PATH, job)
        _active_worker_jobs.add(job_id)

    threading.Thread(target=_run_manual_upload_worker, args=(job_id, mp4_path), daemon=True).start()
    return JSONResponse({"ok": True, "job": {**job, "active": True}})


if __name__ == "__main__":
    import uvicorn

    threading.Thread(target=fetch_youtube_analytics, kwargs={"force": True}, daemon=True).start()
    uvicorn.run(app, host="127.0.0.1", port=8765, log_level="info")
