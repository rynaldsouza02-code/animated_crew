# Pop Info (Illustrated)

## Style card
Name: Pop Info
Family: Illustrated
Look: A flat-vector animated infographic, drawn entirely in code: a cosy cartoon scene (here a grocery aisle in soft perspective), one small character with a big feeling, a teal thought bubble that carries the idea, a counter, a dotted path and an iris wipe in and out. Muted room colours, warm product colours, rounded Fredoka type.
How it explains: The scene builds itself: an iris opens, shelves slide in from both sides, the character pops up and reacts (annoyed, looking, sighing). The idea appears as a bubble with a friendly mascot, a number counts up inside it with a little tag, a dotted path draws through the scene to a pin, and the camera slowly pushes toward the point of interest. An iris closes on the takeaway.

## The look
- Everything is original flat vector art drawn with canvas paths: no images, no outlines, simple rounded shapes, one flat shadow tone per object, soft highlights, and a few drifting dust specks for life. Invent the setting and characters for my topic; never copy a real brand, logo, mascot or packaging.
- Draw in the 680 x 383 design space and let renderAt() scale it, so the art stays crisp at any size. Keep shapes big and readable on a phone.
- Palette: a muted, desaturated room (sage wall #D7DCCB, warm floor #C4B79D), warm accent objects (#E07A5F, #F2CC8F, #81B29A, #6C9BB8), deep teal #2F6F73 for the idea bubble, coral #E85D4A for alerts and signs, and sunny yellow #FFD86B for tags, the iris ring and sparkles. Text is white or dark teal.
- One character with a strong, simple emotion (eyebrows, mouth, blinks, a sweat drop, a sigh) is the emotional anchor. It sits in the foreground with gentle parallax while the camera pushes the background.
- The idea lives in a bubble: a friendly mascot or icon, a number that counts up with an eased curve, and a small pill tag. Numbers must be real or clearly framed as an example; if you cannot verify one, ask me.
- Motion is springy and playful: things pop in with a back-eased scale (popS), settle with a decaying wobble, the scene slides in from the sides, a dotted path draws itself and a pin drops, and the camera does one slow push. Open and close with the teal iris wipe with a yellow ring.
- Keep it to one scene per idea, with clear staging: setting, character reaction, the idea in the bubble, the visual proof (path, arrow or chart), then the iris closes.

## Rules that keep it in style
- Change the story, the words and the props; do not change the medium. Draw every subject accurately for my topic and double-check any facts and numbers you show.
- Every frame is a pure function of t. Use CM.rng(seed) and CM.noise1(seed) for all randomness, never Math.random. Caching static layers is fine.
- It will be watched on phones: at 1280x720 in the 680 x 383 design space keep the main number at 21 px or more, labels at 11 px or more and any title at 26 px or more (that is about 40, 21 and 50 px at 1280x720), and keep the character and the bubble large. Fill the frame.
- Keep each frame fast, well under 50 ms.
- Give my topic its own demo content; do not reuse the reference's story ("Why is the milk always at the back of the store?") unless my content asks for it.

## Sound
- Soft, toy-like and sparse: rounded pops for the bubble, tags and pin, little sine bloops for character reactions, wooden taps for landings, counter steps and path dots (thinning out as the counter lands), airy whooshes for the iris and the slides, and one breathy sigh.
- No chimes, bells, pings or sparkle sounds, even for winks and sparkles on screen. The cartoon carries the charm; the sound only gives it weight.
- Full mix (no voiceover): a light, friendly music bed (k.music at a low gain), at most about 3 sounds at once, and a short quiet moment before the pin or the payoff lands.
- Sync is everything: the sound score reads the same TL times as the picture.

## Helpers to reuse (from the original prompt)
One self-contained HTML file (an artifact if you can), built on the reference file below:
- Keep the page, the player (play/pause, scrub, time, sound toggle, loop, Load voiceover) and the CM and SFX blocks unchanged.
- Replace the demo's story: TL, the scene (drawRoom, drawShelf and the product layout ROWS, or a new setting for my topic), the character (drawShopper) and its reactions, the bubble contents (drawBubble: mascot, counter and tag), drawPath, the camera move in renderAt and scoreSound(). Keep and reuse the style's helpers (the 680 x 383 design space with renderAt() scaling it to the canvas, prog(), popS(), wobble(), blink(), the easings, rr(), the dust layer, the iris wipe (drawWipe), the parallax split between background and foreground, and the explainer() compositor).
- Aim for 15 to 40 seconds unless my content needs more, and set the duration in TL.D.
- Keep window.seek(t), window.DURATION, window.scoreSound and window.SFX exposed, so the video can be rendered frame by frame.
- Load the style's fonts before the first draw, as the reference does: Fredoka (500 to 700).
