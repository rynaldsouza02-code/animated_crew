"""Narration for $0 on this computer: Kokoro-82M text-to-speech (Apache-2.0) via kokoro-onnx. No account, no API.

  scripts/py scripts/voice.py <project>          script.json -> data/narration.wav + data/lines.json (exact line times)
  scripts/py scripts/voice.py --list             voices that narrate well
  scripts/py scripts/voice.py --download         only fetch the model files (~340 MB, once)

Retention Rules Enforced:
1. Speech speed: Default 1.1x (speed=1.1) for brisk, engaging retention.
2. Zero dead air: All silences longer than 0.15s are trimmed/compressed to <= 0.08s.
3. Seamless loop: Lead silence <= 0.05s, outro silence <= 0.06s so the short loops cleanly into line 1.
"""
import argparse, json, os, re, sys, urllib.request
from pathlib import Path
import numpy as np
from scipy.io import wavfile

HOME = Path(os.environ.get('FACELESS_HOME', Path.home() / '.faceless-shorts'))
KDIR = HOME / 'kokoro'
FILES = {
    'kokoro-v1.0.onnx': 'https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/kokoro-v1.0.onnx',
    'voices-v1.0.bin': 'https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/voices-v1.0.bin',
}
GOOD = {
    'am_michael': 'US male, steady explainer (default)', 'am_puck': 'US male, lively, playful', 'am_fenrir': 'US male, deeper',
    'am_onyx': 'US male, low', 'af_heart': 'US female, warm (best overall)', 'af_bella': 'US female, bright',
    'af_nicole': 'US female, soft and close', 'bm_george': 'UK male, documentary', 'bm_fable': 'UK male, storyteller',
    'bf_emma': 'UK female, calm',
}
SR = 24000


def ensure_models():
    KDIR.mkdir(parents=True, exist_ok=True)
    for name, url in FILES.items():
        p = KDIR / name
        if p.exists() and p.stat().st_size > 1_000_000: continue
        print(f'downloading {name} (once)...', flush=True)
        tmp = p.with_suffix('.part'); urllib.request.urlretrieve(url, tmp); tmp.rename(p)


def trim(x, thr=0.008):
    """Cut leading/trailing silence so line start/end times are exact and crisp"""
    idx = np.where(np.abs(x) > thr)[0]
    if not len(idx): return x
    a = max(0, idx[0] - int(0.005 * SR))
    b = min(len(x), idx[-1] + int(0.015 * SR))
    return x[a:b]


def silences(x, thr=0.012, min_len=0.05):
    """Pauses inside speech: [(start_s, end_s)] where the 5 ms RMS stays under thr for >= min_len"""
    hop = int(0.005 * SR); n = len(x) // hop
    if n == 0: return []
    rms = np.sqrt(np.mean(x[:n * hop].reshape(n, hop) ** 2, axis=1))
    quiet = rms < thr * (np.abs(x).max() + 1e-9)
    out, st = [], None
    for f, q in enumerate(quiet):
        if q and st is None: st = f
        if (not q or f == n - 1) and st is not None:
            if (f - st) * 0.005 >= min_len: out.append((st * 0.005, f * 0.005))
            st = None
    return out


def compress_all_silences(x, max_pause=0.15, target_pause=0.08, thr=0.012):
    """Compress any quiet period in x longer than max_pause down to target_pause with smooth crossfade."""
    hop = int(0.005 * SR)
    if len(x) < hop * 4: return x
    n = len(x) // hop
    rms = np.sqrt(np.mean(x[:n * hop].reshape(n, hop) ** 2, axis=1))
    quiet = rms < thr * (np.abs(x).max() + 1e-9)
    
    silent_regions = []
    st = None
    for f, q in enumerate(quiet):
        if q and st is None: st = f
        if (not q or f == n - 1) and st is not None:
            dur = (f - st) * 0.005
            if dur > max_pause:
                silent_regions.append((st * hop, f * hop))
            st = None
            
    if not silent_regions:
        return x
        
    chunks = []
    curr_orig = 0
    target_samples = int(target_pause * SR)
    fade_len = int(0.004 * SR)
    
    for s_start, s_end in silent_regions:
        if s_start > curr_orig:
            chunks.append(x[curr_orig:s_start])
        orig_len = s_end - s_start
        if orig_len > target_samples:
            mid = (s_start + s_end) // 2
            half = target_samples // 2
            kept = x[mid - half : mid - half + target_samples].copy()
            if len(kept) >= 2 * fade_len:
                fade_in = 0.5 * (1 - np.cos(np.pi * np.linspace(0, 1, fade_len)))
                fade_out = 0.5 * (1 + np.cos(np.pi * np.linspace(0, 1, fade_len)))
                kept[:fade_len] *= fade_in
                kept[-fade_len:] *= fade_out
            chunks.append(kept)
        else:
            chunks.append(x[s_start:s_end])
        curr_orig = s_end
        
    if curr_orig < len(x):
        chunks.append(x[curr_orig:])
        
    return np.concatenate(chunks)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('project', nargs='?'); ap.add_argument('--list', action='store_true'); ap.add_argument('--download', action='store_true')
    ap.add_argument('--voice'); ap.add_argument('--speed', type=float)
    a = ap.parse_args()
    if a.list:
        for k, v in GOOD.items(): print(f'{k:12s} {v}')
        return
    ensure_models()
    if a.download: return
    if not a.project: ap.error('project folder missing')
    from kokoro_onnx import Kokoro
    P = Path(a.project); S = json.loads((P / 'script.json').read_text())
    
    # Retention Rule: Default 1.1x speed for fast-paced short-form retention
    voice = a.voice or S.get('voice', 'am_michael')
    speed = a.speed or float(S.get('speed', 1.1))
    
    k = Kokoro(str(KDIR / 'kokoro-v1.0.onnx'), str(KDIR / 'voices-v1.0.bin'))
    lang = 'en-gb' if voice.startswith('b') else 'en-us'
    say = lambda text: trim(np.asarray(k.create(text, voice=voice, speed=speed, lang=lang)[0], dtype=np.float64))
    
    # Group the lines into whole sentences (a line ending in . ? ! closes one; "break": true forces a close)
    groups, cur = [], []
    for i, ln in enumerate(S['lines']):
        cur.append(i)
        if re.search(r'[.?!]["\')]*$', ln['text'].strip()) or ln.get('break') or i == len(S['lines']) - 1:
            groups.append(cur)
            cur = []
            
    # Retention Rule: Lead silence <= 0.05s (zero dead air at start)
    lead_s = min(0.06, float(S.get('lead', 0.05)))
    out = [np.zeros(int(lead_s * SR))]
    t = len(out[0]) / SR
    lines = [None] * len(S['lines'])
    
    for g in groups:
        raw_x = say(' '.join(S['lines'][i]['text'] for i in g))
        # Retention Rule: Compress any internal silences > 0.15s down to <= 0.08s
        x = compress_all_silences(raw_x, max_pause=0.15, target_pause=0.08)
        
        cuts = [0.0]
        if len(g) > 1:                                    # find each cut inside the sentence
            lens = np.array([len(say(S['lines'][i]['text'])) for i in g], dtype=float)
            pauses = silences(x)
            for c in np.cumsum(lens)[:-1] / lens.sum() * len(x) / SR:
                near = [p for p in pauses if abs((p[0] + p[1]) / 2 - c) < 0.4]
                if near:
                    p = min(near, key=lambda p: abs((p[0] + p[1]) / 2 - c))
                    cuts.append((p[0], p[1]))
                else:
                    cuts.append((c, c))
                    
        n = len(x) / SR
        for j, i in enumerate(g):
            a_cut = 0.0 if j == 0 else cuts[j][1]
            b_cut = n if j == len(g) - 1 else cuts[j + 1][0]
            lines[i] = {'i': i, 'text': S['lines'][i]['text'], 'start': round(t + a_cut, 3), 'end': round(t + b_cut, 3)}
            print(f'{i:2d} {lines[i]["start"]:6.2f}-{lines[i]["end"]:6.2f}  {S["lines"][i]["text"]}', flush=True)
            
        # Retention Rule: Inter-sentence gap <= 0.10s (zero dead air between sentences)
        gap_s = min(0.10, float(S['lines'][g[-1]].get('gap', S.get('gap', 0.08))))
        gap = np.zeros(int(gap_s * SR))
        out += [x, gap]
        t += (len(x) + len(gap)) / SR
        
    # Retention Rule: Outro <= 0.06s for seamless looping into line 1
    outro_s = min(0.06, float(S.get('outro', 0.05)))
    outro = np.zeros(int(outro_s * SR))
    out.append(outro)
    
    y = np.concatenate(out)
    # Final pass: Guarantee zero silences > 0.15s anywhere across entire master audio
    y = compress_all_silences(y, max_pause=0.15, target_pause=0.08)
    y = y / (np.abs(y).max() + 1e-9) * 0.9
    
    (P / 'data').mkdir(exist_ok=True)
    wavfile.write(P / 'data/narration.wav', SR, (y * 32767).astype(np.int16))
    dur = len(y) / SR
    (P / 'data/lines.json').write_text(json.dumps({'duration': round(dur, 3), 'voice': voice, 'speed': speed, 'lines': lines}, indent=1))
    print(f'data/narration.wav ({dur:.2f} s, {voice} x{speed}) + data/lines.json. Next: words.py')


if __name__ == '__main__':
    main()
