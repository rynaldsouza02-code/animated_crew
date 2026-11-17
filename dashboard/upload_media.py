"""Stage a local video MP4 to a direct HTTPS binary host for Zapier YouTube upload.

Uses curl.exe with forced IPv4 (-4), HTTP/1.1 streaming, progress reporting,
and stalled-transfer detection (--speed-time / --speed-limit), then verifies
the staged URL serves actual non-HTML video/binary bytes before returning it.
"""
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import uuid
from pathlib import Path
from typing import Optional

BROWSER_UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"
)


def _find_curl() -> str:
    return shutil.which("curl.exe") or shutil.which("curl") or "curl.exe"


def _emit_err(msg: str) -> None:
    print(msg, file=sys.stderr, flush=True)


def _safe_curl_upload_path(filepath: str) -> tuple[str, Optional[str]]:
    """Return a path safe for curl -F '@...' (no commas, semicolons, quotes, or non-ASCII)."""
    p = Path(filepath)
    s = str(p)
    if any(ch in s for ch in (",", ";", '"')) or not s.isascii():
        suffix = p.suffix if p.suffix and p.suffix.isascii() else ".mp4"
        tmp_name = f"crewtube_stage_{uuid.uuid4().hex[:8]}{suffix}"
        tmp_path = str(Path(tempfile.gettempdir()) / tmp_name)
        try:
            os.link(s, tmp_path)
        except Exception:
            shutil.copy2(s, tmp_path)
        return tmp_path, tmp_path
    return s, None


def _run_curl_upload(args: list[str], timeout_sec: int = 360) -> tuple[int, str, str]:
    curl = _find_curl()
    cmd = [
        curl,
        "--http1.1",
        "--progress-bar",
        "--connect-timeout",
        "25",
        "--speed-time",
        "40",
        "--speed-limit",
        "8192",
        "--max-time",
        str(timeout_sec),
        "-A",
        BROWSER_UA,
        *args,
    ]
    proc = subprocess.Popen(
        cmd,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
    )

    err_tail: list[str] = []
    last_pct = -1

    import threading

    out_chunks: list[bytes] = []

    def _read_out():
        if proc.stdout:
            out_chunks.append(proc.stdout.read())

    def _read_err():
        nonlocal last_pct
        if not proc.stderr:
            return
        buf = bytearray()
        while True:
            b = proc.stderr.read(1)
            if not b:
                break
            if b in (b"\r", b"\n"):
                if buf:
                    line = buf.decode("utf-8", errors="replace").strip()
                    buf.clear()
                    m = re.search(r"(\d+(?:\.\d+)?)%", line)
                    if m:
                        pct = int(float(m.group(1)))
                        if pct != last_pct:
                            last_pct = pct
                            _emit_err(f"PROGRESS:{pct}")
                    elif line and not set(line) <= set("#=-O "):
                        err_tail.append(line)
            else:
                buf.extend(b)
        if buf:
            line = buf.decode("utf-8", errors="replace").strip()
            if line and not set(line) <= set("#=-O "):
                err_tail.append(line)

    t_out = threading.Thread(target=_read_out, daemon=True)
    t_err = threading.Thread(target=_read_err, daemon=True)
    t_out.start()
    t_err.start()

    try:
        rc = proc.wait(timeout=timeout_sec + 20)
    except subprocess.TimeoutExpired:
        proc.kill()
        t_out.join(timeout=2)
        t_err.join(timeout=2)
        return 124, "", f"curl timed out after {timeout_sec}s"

    t_out.join(timeout=5)
    t_err.join(timeout=5)
    out_text = b"".join(out_chunks).decode("utf-8", errors="replace").strip()
    err_text = " | ".join(err_tail[-4:]).strip()
    return rc, out_text, err_text


def _verify_direct_url(url: str) -> bool:
    """Confirm staged URL responds 200/206 AND serves binary video (never an HTML page)."""
    if not url or not url.startswith("http"):
        return False
    curl = _find_curl()
    try:
        res = subprocess.run(
            [
                curl,
                "-sSL",
                "-r",
                "0-31",
                "--max-time",
                "25",
                "-A",
                BROWSER_UA,
                "-o",
                os.devnull,
                "-w",
                "%{http_code} %{content_type}",
                url,
            ],
            capture_output=True,
            text=True,
            timeout=30,
            creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
        )
        parts = (res.stdout or "").strip().split(None, 1)
        code = int(parts[0]) if parts and parts[0].isdigit() else 0
        ctype = (parts[1] if len(parts) > 1 else "").lower()
        if code in (200, 206) and "text/html" not in ctype:
            return True

        # Fallback HEAD check in case host disables Range GET
        head = subprocess.run(
            [
                curl,
                "-sSIL",
                "--max-time",
                "20",
                "-A",
                BROWSER_UA,
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
        hparts = (head.stdout or "").strip().split(None, 1)
        hcode = int(hparts[0]) if hparts and hparts[0].isdigit() else 0
        hctype = (hparts[1] if len(hparts) > 1 else "").lower()
        return hcode in (200, 206) and "text/html" not in hctype
    except Exception:
        return False


def upload_to_uguu(filepath: str, size_mb: float) -> Optional[str]:
    if size_mb > 120.0:
        _emit_err(f"Skipping uguu.se ({size_mb:.1f} MB > 120 MB host limit)")
        return None
    _emit_err("HOST:uguu.se")
    try:
        rc, out, err = _run_curl_upload(
            ["-F", f"files[]=@{filepath}", "https://uguu.se/upload"],
            timeout_sec=360,
        )
        if rc != 0:
            _emit_err(f"uguu.se failed (exit {rc}): {err or out[:200]}")
            return None
        data = json.loads(out)
        if data.get("success") and data.get("files"):
            url = str(data["files"][0].get("url") or "").replace("\\/", "/").strip()
            if _verify_direct_url(url):
                return url
            _emit_err(f"uguu.se URL failed binary check: {url}")
    except Exception as exc:
        _emit_err(f"uguu.se error: {exc}")
    return None


def upload_to_catbox(filepath: str, size_mb: float) -> Optional[str]:
    if size_mb > 195.0:
        _emit_err(f"Skipping catbox.moe ({size_mb:.1f} MB > 195 MB host limit)")
        return None
    _emit_err("HOST:catbox.moe")
    try:
        rc, out, err = _run_curl_upload(
            [
                "-F",
                "reqtype=fileupload",
                "-F",
                f"fileToUpload=@{filepath}",
                "https://catbox.moe/user/api.php",
            ],
            timeout_sec=360,
        )
        if rc == 0 and out.startswith("http") and _verify_direct_url(out):
            return out
        _emit_err(f"catbox.moe failed (exit {rc}): {err or out[:200]}")
    except Exception as exc:
        _emit_err(f"catbox.moe error: {exc}")
    return None


def upload_to_x0at(filepath: str, size_mb: float) -> Optional[str]:
    if size_mb > 480.0:
        _emit_err(f"Skipping x0.at ({size_mb:.1f} MB > 480 MB host limit)")
        return None
    _emit_err("HOST:x0.at")
    try:
        rc, out, err = _run_curl_upload(
            ["-F", f"file=@{filepath}", "https://x0.at/"],
            timeout_sec=420,
        )
        clean_out = out.splitlines()[-1].strip() if out else ""
        if rc == 0 and clean_out.startswith("http") and _verify_direct_url(clean_out):
            return clean_out
        _emit_err(f"x0.at failed (exit {rc}): {err or out[:200]}")
    except Exception as exc:
        _emit_err(f"x0.at error: {exc}")
    return None


def upload_to_litterbox(filepath: str, size_mb: float) -> Optional[str]:
    if size_mb > 1000.0:
        _emit_err(f"Skipping litterbox ({size_mb:.1f} MB > 1000 MB host limit)")
        return None
    _emit_err("HOST:litterbox.catbox.moe")
    try:
        rc, out, err = _run_curl_upload(
            [
                "-F", "reqtype=fileupload",
                "-F", "time=24h",
                "-F", f"fileToUpload=@{filepath}",
                "https://litterbox.catbox.moe/resources/internals/api.php",
            ],
            timeout_sec=600,
        )
        clean_out = out.splitlines()[-1].strip() if out else ""
        if rc == 0 and clean_out.startswith("http") and _verify_direct_url(clean_out):
            return clean_out
        _emit_err(f"litterbox failed (exit {rc}): {err or out[:200]}")
    except Exception as exc:
        _emit_err(f"litterbox error: {exc}")
    return None


if __name__ == "__main__":
    if len(sys.argv) < 2:
        _emit_err("Usage: python upload_media.py <filepath>")
        sys.exit(1)

    target_path = Path(sys.argv[1]).resolve()
    if not target_path.is_file():
        _emit_err(f"File not found: {target_path}")
        sys.exit(1)

    size_mb = target_path.stat().st_size / (1024 * 1024)
    if size_mb <= 0:
        _emit_err("Video file is empty (0 bytes)")
        sys.exit(1)
    if size_mb > 1000.0:
        _emit_err(f"Video is {size_mb:.1f} MB, exceeding 1000 MB temporary host limit. Compress below 500 MB first.")
        sys.exit(1)

    safe_path, temp_copy = _safe_curl_upload_path(str(target_path))
    try:
        for fn in (upload_to_uguu, upload_to_catbox, upload_to_x0at, upload_to_litterbox):
            staged = fn(safe_path, size_mb)
            if staged:
                print(staged, flush=True)
                sys.exit(0)
    finally:
        if temp_copy and Path(temp_copy).exists():
            try:
                Path(temp_copy).unlink()
            except Exception:
                pass

    _emit_err("All direct MP4 staging hosts (uguu.se, catbox.moe, x0.at, litterbox) failed.")
    sys.exit(2)
