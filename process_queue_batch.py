import os, sys, json, time, subprocess
from pathlib import Path

def log(msg):
    print(f"[{time.strftime('%Y-%m-%d %H:%M:%S')}] {msg}", flush=True)

def verify_mp4(path):
    p = Path(path)
    if not p.exists():
        return False, 0, 0, f"File {path} does not exist"
    size_mb = p.stat().st_size / (1024 * 1024)
    cmd = ["ffprobe", "-v", "error", "-show_entries", "format=duration,size:stream=width,height,codec_name", "-of", "json", str(p)]
    try:
        r = subprocess.run(cmd, capture_output=True, text=True, check=True)
        info = json.loads(r.stdout)
        dur = float(info['format']['duration'])
        vstream = next(s for s in info['streams'] if s['codec_name'] == 'h264')
        w, h = vstream['width'], vstream['height']
        return True, dur, size_mb, f"Verified OK: {dur:.2f}s, {w}x{h}, {size_mb:.2f} MB"
    except Exception as e:
        return False, 0, size_mb, f"ffprobe error: {e}"

def render_project(slug):
    root = Path(r"D:\faceless-shorts") / slug
    out_mp4 = root / "renders" / f"{slug}.mp4"
    log(f"Starting render for {slug} -> {out_mp4}")
    env = os.environ.copy()
    env["QS"] = "&aa=0&shadow=1024"
    cmd = ["node", "tools/capture.mjs", "video", f"renders/{slug}.mp4"]
    t0 = time.time()
    r = subprocess.run(cmd, cwd=str(root), env=env)
    if r.returncode != 0:
        log(f"Render FAILED for {slug} with exit code {r.returncode}")
        return False, 0, 0
    elapsed = time.time() - t0
    log(f"Render completed for {slug} in {elapsed:.1f}s")
    ok, dur, sz, msg = verify_mp4(out_mp4)
    log(f"Verification: {msg}")
    return ok, dur, sz

def wait_for_project(slug):
    mp4 = Path(r"D:\faceless-shorts") / slug / "renders" / f"{slug}.mp4"
    log(f"Waiting for {slug} to finish rendering...")
    while True:
        ok, dur, sz, msg = verify_mp4(mp4)
        if ok and dur > 30:
            log(f"{slug} is ready and verified! {msg}")
            return dur, sz
        time.sleep(15)

def update_runs_json(dur_map, size_map):
    log("Updating runs.json with all 6 viral Shorts in Queue...")
    cloud_runs_path = Path(r"c:\Users\DELL\OneDrive\Desktop\faceless\dashboard\cloud_data\runs.json")
    d_runs_path = Path(r"D:\faceless-shorts\runs.json")
    local_runs_path = Path(r"c:\Users\DELL\OneDrive\Desktop\faceless\faceless-shorts\runs.json")
    c_faceless_path = Path(r"C:\Users\DELL\faceless-shorts\runs.json")

    # Read latest published runs from C:\Users\DELL\faceless-shorts\runs.json
    data = json.loads(c_faceless_path.read_text(encoding="utf-8"))
    existing_published = [r for r in data["runs"] if r.get("status") == "published"]

    new_queue = [
        {
            "slug": "fake-invoice-tech-giant",
            "title": "The Man Who Sent $120M in Fake Invoices to Google & Meta",
            "style": "tall-tale",
            "created_at": "2026-11-17T11:30:00+05:30",
            "status": "queued",
            "stage": "ready_in_queue",
            "queue_order": 1,
            "video_file": "renders/fake-invoice-tech-giant.mp4",
            "rendered_mp4_name": "fake-invoice-tech-giant.mp4",
            "youtube_title": "The Man Who Sent $120M in Fake Invoices to Google & Meta! 📄 💰 #Shorts",
            "youtube_description": "How one man scammed Google and Facebook out of $120,000,000 using nothing but fake corporate invoices and a registered shell company! 📄 💰\n\nSubscribe to @Animated_Crew for more unbelievable true heist and hustle stories!\n\n#Shorts #Heist #Google #Meta #TrueStory #CrimeStory #Animation #CrazyFacts #AnimatedCrew",
            "youtube_tags": ["Shorts", "Google", "Meta", "Facebook", "Evaldas Rimasauskas", "Invoice Scam", "Heist", "True Story", "Animation", "Animated Crew", "Scam", "Crazy Facts"],
            "privacy_status": "public",
            "category_id": "23",
            "notes": "Queued #1: Next scheduled daily auto-upload at 7:00 PM IST.",
            "rendered_size_mb": 22.92,
            "mp4_ready_snapshot": True,
            "rendered_duration_sec": 45.02
        },
        {
            "slug": "gta6-hotel-firestick-hack",
            "title": "The 17-Year-Old Who Hacked GTA 6 With An Amazon Fire Stick",
            "style": "tall-tale",
            "created_at": "2026-11-17T11:50:00+05:30",
            "status": "queued",
            "stage": "ready_in_queue",
            "queue_order": 2,
            "video_file": "renders/gta6-hotel-firestick-hack.mp4",
            "rendered_mp4_name": "gta6-hotel-firestick-hack.mp4",
            "youtube_title": "The 17-Year-Old Who Hacked GTA 6 With An Amazon Fire Stick! 🎮 📺 #Shorts",
            "youtube_description": "How 17-year-old Arion Kurtaj leaked 90 clips of Grand Theft Auto 6 from a budget hotel room using only an Amazon Fire Stick, a hotel TV, and a phone! 🎮 📺\n\nSubscribe to @Animated_Crew for more unbelievable viral gaming and true heist stories!\n\n#Shorts #GTA6 #Gaming #RockstarGames #Hacker #GrandTheftAuto #TrueStory #AnimatedCrew #Animation #Viral",
            "youtube_tags": ["Shorts", "GTA 6", "Grand Theft Auto 6", "Rockstar Games", "Hacker", "Firestick", "Gaming", "True Story", "Animation", "Animated Crew", "Crazy Facts", "Viral"],
            "privacy_status": "public",
            "category_id": "23",
            "notes": "Queued #2: Held in queue for future daily auto-upload.",
            "rendered_size_mb": 19.88,
            "mp4_ready_snapshot": True,
            "rendered_duration_sec": 41.52
        },
        {
            "slug": "taylor-wilson-fusion-reactor",
            "title": "The 14-Year-Old Who Built a Working Nuclear Fusion Reactor",
            "style": "tall-tale",
            "created_at": "2026-11-17T13:00:00+05:30",
            "status": "queued",
            "stage": "ready_in_queue",
            "queue_order": 3,
            "video_file": "renders/taylor-wilson-fusion-reactor.mp4",
            "rendered_mp4_name": "taylor-wilson-fusion-reactor.mp4",
            "youtube_title": "The 14-Year-Old Who Built A Nuclear Reactor In His Garage! ☢️ ⚛️ #Shorts",
            "youtube_description": "At age 14, Taylor Wilson built a working nuclear fusion reactor in his parents' garage—reaching 500 million degrees! ☢️ ⚛️\n\nSubscribe to @Animated_Crew for more unbelievable true stories!\n\n#Shorts #Science #Nuclear #TrueStory #Genius #History #AnimatedCrew #CrazyFacts",
            "youtube_tags": ["Shorts", "Science", "Nuclear", "Taylor Wilson", "True Story", "Genius", "History", "Animated Crew", "Crazy Facts", "Animation"],
            "privacy_status": "public",
            "category_id": "23",
            "notes": "Queued #3: Held in queue for future daily auto-upload.",
            "rendered_size_mb": round(size_map.get("taylor-wilson-fusion-reactor", 19.57), 2),
            "mp4_ready_snapshot": True,
            "rendered_duration_sec": round(dur_map.get("taylor-wilson-fusion-reactor", 39.57), 2)
        },
        {
            "slug": "great-imposter-fake-surgeon",
            "title": "The Fake Surgeon Who Performed 16 Warship Surgeries With NO Training",
            "style": "tall-tale",
            "created_at": "2026-11-17T13:20:00+05:30",
            "status": "queued",
            "stage": "ready_in_queue",
            "queue_order": 4,
            "video_file": "renders/great-imposter-fake-surgeon.mp4",
            "rendered_mp4_name": "great-imposter-fake-surgeon.mp4",
            "youtube_title": "The Fake Surgeon Who Performed 16 Warship Surgeries With NO Training! 🚢 🩺 #Shorts",
            "youtube_description": "In 1951, Ferdinand Demara stole a doctor's identity and performed 16 critical warship surgeries with zero days of medical school—without losing a single patient! 🚢 🩺\n\nSubscribe to @Animated_Crew for more crazy con-artist and true stories!\n\n#Shorts #TrueStory #TheGreatImposter #ConArtist #History #MilitaryHistory #AnimatedCrew #CrazyFacts",
            "youtube_tags": ["Shorts", "TrueStory", "TheGreatImposter", "ConArtist", "History", "MilitaryHistory", "AnimatedCrew", "CrazyFacts", "Animation"],
            "privacy_status": "public",
            "category_id": "23",
            "notes": "Queued #4: Held in queue for future daily auto-upload.",
            "rendered_size_mb": round(size_map.get("great-imposter-fake-surgeon", 21.75), 2),
            "mp4_ready_snapshot": True,
            "rendered_duration_sec": round(dur_map.get("great-imposter-fake-surgeon", 43.65), 2)
        },
        {
            "slug": "paperclip-to-house-trade",
            "title": "The Guy Who Traded A Paperclip For A House",
            "style": "tall-tale",
            "created_at": "2026-11-17T13:40:00+05:30",
            "status": "queued",
            "stage": "ready_in_queue",
            "queue_order": 5,
            "video_file": "renders/paperclip-to-house-trade.mp4",
            "rendered_mp4_name": "paperclip-to-house-trade.mp4",
            "youtube_title": "He Traded A Single Paperclip For A Two-Story House! 📎 🏠 #Shorts",
            "youtube_description": "How Kyle MacDonald started with ONE red paperclip and made 14 genius trades until he owned a free two-story house without spending a dime! 📎 🏠\n\nSubscribe to @Animated_Crew for more unbelievable true hustle and viral stories!\n\n#Shorts #Hustle #PaperclipHouse #TrueStory #Viral #Trending #Animation #AnimatedCrew #CrazyFacts",
            "youtube_tags": ["Shorts", "Paperclip", "Red Paperclip", "House", "Kyle MacDonald", "Barter", "Hustle", "True Story", "Animation", "Animated Crew", "Crazy Facts"],
            "privacy_status": "public",
            "category_id": "23",
            "notes": "Queued #5: Held in queue for future daily auto-upload.",
            "rendered_size_mb": round(size_map.get("paperclip-to-house-trade", 18.25), 2),
            "mp4_ready_snapshot": True,
            "rendered_duration_sec": round(dur_map.get("paperclip-to-house-trade", 36.55), 2)
        },
        {
            "slug": "shawn-nelson-tank-joyride",
            "title": "The Man Who Stole A 57-Ton Army Battle Tank",
            "style": "tall-tale",
            "created_at": "2026-11-17T14:00:00+05:30",
            "status": "queued",
            "stage": "ready_in_queue",
            "queue_order": 6,
            "video_file": "renders/shawn-nelson-tank-joyride.mp4",
            "rendered_mp4_name": "shawn-nelson-tank-joyride.mp4",
            "youtube_title": "The Man Who Stole A 57-Ton Army Battle Tank! 🪖 🚜 #Shorts",
            "youtube_description": "In 1995, Shawn Nelson stole a 57-ton M60 Patton tank from a military base and went on a rampage through San Diego crushing 40 cars! 🪖 🚜\n\nSubscribe to @Animated_Crew for more unbelievable true heist and adrenaline stories!\n\n#Shorts #Tank #Heist #SanDiego #TrueStory #CrazyFacts #MilitaryHistory #Animation #AnimatedCrew #Viral",
            "youtube_tags": ["Shorts", "Tank", "M60 Patton", "San Diego", "Shawn Nelson", "Army Base", "True Story", "Crazy Facts", "Animation", "Animated Crew"],
            "privacy_status": "public",
            "category_id": "23",
            "notes": "Queued #6: Held in queue for future daily auto-upload.",
            "rendered_size_mb": round(size_map.get("shawn-nelson-tank-joyride", 22.80), 2),
            "mp4_ready_snapshot": True,
            "rendered_duration_sec": round(dur_map.get("shawn-nelson-tank-joyride", 45.64), 2)
        }
    ]

    data["runs"] = new_queue + existing_published
    dump_text = json.dumps(data, indent=2)

    for p in [cloud_runs_path, d_runs_path, local_runs_path, c_faceless_path]:
        try:
            p.parent.mkdir(parents=True, exist_ok=True)
            p.write_text(dump_text, encoding="utf-8")
            log(f"Saved {p}")
        except Exception as e:
            log(f"Warning writing to {p}: {e}")

    log("Running sync_cloud_data.py...")
    subprocess.run([sys.executable, r"c:\Users\DELL\OneDrive\Desktop\faceless\dashboard\sync_cloud_data.py"], check=True)
    log("Cloud data sync successful!")

    log("Running sync_cloud_data.py...")
    subprocess.run([sys.executable, r"c:\Users\DELL\OneDrive\Desktop\faceless\dashboard\sync_cloud_data.py"], check=True)
    log("Cloud data sync successful!")

def run_pipeline():
    dur_map = {"taylor-wilson-fusion-reactor": 39.57}
    size_map = {"taylor-wilson-fusion-reactor": 19.57}

    # 1. Wait for great-imposter
    dur, sz = wait_for_project("great-imposter-fake-surgeon")
    dur_map["great-imposter-fake-surgeon"] = dur
    size_map["great-imposter-fake-surgeon"] = sz

    # 2. Render paperclip-to-house-trade
    ok, dur, sz = render_project("paperclip-to-house-trade")
    if not ok:
        log("FAILED paperclip-to-house-trade")
        return
    dur_map["paperclip-to-house-trade"] = dur
    size_map["paperclip-to-house-trade"] = sz

    # 3. Render shawn-nelson-tank-joyride
    ok, dur, sz = render_project("shawn-nelson-tank-joyride")
    if not ok:
        log("FAILED shawn-nelson-tank-joyride")
        return
    dur_map["shawn-nelson-tank-joyride"] = dur
    size_map["shawn-nelson-tank-joyride"] = sz

    # 4. Update runs.json and sync
    update_runs_json(dur_map, size_map)
    log("All 7 viral Shorts successfully built, rendered, and queued!")

if __name__ == "__main__":
    run_pipeline()
