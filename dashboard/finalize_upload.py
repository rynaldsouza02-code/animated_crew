"""Safely finalize runs.json after upload_job.json confirms a published YouTube ID.

Eliminates shell quoting / PowerShell variable expansion issues (e.g. $18.7M -> .7M)
by reading strictly from UTF-8 JSON on disk and performing an atomic write.
Supports multi-directory root projects (C: and D: drives).
"""
import json
import subprocess
import sys
import uuid
from datetime import datetime
from pathlib import Path

ROOTS = [p for p in (Path(r"D:\faceless-shorts"), Path(r"C:\Users\DELL\faceless-shorts")) if p.exists()]
SYNC_SCRIPT = Path(r"c:\Users\DELL\OneDrive\Desktop\faceless\dashboard\sync_cloud_data.py")


def _atomic_write_json(path: Path, data: object) -> None:
    tmp = path.with_suffix(path.suffix + f".{uuid.uuid4().hex[:6]}.tmp")
    tmp.write_text(json.dumps(data, indent=2, ensure_ascii=False), encoding="utf-8")
    tmp.replace(path)


def finalize(youtube_id: str | None = None) -> int:
    job = None
    for r in ROOTS:
        jp = r / "upload_job.json"
        if jp.exists():
            try:
                job = json.loads(jp.read_text(encoding="utf-8", errors="replace"))
                if job:
                    break
            except Exception:
                pass

    if not job:
        print("upload_job.json not found", file=sys.stderr)
        return 1

    yid = (youtube_id or job.get("youtube_id") or "").strip()
    if not yid:
        print("Missing youtube_id in upload_job.json", file=sys.stderr)
        return 1

    now_iso = job.get("completed_at") or datetime.now().astimezone().isoformat(timespec="seconds")
    yurl = f"https://www.youtube.com/watch?v={yid}"
    job["status"] = "published"
    job["step"] = "Published live to YouTube!"
    job["youtube_id"] = yid
    job["youtube_url"] = yurl
    job["error"] = None
    job["completed_at"] = now_iso
    job["updated_at"] = datetime.now().astimezone().isoformat(timespec="seconds")

    for r in ROOTS:
        _atomic_write_json(r / "upload_job.json", job)

    slug = (job.get("slug") or "").strip()
    if slug:
        for r in ROOTS:
            rp = r / "runs.json"
            if not rp.exists():
                continue
            runs_data = json.loads(rp.read_text(encoding="utf-8", errors="replace"))
            updated = False
            for run_entry in runs_data.get("runs", []):
                if run_entry.get("slug") == slug:
                    run_entry["status"] = "published"
                    run_entry["stage"] = "completed"
                    run_entry["queue_order"] = None
                    run_entry["youtube_id"] = yid
                    run_entry["youtube_url"] = yurl
                    if job.get("title"):
                        run_entry["youtube_title"] = job["title"]
                    if job.get("description"):
                        run_entry["youtube_description"] = job["description"]
                    if job.get("tags"):
                        run_entry["youtube_tags"] = job["tags"]
                    run_entry["privacy_status"] = job.get("privacy_status") or run_entry.get("privacy_status") or "public"
                    run_entry["category_id"] = job.get("category_id") or run_entry.get("category_id") or "23"
                    run_entry["published_at"] = now_iso
                    run_entry["notes"] = f"Published live on Animated_Crew channel as {yid}."
                    updated = True
                    break

            queued = [re for re in runs_data.get("runs", []) if re.get("status") == "queued"]
            queued.sort(
                key=lambda item: (
                    int(item["queue_order"]) if isinstance(item.get("queue_order"), (int, float)) else 999999,
                    str(item.get("created_at") or ""),
                    str(item.get("slug") or ""),
                )
            )
            for idx, re in enumerate(queued, start=1):
                re["queue_order"] = idx
                re["notes"] = (
                    "Queued #1: Next scheduled automatic upload at 6:30 PM IST (only 1 queued video uploads per day)."
                    if idx == 1
                    else f"Queued #{idx}: Held in queue for future daily auto-upload."
                )
            for re in runs_data.get("runs", []):
                if re.get("status") != "queued":
                    re["queue_order"] = None

            _atomic_write_json(rp, runs_data)
            print(f"Finalized {rp} ({slug} -> {yid}, updated={updated}, remaining_queue={len(queued)})")

        lf_queue_path = Path(r"D:\faceless-longform\queue\queue.json")
        if lf_queue_path.exists():
            try:
                lf_data = json.loads(lf_queue_path.read_text(encoding="utf-8", errors="replace"))
                lf_updated = False
                for item in lf_data.get("queue", []):
                    if item.get("slug") == slug:
                        item["status"] = "published"
                        item["youtube_id"] = yid
                        item["youtube_url"] = yurl
                        item["published_at"] = now_iso
                        if job.get("title"):
                            item["youtube_title"] = job["title"]
                        if job.get("description"):
                            item["youtube_description"] = job["description"]
                        if job.get("tags"):
                            item["youtube_tags"] = job["tags"]
                        item["privacy_status"] = job.get("privacy_status") or item.get("privacy_status") or "public"
                        item["category_id"] = job.get("category_id") or item.get("category_id") or "27"
                        lf_updated = True
                        break
                if lf_updated:
                    _atomic_write_json(lf_queue_path, lf_data)
                    print(f"Finalized longform queue {lf_queue_path} ({slug} -> {yid})")
            except Exception as e:
                print(f"Failed to update longform queue: {e}", file=sys.stderr)
    else:
        print(f"Finalized custom upload {yid}")

    if SYNC_SCRIPT.exists():
        try:
            subprocess.run([sys.executable, str(SYNC_SCRIPT)], capture_output=True, timeout=30)
        except Exception:
            pass

    return 0


if __name__ == "__main__":
    arg_id = sys.argv[1] if len(sys.argv) > 1 else None
    sys.exit(finalize(arg_id))
