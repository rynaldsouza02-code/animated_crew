# Data Story (Data)

## Style card
Name: Data Story
Family: Data
Look: A calm, editorial data explainer: deep ink background, one warm accent per idea (coral, teal, sand), Archivo headlines, IBM Plex Mono numbers and labels, charts that draw themselves to scale, and the source always on screen.
How it explains: Numbers count up, then shrink into a label as the chart arrives. A line draws itself through the real data with dots popping at each milestone, the part that matters is re-traced in sand, bars grow one by one and get ringed, two cards set the key comparison side by side, and a plain-language takeaway lands with a sand pill.

## The look
- Data first: use real, sourced numbers for my topic and plot them to scale (no invented values, no cropped axes that exaggerate). Put a short "Source: ..." line at the bottom left of every frame. If a figure is an estimate, say so in the narration or a label. If you cannot verify a number, ask me instead of guessing.
- Surface: deep ink (#0f141c) with a faint coral glow top left and a faint teal glow bottom right, very subtle gridlines, and a vignette.
- Type: Archivo 800 for headlines and big numbers, IBM Plex Mono for every label, axis value, unit and the source line, and a small coral mono tag in caps above each headline. Ink #eef1f5, muted #7d8796.
- Color has meaning: one accent per idea. Coral for the main series, teal for supporting bars, sand (#f2c14e) for the one thing the viewer should remember. Never more than three colors on screen.
- Charts: lines draw left to right with a glowing head and a soft area fill, using a monotone curve through the real points so it never overshoots; milestone dots pop as the line passes them; bars grow from the baseline one by one with their value counting up on top; the key bar or span gets a sand ring or a sand re-trace with a glow.
- Numbers: big counters with thousands separators count up with an expo ease and lock; a comparison card pair shows two numbers side by side with a sand multiplier counting between them.
- Scene changes: soft slide-ups and clean pushes (composite with CUTS). The first number can shrink into a chart label so the opening flows into the chart without a cut.
- Takeaway: one plain sentence in Archivo with a sand pill behind the key phrase, then a single mono context line. Hold about 1.5 seconds.

## Rules that keep it in style
- Change the story, the words and the props; do not change the medium. Draw every subject accurately for my topic and double-check any facts and numbers you show.
- Every frame is a pure function of t. Use CM.rng(seed) and CM.noise1(seed) for all randomness, never Math.random. Caching static layers is fine.
- It will be watched on phones: at 1280x720 keep headlines at 50 px or more, the takeaway at 80 px or more, key numbers at 100 px or more, and axis labels at 16 px or more. Fill the frame.
- Keep each frame fast, well under 50 ms.
- Give my topic its own demo content; do not reuse the reference's story ("How we got to 8 billion people (UN World Population Prospects)") unless my content asks for it.

## Sound
- Bed: a low, thoughtful pad (padBed) with a soft pulse once the charts start; no big drums.
- Map events to the kit: counters "tick" only when the shown number changes, rising in pitch; each data milestone the line passes gets a soft pluck that climbs a pentatonic scale; each bar gets a pluck whose pitch follows its height; rings and pills get a bright swipe; scene changes get "whoosh"; cards get "pop"; the single biggest number lands on "boom" with a bell note; the takeaway gets an open chord.
- Full mix (no voiceover): keep the low pad with a soft pulse, at most about 3 sounds at once, and a short gap before the big comparison lands.
- Sync is everything: the sound score reads the same TL times as the picture.

## Helpers to reuse (from the original prompt)
One self-contained HTML file (an artifact if you can), built on the reference file below:
- Keep the page, the player (play/pause, scrub, time, sound toggle, loop, Load voiceover) and the CM and SFX blocks unchanged.
- Replace the demo's story: the data (POP, BILLIONS, YEARS_PER), TL, CUTS, the X and Y scales, the scene functions, SCENES, the source line text and scoreSound(). Keep and reuse the style's helpers (the ui-kit helpers (rr, track, rise, riseLine, pillBehind, composite, padBed), background(), tag(), cam(), popAt() (monotone curve), inverseYear(), the counter and the bar, card and pill drawing patterns).
- Aim for 15 to 40 seconds unless my content needs more, and set the duration in TL.D.
- Keep window.seek(t), window.DURATION, window.scoreSound and window.SFX exposed, so the video can be rendered frame by frame.
- Load the style's fonts before the first draw, as the reference does: Archivo (500 to 800), IBM Plex Mono (500 and 600).
