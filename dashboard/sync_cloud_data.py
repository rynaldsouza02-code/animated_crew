"""Sync lightweight queue, script, cover & sanitized scheduler snapshots into dashboard/cloud_data/ for Vercel hosting."""
from __future__ import annotations

import json
import shutil
import wave
from datetime import datetime
from pathlib import Path

PROJECTS_ROOT = Path(r"C:\Users\DELL\faceless-shorts")
CLOUD_DATA_DIR = Path(__file__).resolve().parent / "cloud_data"
GEMINI_CONFIG_JSON = Path(r"C:\Users\DELL\.gemini\config\config.json")
SIDECAR_JSON = Path(r"C:\Users\DELL\.gemini\config\sidecars\daily-viral-shorts\sidecar.json")
SIDECAR_LOG = Path(r"C:\Users\DELL\.gemini\antigravity\sidecar_data\daily-viral-shorts\logs\sidecar.log")
EXCLUDED_DIRS = {"manual-uploads", "__pycache__", "renders", "review", "tmp", "temp"}


def _wav_duration(path: Path) -> float | None:
    try:
        if not path.exists():
            return None
        with wave.open(str(path), "rb") as w:
            rate = w.getframerate()
            return round(w.getnframes() / float(rate), 2) if rate else None
    except Exception:
        return None


def _read_json(path: Path, default):
    try:
        if path.exists():
            return json.loads(path.read_text(encoding="utf-8", errors="replace"))
    except Exception:
        pass
    return default


def sync() -> None:
    if not PROJECTS_ROOT.exists():
        raise SystemExit(f"Local projects root not found: {PROJECTS_ROOT}")

    CLOUD_DATA_DIR.mkdir(parents=True, exist_ok=True)
    # Remove stale image/json artifacts safely without triggering OneDrive rmdir locks
    for old_file in CLOUD_DATA_DIR.rglob("*"):
        if old_file.is_file() and old_file.suffix.lower() in (".mp4", ".wav"):
            try:
                old_file.unlink()
            except Exception:
                pass

    runs_data = _read_json(PROJECTS_ROOT / "runs.json", {"runs": []})
    runs_out = json.loads(json.dumps(runs_data))

    for r in runs_out.get("runs", []):
        slug = r.get("slug")
        if not slug:
            continue
        proj_dir = PROJECTS_ROOT / slug
        if not proj_dir.is_dir():
            continue

        # Record exact rendered MP4 & duration metadata so Vercel displays accurate sizes/ready state
        declared = r.get("video_file")
        mp4_path = proj_dir / declared if declared and (proj_dir / declared).exists() else None
        if not mp4_path and (proj_dir / "renders").exists():
            mp4s = sorted((proj_dir / "renders").glob("*.mp4"), key=lambda p: p.stat().st_mtime, reverse=True)
            mp4_path = mp4s[0] if mp4s else None

        if mp4_path and mp4_path.exists():
            r["rendered_mp4_name"] = mp4_path.name
            r["rendered_size_mb"] = round(mp4_path.stat().st_size / (1024 * 1024), 2)
            r["mp4_ready_snapshot"] = mp4_path.stat().st_size > 100_000

        mix_dur = _wav_duration(proj_dir / "data" / "mix.wav") or _wav_duration(proj_dir / "data" / "narration.wav")
        if mix_dur:
            r["rendered_duration_sec"] = mix_dur

        # Strip notes with internal paths if any; keep clean metadata
        dest = CLOUD_DATA_DIR / slug
        (dest / "data").mkdir(parents=True, exist_ok=True)
        (dest / "review" / "cover").mkdir(parents=True, exist_ok=True)

        for rel in ["script.json", "data/lines.json", "data/cues.json", "data/words.json", "review/all.jpg"]:
            src = proj_dir / rel
            if src.exists():
                shutil.copy2(src, dest / rel)

        cover_dir = proj_dir / "review" / "cover"
        if cover_dir.exists():
            covers = sorted(cover_dir.glob("*.jpg"), key=lambda p: p.stat().st_mtime, reverse=True)
            if covers:
                shutil.copy2(covers[0], dest / "review" / "cover" / covers[0].name)

    (CLOUD_DATA_DIR / "runs.json").write_text(
        json.dumps(runs_out, indent=2, ensure_ascii=False), encoding="utf-8"
    )

    monetization_src = PROJECTS_ROOT / "monetization.json"
    if monetization_src.exists():
        shutil.copy2(monetization_src, CLOUD_DATA_DIR / "monetization.json")

    # Sanitized scheduler snapshot (no secret IDs or local prompt contents)
    cfg = _read_json(GEMINI_CONFIG_JSON, {})
    sidecar = _read_json(SIDECAR_JSON, {})
    enabled = bool(cfg.get("sidecars", {}).get("daily-viral-shorts", {}).get("enabled", True))
    cron_str = (sidecar.get("args") or ["CRON_TZ=Asia/Kolkata 0 19 * * *"])[0]
    safe_logs = []
    if SIDECAR_LOG.exists():
        for line in SIDECAR_LOG.read_text(encoding="utf-8", errors="replace").splitlines()[-40:]:
            if "[schedule]" in line or "sidecar" in line:
                clean = line.replace(r"C:\Users\DELL", "~").strip()
                if "cron" in clean.lower() or "next execution" in clean.lower() or "sidecar" in clean.lower():
                    safe_logs.append(clean)

    auto_snapshot = {
        "enabled": enabled,
        "display_name": sidecar.get("display_name", "Daily Viral Tall Tale Short"),
        "description": sidecar.get("description", "Daily 7:00 PM IST automated Tall Tale Short publisher."),
        "cron_str": cron_str,
        "latest_conversation_note": "Workstation daemon armed · FIFO queue uploads 1 Short/day at 7:00 PM IST.",
        "log_tail": safe_logs[-12:] or [
            "=== workstation sidecar \"daily-viral-shorts\" armed ===",
            "[schedule] CRON_TZ=Asia/Kolkata 0 19 * * * (Daily 7:00 PM IST)",
        ],
        "synced_at": datetime.now().astimezone().isoformat(timespec="seconds"),
    }
    (CLOUD_DATA_DIR / "automation_snapshot.json").write_text(
        json.dumps(auto_snapshot, indent=2, ensure_ascii=False), encoding="utf-8"
    )

    total_kb = sum(f.stat().st_size for f in CLOUD_DATA_DIR.rglob("*") if f.is_file()) / 1024
    print(f"Synced cloud_data cleanly ({total_kb:.1f} KB total across {len(runs_out.get('runs', []))} runs).")


if __name__ == "__main__":
    sync()
