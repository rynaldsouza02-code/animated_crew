# Animated_Crew — CrewTube Manager & Faceless Shorts Engine

Automated YouTube Shorts studio & analytics hub built for **Animated_Crew**, pairing the local procedural 3D/2D `faceless-shorts` video generator with **CrewTube Studio Manager** (FastAPI + interactive SaaS web dashboard, deployable to Vercel).

## Repository Layout
- `dashboard/` — **CrewTube Studio Manager** FastAPI backend (`server.py`), web UI (`static/index.html`), cloud snapshot sync (`sync_cloud_data.py`), and lightweight Vercel snapshot bundle (`cloud_data/`).
- `api/index.py` & `vercel.json` — Vercel Python serverless entrypoint exposing the FastAPI `app`.
- `faceless-shorts/` — 6-style local animated YouTube Shorts engine (`deep-dive`, `night-file`, `inside-out`, `stick-story`, `paper-atlas`, `tall-tale`).

## Run Locally (Full Pipeline + Manual Upload + Auto Queue)
```bash
pip install -r requirements.txt
uvicorn dashboard.server:app --host 127.0.0.1 --port 8765
```
Open http://127.0.0.1:8765.

To refresh the lightweight Vercel snapshot after rendering new Shorts locally:
```bash
python dashboard/sync_cloud_data.py
```

## Deploy to Vercel
This repository includes `vercel.json`, `requirements.txt`, and `api/index.py` for zero-config FastAPI deployment on Vercel:
```bash
vercel --prod
```
On Vercel, CrewTube runs in **Cloud Monitor Mode** with real-time YouTube channel analytics (`Animated_Crew`), live 7:00 PM IST (`Asia/Kolkata`) schedule countdown, full queued/published scripts, cover previews, and QA contact sheets.
