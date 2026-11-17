"""Open the edit in a browser (footage, graphics and effects playing together) before the final render.

  python preview.py WORK            # serves the project on localhost and opens the browser; Ctrl+C to stop
  python preview.py WORK --no-open  # just print the link

Run it in the background from an agent, then share the printed link with the user.
"""
import os
import sys
import time
import webbrowser

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import build_page, die, load_state, serve  # noqa: E402


def main():
    if len(sys.argv) < 2:
        die(__doc__)
    work = os.path.abspath(sys.argv[1])
    st = load_state(work)
    if not st.get("style"):
        die("no style set yet (cut.py --style ID)")
    for f in ("cut.mp4", "story.js"):
        if not os.path.exists(os.path.join(work, f)):
            die(f"{f} not found in {work}")
    build_page(work, st["style"])
    srv, base = serve(work, int(os.environ.get("PREVIEW_PORT", "8765")))
    url = base + "/work/page.html"
    print("preview: " + url, flush=True)
    if "--no-open" not in sys.argv:
        webbrowser.open(url)
    try:
        while True:
            time.sleep(1)
    except KeyboardInterrupt:
        srv.shutdown()


if __name__ == "__main__":
    main()
