"""Check and install everything the video editor needs. Free, one time.

  python setup.py           # check, then install the Python packages and the headless browser
  python setup.py --check   # only report what is missing

Needs Python 3.9+ and ffmpeg. The Python packages are faster-whisper (local transcription), playwright
(headless Chromium for rendering the graphics), numpy and pillow.
"""
import importlib
import importlib.util
import json
import platform
import shutil
import subprocess
import sys

PKGS = {"faster_whisper": "faster-whisper", "playwright": "playwright", "numpy": "numpy", "PIL": "pillow"}


def ffmpeg_hint():
    sysname = platform.system()
    if sysname == "Windows":
        return "winget install Gyan.FFmpeg   (then open a new terminal)"
    if sysname == "Darwin":
        return "brew install ffmpeg"
    return "sudo apt install ffmpeg   (or your distro's package manager)"


def chromium_ok():
    try:
        from playwright.sync_api import sync_playwright
        with sync_playwright() as p:
            b = p.chromium.launch()
            b.close()
        return True
    except Exception:
        return False


def main():
    check_only = "--check" in sys.argv
    report = {"python": platform.python_version(), "os": platform.system(), "ok": True, "missing": [], "actions": []}
    if sys.version_info < (3, 9):
        report["ok"] = False
        report["missing"].append("Python 3.9 or newer")
    for tool in ("ffmpeg", "ffprobe"):
        if not shutil.which(tool):
            report["ok"] = False
            report["missing"].append(tool)
            report["actions"].append("install ffmpeg: " + ffmpeg_hint())
            break
    missing_pkgs = []
    for mod, pkg in PKGS.items():
        try:
            importlib.import_module(mod)
        except Exception:
            missing_pkgs.append(pkg)
    if missing_pkgs and not check_only:
        cmd = [sys.executable, "-m", "pip", "install", "--upgrade"] + missing_pkgs
        print("installing:", " ".join(missing_pkgs), flush=True)
        r = subprocess.run(cmd)
        if r.returncode != 0:  # PEP 668 systems (some Linux, Homebrew Python)
            r = subprocess.run(cmd + ["--break-system-packages"])
        if r.returncode == 0:
            importlib.invalidate_caches()
            missing_pkgs = [p for m, p in PKGS.items() if importlib.util.find_spec(m) is None]
    if missing_pkgs:
        report["ok"] = False
        report["missing"] += missing_pkgs
        report["actions"].append(f"{sys.executable} -m pip install " + " ".join(missing_pkgs))
    if "playwright" not in missing_pkgs:
        if not chromium_ok():
            if not check_only:
                print("downloading the headless browser (about 150 MB, one time)...", flush=True)
                subprocess.run([sys.executable, "-m", "playwright", "install", "chromium"])
            if not chromium_ok():
                report["ok"] = False
                report["missing"].append("playwright chromium")
                report["actions"].append(f"{sys.executable} -m playwright install chromium")
    try:
        import ctranslate2
        report["nvidia_gpu"] = ctranslate2.get_cuda_device_count() > 0
    except Exception:
        report["nvidia_gpu"] = False
    print(json.dumps(report, indent=1))
    sys.exit(0 if report["ok"] else 1)


if __name__ == "__main__":
    main()
