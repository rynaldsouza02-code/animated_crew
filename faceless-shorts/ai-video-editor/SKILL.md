---
name: ai-video-editor
description: Edit a talking-head video end to end for free. Asks a few questions, cuts silent parts and mistakes (retakes, false starts) using local Whisper, adds code-drawn motion graphics in one of 7 Nafay 3D styles, and renders the final MP4. English and Hindi. Use when the user gives a video file and wants it edited, cut, or given motion graphics.
---

# AI Video Editor

Turns a raw talking-head recording into a finished video: silences and mistakes cut, motion graphics in one of
seven styles, sound effects, optional captions, loudness set for YouTube. Everything runs on the user's computer
with free tools: Whisper (faster-whisper) for transcription, ffmpeg for cutting and encoding, headless Chromium
for drawing the graphics. You (the agent) are the editor: you decide the cuts and write the graphics.

`SKILL` below means this skill's folder (the one containing this file). If your tool did not tell you where
it is, look for the first of these that contains `scripts/render.py`: `~/.claude/skills/ai-video-editor`,
`~/.config/opencode/skills/ai-video-editor`, `~/.agents/skills/ai-video-editor`, or the same names
under `.claude/skills`, `.opencode/skills` or `.agents/skills` in the current project. Run scripts with the Python the user has
(`python` on Windows, usually `python3` on macOS/Linux). Quote paths: video paths often contain spaces.
Every script prints JSON or a short report; read it before the next step.

## 0. Setup (first time only)

```
python "SKILL/scripts/setup.py" --check
```
If anything is missing, run `python "SKILL/scripts/setup.py"` (installs faster-whisper, playwright, numpy,
pillow and the headless browser; all free). ffmpeg must be installed separately: the report prints the right
command for the user's OS (Windows: `winget install Gyan.FFmpeg`, macOS: `brew install ffmpeg`). Ask before
installing anything system-wide.

## 1. Ask first

Before touching the video, ask these in one go (use your question tool if you have one, otherwise a short
numbered list). Offer the default in brackets so the user can just say "defaults".

1. **Cut silent parts?** yes / no [yes]. Pace: natural (keeps 0.3 s pauses) or tight (0.15 s) [natural].
2. **Cut mistakes?** Retakes, false starts, repeated lines, "wait let me redo that": yes / no [yes].
   Show the list of mistake cuts for approval first? [yes]
3. **Style** (read `SKILL/styles/index.json`; one line each):
   - Warm Canvas: calm editorial, you stay on screen with serif captions and a PiP canvas of cards. Best default for talking heads.
   - Creator Motion Graphics: punchy kinetic type, dark, high energy.
   - Clean Tech: light, crisp UI cards and kinetic type for tech topics.
   - Software Walkthrough: mock app screens, cursor and clicks for tutorials.
   - Data Story: dark charts and counters for numbers and trends.
   - Chalk Talk: hand-drawn chalkboard for explaining ideas.
   - Pop Info: flat illustrated infographic scenes with a character.
   Or "no graphics" (just the cut, with captions if wanted).
4. **Language:** English, Hindi, or a Hindi/English mix [detect].
5. **Captions:** yes / no [no]. For Hindi: Devanagari or Roman letters (Hinglish)?
6. **How much graphics:** light (only the key moments) / medium [light]. Graphics only where they explain something.
7. **Check-ins:** review the graphics plan and stills before the final render? [yes]

If the user gave some answers already, ask only the rest.

## 2. Transcribe

```
python "SKILL/scripts/transcribe.py" "VIDEO" --lang en|hi|auto
```
Creates the project folder `<video name>_edit` next to the video (WORK below) with `transcript.txt`.
English uses `small.en` on CPU (fast) and `large-v3-turbo` on an NVIDIA GPU; Hindi/mixed always uses
`large-v3-turbo`. The first run downloads the model once (small.en about 0.5 GB, turbo about 1.6 GB). On a CPU,
turbo takes roughly as long as the video or longer, so tell the user before a long run. `--model medium.en`
is a middle ground for English.

## 3. Find the mistakes (skip if the user said no)

Read `WORK/transcript.txt`. Each line is a phrase: `[start-end] wA-wB: text`, with `(pause Ns)` between.
Look for:
- **Retakes:** the same sentence (or its opening) said twice or more. Keep the LAST complete take; remove the
  earlier attempts entirely, including any half-finished words.
- **False starts:** a phrase that stops mid-thought and restarts ("So the main, the key thing is").
  Remove the abandoned part.
- **Explicit redo cues:** "let me say that again", "cut that", "one more time", "wait", "sorry".
  Remove the cue and the take it refers to.
- **Filler at the start/end:** "okay, recording", "is this on", trailing "and, um, yeah".
- Fillers inside sentences ("um", "uh"): remove only clusters or long ones; single fillers usually sound
  natural. Hindi speakers' "matlab", "toh", "na" are normal speech, keep them.
Do NOT remove content just because it is informal, and never reorder sentences.

Write `WORK/edits.json`:
```json
{ "remove": [ {"from": 41, "to": 58, "why": "first take of the intro"},
              {"from": 203, "to": 207, "why": "false start"} ] }
```
`from`/`to` are word indices (inclusive) from transcript.txt. Then preview the plan:
```
python "SKILL/scripts/cut.py" WORK --dry-run --style STYLE --captions yes|no [--no-silence] [--pause 0.15]
```
If the user wanted to approve mistake cuts, show them the `mistake_cuts` list (time, reason, the removed words)
and wait. Adjust edits.json if they disagree.

## 4. Cut

```
python "SKILL/scripts/cut.py" WORK --style STYLE --captions yes|no [--no-silence] [--pause 0.15]
```
Writes `cut.mp4` (frame-accurate, click-free joins, 1080p by default; `--height 2160` keeps 4K),
`transcript_edited.txt/json` with the NEW times, and the cut summary. If the user chose no graphics, use `--style warm-canvas` (it only sets the caption look) and skip to 7
with an empty story: `var EDIT = { D: <cut_seconds>, SPANS: [], draw() {}, score() {} };`.

## 5. Plan the graphics

Read, in this order:
1. `SKILL/references/story-guide.md` (the contract, footage helpers, sound and taste rules). Always.
2. `SKILL/styles/STYLE/style.md` (the look and rules of the style).
3. `SKILL/styles/STYLE/base.js` from the `STYLE:` banner to the end (helpers and the demo scenes to learn from).
4. For Warm Canvas, `SKILL/references/example-story-warm-canvas.js` (a complete working story).
5. `WORK/transcript_edited.txt`.

Pick the beats: the moments where a visual makes the idea clearer (a list, number, comparison, process, key term,
before/after, a named tool). Light = roughly one beat per 30 to 60 seconds; medium = one per 15 to 30 seconds.
Leave the personal and emotional lines on the plain footage. For each beat note: start/end time, the words it
illustrates, what is on screen, how it enters and leaves.

If the user wanted check-ins, show the beat list (a short table) and wait for an OK.

## 6. Write story.js and check it

Write `WORK/story.js` following the guide. Set `EDIT.D` to `cut_seconds` from `WORK/edit.json`. Then:
```
python "SKILL/scripts/render.py" WORK --check
python "SKILL/scripts/render.py" WORK --stills auto
```
Open `WORK/stills/contact.png` (an image; look at it) and fix anything off: clipped or overlapping text, small
type, graphics covering the face, off-style colours, wrong words. Repeat until it looks right. For check-ins,
show the user the contact sheet. Optional live preview with sound:
`python "SKILL/scripts/preview.py" WORK` (run it in the background; it prints a localhost link).

## 7. Render

```
python "SKILL/scripts/render.py" WORK
```
Renders the graphics frames in parallel, the effects, captions (if on), mixes voice and effects, normalizes to
-14 LUFS, and writes `WORK/final.mp4`. Expect a few frames per second of graphics on a laptop; plain footage
costs nothing extra. Options: `--preset slow` (smaller, slightly better file), `--sfx-gain 0.7` (quieter
effects), `--no-captions`, `--height 2160`.

Tell the user where final.mp4 is, how much was cut (from the cut summary), and what graphics were added.

## Fixing things later

- A cut is wrong: edit `edits.json` (or run with `--no-silence` / another `--pause`), re-run cut.py. Then shift
  the story's times if words moved (re-read transcript_edited.txt) and render again.
- A misheard word in captions: edit its `"w"` in `transcript_edited.json` (or add `"cap"`), render again.
- Hindi captions in Roman letters: add `"cap"` with the Roman spelling to each word in transcript_edited.json.
- Only the graphics changed: edit story.js and run render.py; nothing else needs redoing.

## Limits

- 16:9 videos. Vertical or square sources are center-cropped to 16:9 for now.
- One continuous recording per edit (join clips first with ffmpeg if needed).
