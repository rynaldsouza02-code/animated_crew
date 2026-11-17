# Creator Motion Graphics (Kinetic Type)

## Style card
Name: Creator Motion Graphics
Family: Kinetic Type
Look: The high-energy business-creator edit: huge condensed caps slamming in word by word, a yellow serif accent on the one word that matters, highlighter swipes, hand-drawn circles and arrows, tilted browser and phone mockups, rolling green counters, film grain and light leaks on near-black.
How it explains: Every idea gets its own beat: words land on the beat with punch zooms and shake, the wrong idea gets a red strike and a stamp, proof appears as code-drawn mockups, the key number rolls up and locks with a boom, and whip pans, RGB glitches and flash cuts carry you between scenes.

## The look
- Surface: a near-black editing-room background with slow warm and cool glows, a faint drifting grid, a vignette and film grain stepped at 24 fps. Run background() and finishing() on every frame at the reference’s strength.
- Type: Anton in caps for statements, set big (80 to 220 px). Instrument Serif italic in yellow for the one soft or emotional phrase. Inter for labels and small supporting lines. At most one yellow word per line; green only for money and growth numbers; red only for the wrong idea.
- How things appear: words slam in one at a time (large and blurred, settling with an expo ease). Cards, chips and pills pop with overshoot. Mockups swing in with a 3D tilt (drawYaw) or slide up from below.
- Emphasis: punch zoom plus shake on the hardest words; a yellow highlighter swipe that turns the word dark; a hand-drawn circle and arrow onto the thing that matters; a red strike-through for the wrong idea; a stamp for a flat rejection.
- Numbers: a rolling counter in green with a glow. When it locks: a boom, a white flash, a light leak and spark streaks.
- Proof shots: stylized mockups drawn in code (browser pages, phone chats, dashboards, cards) with invented, generic names. No real logos, brand names or real people, and nothing that would pass as a real receipt or a real message. Label figures as examples when they are illustrative.
- Scene changes: every new idea gets a cut, rotating between whip pans with motion blur, RGB glitches and flash cuts. Inside a scene keep things continuous: lines stack, shift up, get struck out, and new lines arrive.
- Chrome: a small topic label at the top left, plus a STEP pill only when the content is a real sequence.
- Pace: the hook lands in under 2 seconds, something new happens every 0.5 to 1.5 seconds, and the takeaway holds about 1.5 seconds at the end.

## Rules that keep it in style
- Change the story, the words and the props; do not change the medium. Draw every subject accurately for my topic and double-check any facts and numbers you show.
- Every frame is a pure function of t. Use CM.rng(seed) and CM.noise1(seed) for all randomness, never Math.random. Caching static layers is fine.
- It will be watched on phones: at 1280x720 keep statement text at 80 px or more, any label the story depends on at 28 px or more, and key numbers at 120 px or more. Fill the frame.
- Keep each frame fast, well under 50 ms.
- Give my topic its own demo content; do not reuse the reference's story ("How to land your first client") unless my content asks for it.

## Sound
- Music: a low drone and a riser into the first big word, the half-time beat (k.music) under the body, a tape stop on the wrong idea, and the beat back for the takeaway. Booms duck the music on their own.
- Map events to the kit: word slams get "slam" (bigger word, more gain); pills, chips and cards get "pop"; cuts get "whoosh", "glitch" or a "slam" on the flash; highlighter and hand-drawn marks get "marker"; strike-throughs get "strike"; typing gets "keys"; a sent message "send", an incoming one "ping"; clicks "click"; counters "tick" only when the shown number changes and never more than 12 per second; the big number lands on "boom" + "slam" + "shimmer"; a rejection gets "stamp".
- Full mix (no voiceover): keep the music, have at most about 3 sounds at once, and leave a moment of near-silence before the biggest hit.
- Sync is everything: the sound score reads the same TL times as the picture.

## Helpers to reuse (from the original prompt)
One self-contained HTML file (an artifact if you can), built on the reference file below:
- Keep the page, the player (play/pause, scrub, time, sound toggle, loop, Load voiceover) and the CM and SFX blocks unchanged.
- Replace the demo's story: TL, CUTS, PUNCH, SHAKE, FLASH, LEAK, PUSH, the value curves, the scene functions, SCENES, the chrome() label text and scoreSound(). Keep and reuse the style's helpers (slam, row, swipe, slamMarked, strike, scribble, handArrow, drawYaw, bubble, background, finishing and the compositor).
- Aim for 15 to 40 seconds unless my content needs more, and set the duration in TL.D.
- Keep window.seek(t), window.DURATION, window.scoreSound and window.SFX exposed, so the video can be rendered frame by frame.
- Load the style's fonts before the first draw, as the reference does: Anton, Instrument Serif (italic), Inter.
