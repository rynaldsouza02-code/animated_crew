# Chalk Talk (Hand-Drawn)

## Style card
Name: Chalk Talk
Family: Hand-Drawn
Look: A teacher at a long green slate: grainy chalk strokes that skip over the board’s tooth, colored chalk for emphasis, dust falling from the stick as it writes, faint ghosts of old lessons, a wooden frame and a dusty chalk tray.
How it explains: One continuous lesson along the board: a visible chalk stick writes every word and draws every line, the camera tracks to the next stretch of slate, numbers are re-chalked as they count, pink chalk rings the key moments, and a felt eraser wipes a section clean for the takeaway.

## The look
- Surface: one long slate (BW wide, 720 tall) baked once with mottled green, faint chalk ghosts of old lessons and old eraser smears. The tooth pattern is punched out of the chalk layer every frame so strokes break like real chalk. Keep the wooden frame, the tray with chalk pieces, the classroom light falloff and the fine grain.
- Writing: everything appears by being chalked on in order. Letters arrive one at a time with a little jitter; lines are drawn along their path with small skips. The chalk stick follows the tip whenever something is being written, and dust falls from it.
- Type: Cabin Sketch for titles and the big takeaway, Kalam for equations, labels and notes. White chalk for content, yellow for the main idea and curves, pink for emphasis and key numbers, blue for side notes. Exponents and small marks use the dy offset on text parts.
- Camera: one board, one continuous shot. The camera tracks along the slate to a fresh stretch for each new idea (CAM keys) and leans in gently on the key moment. No cuts.
- Emphasis: pink rings around the key number or point, yellow underlines and brackets, chalk arrows that lead the eye along the board.
- Numbers: re-chalked as they count (a fresh scrawl about 10 times a second), then ringed when they land.
- Scene change: the felt eraser wipes a section back and forth, leaving a faint haze, and the next idea is written in the cleared space.
- Diagrams: draw real charts to scale for the topic, with axes, labels and curves computed from the actual function.
- Pace: something is always being written. Allow 0.4 to 1.2 seconds per line and hold the takeaway about 1.5 seconds.

## Rules that keep it in style
- Change the story, the words and the props; do not change the medium. Draw every subject accurately for my topic and double-check any facts and numbers you show.
- Every frame is a pure function of t. Use CM.rng(seed) and CM.noise1(seed) for all randomness, never Math.random. Caching static layers is fine.
- It will be watched on phones: at 1280x720 keep headings at 90 px or more, chalked writing at 56 px or more, labels at 36 px or more, and key numbers at 72 px or more. Fill the frame.
- Keep each frame fast, well under 50 ms.
- Give my topic its own demo content; do not reuse the reference's story ("Get 1% better every day") unless my content asks for it.

## Sound
- Bed: quiet room tone only, no music. A double knock on the board can open the lesson.
- Chalk: every word gets its own scratch (grainy band-passed noise bursts with a tap where the stick lands), timed by character position across its write window. Lines get one long scratch; rings and underlines a little louder. Use the score helpers tap, scratch, write and pluck, built on k.hiss and k.voice.
- Counter: a short scratch each time the shown number changes. Eraser: a felt swish for each pass, panned with the eraser.
- Big moments: soft plucked notes, two for a landed number and a rising arpeggio for the takeaway. Keep it gentle; this is a lesson, not a trailer.
- Full mix (no voiceover): room tone, chalk and eraser sounds, and soft plucks on the big moments. No music.
- Sync is everything: the sound score reads the same TL times as the picture.

## Helpers to reuse (from the original prompt)
One self-contained HTML file (an artifact if you can), built on the reference file below:
- Keep the page, the player (play/pause, scrub, time, sound toggle, loop, Load voiceover) and the CM and SFX blocks unchanged.
- Replace the demo's story: TL, CAM, the counter curve (cntStep, cntVal, cntText), ITEMS, drawCounter(), WIPE and its timing, and scoreSound(). Keep and reuse the style's helpers (board(), tooth(), noise2, chalkLine, chalkText, layoutText, resample, quad, ellipse, wipeMask, the frame and tray, the chalk stick, the eraser, dust() and the compositor).
- Aim for 15 to 40 seconds unless my content needs more, and set the duration in TL.D.
- Keep window.seek(t), window.DURATION, window.scoreSound and window.SFX exposed, so the video can be rendered frame by frame.
- Load the style's fonts before the first draw, as the reference does: Cabin Sketch (700), Kalam (400 and 700).
