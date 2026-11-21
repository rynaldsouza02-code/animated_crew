#!/usr/bin/env python3
"""Video Queue & Upload Manager for Faceless Shorts & CrewTube Studio Hub.

Provides comprehensive management for queuing rendered videos and publishing them to YouTube.
Syncs with the live dashboard at http://localhost:8765/.

Commands:
  python queue_manager.py list
  python queue_manager.py add <slug_or_path> [--title "My Title"] [--privacy public|unlisted|private]
  python queue_manager.py reorder <slug> <order_num | up | down | top | bottom>
  python queue_manager.py remove <slug>
  python queue_manager.py next
  python queue_manager.py upload [--slug <slug>] [--next]
  python queue_manager.py scan [--auto-queue]
"""
from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import subprocess
import sys
import uuid
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional

# Core paths
PROJECT_ROOTS = [p for p in (Path(r"D:\faceless-shorts"), Path(r"C:\Users\DELL\faceless-shorts")) if p.exists()]
WORKSPACE_SHORTS = Path(r"C:\Users\DELL\OneDrive\Desktop\roblex\faceless-shorts")
DASHBOARD_DIR = Path(r"C:\Users\DELL\OneDrive\Desktop\faceless\dashboard")
SYNC_SCRIPT = DASHBOARD_DIR / "sync_cloud_data.py"
UPLOAD_MEDIA_SCRIPT = DASHBOARD_DIR / "upload_media.py"
FINALIZE_SCRIPT = DASHBOARD_DIR / "finalize_upload.py"
PYTHON_EXE = Path(r"C:\Python314\python.exe") if Path(r"C:\Python314\python.exe").exists() else Path(sys.executable)


def _read_json(path: Path, default: Any = None) -> Any:
    if not path.exists():
        return default
    try:
        return json.loads(path.read_text(encoding="utf-8", errors="replace"))
    except Exception:
        return default


def _write_json_atomic(path: Path, data: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + f".{uuid.uuid4().hex[:6]}.tmp")
    tmp.write_text(json.dumps(data, indent=2, ensure_ascii=False), encoding="utf-8")
    tmp.replace(path)


def load_runs_data() -> Dict[str, Any]:
    for r in PROJECT_ROOTS:
        rp = r / "runs.json"
        if rp.exists():
            data = _read_json(rp)
            if data and isinstance(data, dict):
                return data
    return {"channel_id": "UCT-NT5b7lbS1mqaITYfeZ4g", "channel_title": "Animated_Crew", "runs": []}


def save_runs_data(data: Dict[str, Any]) -> None:
    # Normalize queue_order
    queued = [r for r in data.get("runs", []) if r.get("status") == "queued"]
    queued.sort(
        key=lambda item: (
            int(item["queue_order"]) if isinstance(item.get("queue_order"), (int, float)) else 999999,
            str(item.get("created_at") or ""),
            str(item.get("slug") or ""),
        )
    )
    for idx, r in enumerate(queued, start=1):
        r["queue_order"] = idx
        r["notes"] = (
            "Queued #1: Next scheduled automatic upload at 7:30 PM IST (only 1 queued video uploads per day)."
            if idx == 1
            else f"Queued #{idx}: Held in queue for future daily auto-upload at 7:30 PM IST."
        )

    for r in data.get("runs", []):
        if r.get("status") != "queued":
            r["queue_order"] = None

    for root in PROJECT_ROOTS:
        _write_json_atomic(root / "runs.json", data)

    # Sync cloud data for dashboard at http://localhost:8765/
    if SYNC_SCRIPT.exists():
        try:
            subprocess.run([str(PYTHON_EXE), str(SYNC_SCRIPT)], capture_output=True, text=True, timeout=15)
        except Exception:
            pass


def find_video_mp4(slug_or_dir: str) -> Optional[Path]:
    p = Path(slug_or_dir)
    if p.is_file() and p.suffix.lower() == ".mp4" and p.exists():
        return p

    candidates: List[Path] = []
    if p.is_dir():
        candidates.append(p)
    else:
        for root in PROJECT_ROOTS:
            candidates.append(root / slug_or_dir)
        candidates.append(WORKSPACE_SHORTS / "styles" / slug_or_dir / "example")
        candidates.append(Path(r"C:\Users\DELL\faceless-shorts\_selftest") / slug_or_dir)

    for cand_dir in candidates:
        if cand_dir.exists():
            rdir = cand_dir / "renders"
            if rdir.exists():
                renders = sorted(rdir.glob("*.mp4"), key=lambda f: f.stat().st_mtime, reverse=True)
                for f in renders:
                    if f.stat().st_size > 50_000:
                        return f
            for f in cand_dir.glob("*.mp4"):
                if f.stat().st_size > 50_000:
                    return f
    return None


def cmd_list(args: argparse.Namespace) -> None:
    data = load_runs_data()
    runs = data.get("runs", [])
    queued = [r for r in runs if r.get("status") == "queued"]
    queued.sort(key=lambda r: int(r.get("queue_order") or 999))
    published = [r for r in runs if r.get("status") == "published"]
    drafts = [r for r in runs if r.get("status") not in ("queued", "published")]

    print("\n" + "=" * 80)
    print(f"🎬 FACELESS SHORTS QUEUE MANAGER — CHANNEL: @Animated_Crew")
    print(f"🌐 Dashboard: http://localhost:8765/ | Daily Auto-Drop: 7:30 PM IST")
    print("=" * 80)

    print(f"\n📋 QUEUED VIDEOS ({len(queued)} waiting for daily drops):")
    if not queued:
        print("  (Queue is currently empty)")
    else:
        print(f"  {'#':<4} {'SLUG':<30} {'DURATION':<10} {'SIZE':<10} {'TITLE'}")
        print("  " + "-" * 76)
        for r in queued:
            order = f"#{r.get('queue_order', '?')}"
            slug = r.get("slug", "")[:28]
            dur = f"{r.get('rendered_duration_sec', 0):.1f}s" if r.get("rendered_duration_sec") else "--"
            size = f"{r.get('rendered_size_mb', 0):.1f}MB" if r.get("rendered_size_mb") else "--"
            title = r.get("youtube_title") or r.get("title") or ""
            print(f"  {order:<4} {slug:<30} {dur:<10} {size:<10} {title[:32]}")

    print(f"\n✅ RECENTLY PUBLISHED ({len(published)}):")
    for r in published[-5:]:
        slug = r.get("slug", "")
        yurl = r.get("youtube_url") or f"https://youtu.be/{r.get('youtube_id')}"
        title = (r.get("youtube_title") or r.get("title") or "")[:40]
        print(f"  • {slug:<30} -> {yurl} ({title})")

    if drafts:
        print(f"\n📝 DRAFTS / UNQUEUED PROJECTS ({len(drafts)}):")
        for r in drafts[:6]:
            print(f"  • {r.get('slug', ''):<30} ({r.get('title', '')})")
    print("\n" + "=" * 80 + "\n")


def cmd_add(args: argparse.Namespace) -> None:
    slug_or_path = args.target.strip()
    mp4_file = find_video_mp4(slug_or_path)
    if not mp4_file:
        print(f"❌ Error: Could not find rendered MP4 video for '{slug_or_path}'.", file=sys.stderr)
        print("   Make sure the video is rendered into `<project>/renders/*.mp4`.", file=sys.stderr)
        sys.exit(1)

    slug = Path(slug_or_path).name.replace(".mp4", "")
    if slug == "renders":
        slug = Path(slug_or_path).parent.name

    data = load_runs_data()
    runs = data.setdefault("runs", [])
    entry = next((r for r in runs if r.get("slug") == slug), None)

    # Check for script.json for metadata
    script_meta = {}
    for base in PROJECT_ROOTS + [WORKSPACE_SHORTS]:
        sp = base / slug / "script.json"
        if sp.exists():
            script_meta = _read_json(sp, {})
            break

    title = args.title or script_meta.get("title") or (entry.get("title") if entry else None) or slug.replace("-", " ").title()
    desc = args.description or (
        f"{title}\n\nSubscribe to @Animated_Crew for incredible true stories and animated explainers!\n\n#Shorts #AnimatedCrew"
    )
    tags = ["Shorts", "AnimatedCrew", "Animation", "Viral", "Story"]
    privacy = args.privacy or (entry.get("privacy_status") if entry else "public")

    file_size_mb = round(mp4_file.stat().st_size / (1024 * 1024), 2)
    rel_video = f"renders/{mp4_file.name}"

    if entry is None:
        entry = {
            "slug": slug,
            "title": title,
            "style": script_meta.get("style", "tall-tale"),
            "created_at": datetime.now().astimezone().isoformat(timespec="seconds"),
            "status": "queued",
            "stage": "ready_in_queue",
            "queue_order": 9999,
            "video_file": rel_video,
            "rendered_mp4_name": mp4_file.name,
            "youtube_title": f"{title} 🎬 #Shorts",
            "youtube_description": desc,
            "youtube_tags": tags,
            "privacy_status": privacy,
            "category_id": "23",
            "rendered_size_mb": file_size_mb,
            "mp4_ready_snapshot": True,
        }
        runs.append(entry)
    else:
        entry["status"] = "queued"
        entry["stage"] = "ready_in_queue"
        entry["video_file"] = rel_video
        entry["rendered_mp4_name"] = mp4_file.name
        entry["rendered_size_mb"] = file_size_mb
        entry["mp4_ready_snapshot"] = True
        if args.title:
            entry["youtube_title"] = args.title
        if args.privacy:
            entry["privacy_status"] = args.privacy
        if entry.get("queue_order") is None:
            entry["queue_order"] = 9999

    save_runs_data(data)
    print(f"✅ Successfully enqueued '{slug}'!")
    print(f"   Video: {mp4_file} ({file_size_mb} MB)")
    print(f"   Assigned Queue Position: #{entry.get('queue_order')}")
    print(f"   Title: {entry.get('youtube_title')}")
    print(f"   Dashboard updated at http://localhost:8765/")


def cmd_reorder(args: argparse.Namespace) -> None:
    slug = args.slug.strip()
    action = args.action.strip().lower()
    data = load_runs_data()
    queued = [r for r in data.get("runs", []) if r.get("status") == "queued"]
    queued.sort(key=lambda r: int(r.get("queue_order") or 999))

    idx = next((i for i, r in enumerate(queued) if r.get("slug") == slug), None)
    if idx is None:
        print(f"❌ Error: '{slug}' is not currently in the queue.", file=sys.stderr)
        sys.exit(1)

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
    elif action.isdigit():
        target_pos = max(1, min(len(queued), int(action))) - 1
        item = queued.pop(idx)
        queued.insert(target_pos, item)
    else:
        print(f"❌ Error: Invalid reorder action '{action}'. Use up, down, top, bottom, or position number.", file=sys.stderr)
        sys.exit(1)

    for pos, r in enumerate(queued, start=1):
        r["queue_order"] = pos

    save_runs_data(data)
    print(f"✅ Reordered queue. '{slug}' is now at position #{next(r['queue_order'] for r in queued if r['slug'] == slug)}.")
    print("   Dashboard updated at http://localhost:8765/")


def cmd_remove(args: argparse.Namespace) -> None:
    slug = args.slug.strip()
    data = load_runs_data()
    runs = data.get("runs", [])
    entry = next((r for r in runs if r.get("slug") == slug), None)
    if not entry or entry.get("status") != "queued":
        print(f"❌ '{slug}' is not currently in the queue.")
        return

    entry["status"] = "draft"
    entry["queue_order"] = None
    entry["notes"] = "Unqueued by manager back to draft."
    save_runs_data(data)
    print(f"✅ Removed '{slug}' from active upload queue (status set to draft).")


def cmd_next(args: argparse.Namespace) -> None:
    data = load_runs_data()
    queued = [r for r in data.get("runs", []) if r.get("status") == "queued"]
    queued.sort(key=lambda r: int(r.get("queue_order") or 999))
    if not queued:
        print("⚠️ Queue is empty! No video scheduled for next drop.")
        return
    nxt = queued[0]
    print(f"\n🎯 NEXT SCHEDULED VIDEO FOR 7:30 PM IST DROP:")
    print(f"   Position:   #1 (Front of Queue)")
    print(f"   Slug:       {nxt.get('slug')}")
    print(f"   Title:      {nxt.get('youtube_title') or nxt.get('title')}")
    print(f"   Video File: {nxt.get('video_file')} ({nxt.get('rendered_size_mb')} MB)")
    print(f"   Privacy:    {nxt.get('privacy_status', 'public')}")
    print(f"   Channel:    @Animated_Crew\n")


def cmd_upload(args: argparse.Namespace) -> None:
    data = load_runs_data()
    queued = [r for r in data.get("runs", []) if r.get("status") == "queued"]
    queued.sort(key=lambda r: int(r.get("queue_order") or 999))

    target = None
    if args.slug:
        target = next((r for r in queued if r.get("slug") == args.slug), None)
        if not target:
            target = next((r for r in data.get("runs", []) if r.get("slug") == args.slug), None)
    elif queued:
        target = queued[0]

    if not target:
        print("❌ Error: No video found to upload.", file=sys.stderr)
        sys.exit(1)

    slug = target["slug"]
    mp4_path = find_video_mp4(slug)
    if not mp4_path or not mp4_path.exists():
        print(f"❌ Error: Rendered MP4 not found for '{slug}'.", file=sys.stderr)
        sys.exit(1)

    print(f"\n🚀 Initiating Upload for '{slug}'...")
    print(f"   Title: {target.get('youtube_title') or target.get('title')}")
    print(f"   File:  {mp4_path} ({round(mp4_path.stat().st_size / (1024*1024), 2)} MB)")

    # 1. Trigger via dashboard API if running
    import urllib.request
    try:
        req = urllib.request.Request(
            "http://127.0.0.1:8765/api/upload/manual",
            data=json.dumps({"slug": slug, "force": True}).encode("utf-8"),
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        with urllib.request.urlopen(req, timeout=10) as resp:
            res = json.loads(resp.read().decode("utf-8"))
            if res.get("ok"):
                print("✅ Upload dispatched to live dashboard background worker!")
                print(f"   Track progress at: http://localhost:8765/")
                return
    except Exception as e:
        print(f"ℹ️ Dashboard worker not answering ({e}); staging directly via upload_media.py...")

    # Fallback direct staging
    if UPLOAD_MEDIA_SCRIPT.exists():
        proc = subprocess.run([str(PYTHON_EXE), str(UPLOAD_MEDIA_SCRIPT), str(mp4_path)], capture_output=True, text=True)
        if proc.returncode == 0 and proc.stdout.strip().startswith("http"):
            staged_url = proc.stdout.strip().splitlines()[-1]
            print(f"✅ Video staged at: {staged_url}")
            print(f"   Ready for Zapier YouTube upload.")
        else:
            print(f"❌ Staging error: {proc.stderr or proc.stdout}")


def cmd_scan(args: argparse.Namespace) -> None:
    data = load_runs_data()
    existing_slugs = {r.get("slug") for r in data.get("runs", [])}
    found = []

    for base in PROJECT_ROOTS + [WORKSPACE_SHORTS]:
        if not base.exists():
            continue
        for child in base.iterdir():
            if child.is_dir() and not child.name.startswith((".", "_")):
                rdir = child / "renders"
                if rdir.exists():
                    mp4s = list(rdir.glob("*.mp4"))
                    if mp4s and child.name not in existing_slugs:
                        found.append((child.name, mp4s[0]))

    print(f"\n🔎 Scan found {len(found)} unrecorded rendered project(s):")
    for slug, mp4 in found:
        print(f"   • {slug} -> {mp4.name} ({round(mp4.stat().st_size/(1024*1024), 2)} MB)")
        if args.auto_queue:
            print(f"     Auto-enqueuing '{slug}'...")
            fake_args = argparse.Namespace(target=slug, title=None, description=None, privacy="public")
            cmd_add(fake_args)


def main() -> None:
    parser = argparse.ArgumentParser(description="Video Queue & Upload Manager for Faceless Shorts")
    sub = parser.add_subparsers(dest="command")

    # list
    sub.add_parser("list", help="List all queued and recent videos")

    # add
    p_add = sub.add_parser("add", help="Add a rendered video to the upload queue")
    p_add.add_argument("target", help="Project slug, folder path, or direct .mp4 file")
    p_add.add_argument("--title", help="YouTube video title")
    p_add.add_argument("--description", help="YouTube video description")
    p_add.add_argument("--privacy", choices=["public", "unlisted", "private"], default="public")

    # reorder
    p_reorder = sub.add_parser("reorder", help="Reorder a video in the queue")
    p_reorder.add_argument("slug", help="Project slug")
    p_reorder.add_argument("action", help="up, down, top, bottom, or specific position (1, 2, ...)")

    # remove
    p_remove = sub.add_parser("remove", help="Remove a video from the queue")
    p_remove.add_argument("slug", help="Project slug to unqueue")

    # next
    sub.add_parser("next", help="Show the next video scheduled for 7:30 PM IST drop")

    # upload
    p_upload = sub.add_parser("upload", help="Upload next video in queue (or specific slug)")
    p_upload.add_argument("--slug", help="Specific slug to upload")
    p_upload.add_argument("--next", action="store_true", help="Upload the front-of-queue video")

    # scan
    p_scan = sub.add_parser("scan", help="Scan disks for rendered videos")
    p_scan.add_argument("--auto-queue", action="store_true", help="Automatically enqueue any found videos")

    args = parser.parse_args()
    if not args.command:
        cmd_list(args)
        return

    cmds = {
        "list": cmd_list,
        "add": cmd_add,
        "reorder": cmd_reorder,
        "remove": cmd_remove,
        "next": cmd_next,
        "upload": cmd_upload,
        "scan": cmd_scan,
    }
    cmds[args.command](args)


if __name__ == "__main__":
    main()
