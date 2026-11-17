"""Word-by-word captions (ASS subtitles) matched to each style. render.py calls this automatically when
captions are on; run it yourself only to inspect the file:  python captions.py WORK

The caption text comes from transcript_edited.json. To fix a misheard word, or to show Hindi in Roman letters,
edit the "w" values there (or add a "cap" value to a word, which is shown instead of "w").
Captions are hidden while graphics are on screen (inside EDIT.SPANS).
"""
import json
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import die, load_state  # noqa: E402

# per style: font file stem (assets/fonts/ttf), size at 1080p, text colour, highlight colour, outline colour, outline px, shadow px, uppercase
STYLE = {
    "creator-motion-graphics": ("inter-800", 74, "#f4f1ea", "#ffd60a", "#000000", 0, 3, True),
    "warm-canvas": ("fraunces-600", 80, "#ffffff", "#4f9cf0", "#000000", 0, 3, False),
    "clean-tech": ("inter-tight-800", 74, "#ffffff", "#7d9bff", "#0d0f14", 0, 3, False),
    "software-walkthrough": ("dm-sans-700", 72, "#ffffff", "#9b9bff", "#14161c", 0, 3, False),
    "data-story": ("archivo-800", 74, "#eef1f5", "#ff6b5b", "#0f141c", 0, 3, False),
    "chalk-talk": ("kalam-700", 82, "#f2efe6", "#f4d35e", "#24392f", 3, 2, False),
    "pop-info": ("fredoka-700", 78, "#ffffff", "#ffd86b", "#2f3e46", 4, 0, False),
}
DEVA = re.compile(r"[ऀ-ॿ]")


def ass_color(hexcol, alpha=0):
    h = hexcol.lstrip("#")
    r, g, b = h[0:2], h[2:4], h[4:6]
    return f"&H{alpha:02X}{b}{g}{r}".upper()


def ts(t):
    t = max(0.0, t)
    h, m = int(t // 3600), int(t % 3600 // 60)
    s = t % 60
    return f"{h}:{m:02d}:{s:05.2f}"


def chunks(words, max_words=5, max_chars=30, gap=0.45):
    out, cur = [], []
    for w in words:
        txt = w.get("cap", w["w"])
        if cur:
            n = sum(len(x.get("cap", x["w"])) + 1 for x in cur) + len(txt)
            if w["s"] - cur[-1]["e"] > gap or len(cur) >= max_words or n > max_chars or cur[-1].get("cap", cur[-1]["w"])[-1:] in ".?!।,":
                out.append(cur)
                cur = []
        cur.append(w)
    if cur:
        out.append(cur)
    return out


def build(work, spans, style_id, W, H, out="captions.ass"):
    tr = os.path.join(work, "transcript_edited.json")
    if not os.path.exists(tr):
        die("transcript_edited.json not found (run cut.py first)")
    words = json.load(open(tr, encoding="utf-8"))["words"]
    inspan = lambda t: any(a - 0.05 <= t < b + 0.05 for a, b in spans)  # noqa: E731
    words = [w for w in words if not inspan((w["s"] + w["e"]) / 2)]
    font, size, col, hi, outl, bord, shad, upper = STYLE.get(style_id, STYLE["clean-tech"])
    k = H / 1080
    deva_font = "kalam-700" if font == "kalam-700" else "noto-sans-devanagari-700"
    head = f"""[Script Info]
ScriptType: v4.00+
PlayResX: {W}
PlayResY: {H}
WrapStyle: 2
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Cap,CVE {font},{int(size * k)},{ass_color(col)},{ass_color(hi)},{ass_color(outl)},{ass_color('#000000', 0x70)},0,0,0,0,100,100,0,0,1,{bord * k:.1f},{shad * k:.1f},2,{int(120 * k)},{int(120 * k)},{int(90 * k)},1
Style: CapDeva,CVE {deva_font},{int(size * 0.92 * k)},{ass_color(col)},{ass_color(hi)},{ass_color(outl)},{ass_color('#000000', 0x70)},0,0,0,0,100,100,0,0,1,{bord * k:.1f},{shad * k:.1f},2,{int(120 * k)},{int(120 * k)},{int(90 * k)},1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
"""
    ev = []
    groups = chunks(words)
    for gi, g in enumerate(groups):
        texts = [w.get("cap", w["w"]) for w in g]
        if upper:
            texts = [t.upper() for t in texts]
        sty = "CapDeva" if any(DEVA.search(t) for t in texts) else "Cap"
        end_all = g[-1]["e"] + 0.25
        if gi + 1 < len(groups):
            end_all = min(end_all, groups[gi + 1][0]["s"])
        for i, w in enumerate(g):
            s = w["s"] if i else g[0]["s"]
            e = g[i + 1]["s"] if i + 1 < len(g) else end_all
            if e <= s:
                continue
            parts = []
            for j, t in enumerate(texts):
                t = t.replace("{", "(").replace("}", ")")
                parts.append("{\\c" + ass_color(hi) + "}" + t + "{\\c" + ass_color(col) + "}" if j == i else t)
            pop = "{\\fad(60,0)}" if i == 0 else ""
            ev.append(f"Dialogue: 0,{ts(s)},{ts(e)},{sty},,0,0,0,,{pop}" + " ".join(parts))
    path = os.path.join(work, out)
    open(path, "w", encoding="utf-8").write(head + "\n".join(ev) + "\n")
    return path


if __name__ == "__main__":
    work = os.path.abspath(sys.argv[1])
    st = load_state(work)
    H = st.get("height", 1080)
    print(build(work, [], st.get("style", "clean-tech"), int(round(H * 16 / 9 / 2) * 2), H))
