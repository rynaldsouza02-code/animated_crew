# AI Video Editor (free skill)

Give your AI coding agent a talking-head video. It asks you a few questions, then:

1. Transcribes it on your computer with Whisper (English and Hindi)
2. Cuts the silent parts and your mistakes (retakes, false starts)
3. Adds motion graphics in one of 7 styles from the Nafay 3D Style Library
4. Adds sound effects and optional captions, and renders the final MP4

No paid APIs. Everything runs locally: Whisper, ffmpeg and a headless browser.

## Install

1. Install **ffmpeg**
   - Windows: `winget install Gyan.FFmpeg`
   - Mac: `brew install ffmpeg`
   - Linux: `sudo apt install ffmpeg`
2. Install **Python 3.9+** if you don't have it (python.org).
3. Unzip this folder into your skills folder:
   - **Claude Code:** `~/.claude/skills/ai-video-editor/` (Windows: `C:\Users\<you>\.claude\skills\ai-video-editor\`)
   - **OpenCode:** the same folder works (OpenCode also reads `~/.claude/skills`), or use `~/.config/opencode/skills/ai-video-editor/`
4. Start Claude Code or OpenCode and say: **"Edit my video C:\path\to\video.mp4"**.
   The first time, the agent runs the setup script, which installs the Python packages and the browser (free, one time).

## Good to know

- The first transcription downloads a Whisper model once (0.5 to 1.6 GB).
- Hindi uses the larger model; on a laptop without an NVIDIA GPU it can take about as long as the video.
- Long videos use a lot of your AI plan's usage, because the agent reads the transcript and writes the graphics code.
- 16:9 videos for now.

Made by Nafay 3D: youtube.com/@nafay3d
