# Software Walkthrough (Screen and UI)

## Style card
Name: Software Walkthrough
Family: Screen and UI
Look: A polished screen-recording tutorial built entirely in code: an app window on a soft gradient desktop, a real-feeling cursor with click ripples, a camera that zooms into what matters, yellow-edged spotlights, numbered step callouts and a calm pad underneath.
How it explains: It shows the clicks, not just the idea: a title card, then the cursor moves through the real flow while the camera follows it in and out, modals and menus open, fields get typed, toggles flip, and a dark step pill at the bottom left counts you through. It ends on the result actually happening and a short lower third.

## The look
- Surface: a desktop with a soft indigo to teal gradient wallpaper and two slow light blooms. On it, one app window (rounded, deep shadow) with a title bar, a sidebar and a main area. The whole UI is drawn in code, crisp and believable, for an invented app with an invented name. Never copy a real product’s UI, name or logo.
- Type: DM Sans for all UI and titles (700 for headings and selected items, 400 to 500 for body), DM Mono in caps for tiny labels (WHEN, THEN, LIVE). Ink #14161c, muted #6a6f7c, one accent (#5b5bf6) for buttons, selection and the cursor ripple, green #1fb46e for live and success, yellow #ffd60a only for spotlight edges.
- Cursor: a classic arrow that moves along eased waypoints (CURSOR keys), dips slightly on each click, and leaves an accent ripple. Every click has a visible result within 0.1 s: a pressed button, a selected row, an opened menu.
- Camera: one continuous screen recording. Zoom in (1.2x to 1.6x) toward the area being used, hold, and ease back out to the full window between steps (CAM keys). The camera leads the cursor slightly.
- Emphasis: a spotlight dims everything except a rounded cutout with a yellow edge around the one control that matters. Toasts, notifications and a side panel slide in to prove the result.
- Chrome: a title card first (small mono tag, a big two-line title, a pill with the step count and time), a dark numbered step pill at the bottom left that swaps as each step starts, and a dark lower third with a green check at the end.
- Flow: real UI behaviour in order: navigate, empty state, modal with choices, dropdown, continue, editor with connected nodes, typed fields, chips, a toggle that turns on, and the outcome happening (a new row, a message, a file).
- Pace: 3 to 5 seconds per step, never more than one new action at a time, and a 1.5 second hold on the result.

## Rules that keep it in style
- Change the story, the words and the props; do not change the medium. Draw every subject accurately for my topic and double-check any facts and numbers you show.
- Every frame is a pure function of t. Use CM.rng(seed) and CM.noise1(seed) for all randomness, never Math.random. Caching static layers is fine.
- It will be watched on phones: at 1280x720 keep the title card at 90 px or more, step callouts at 28 px, app text at 18 px or more (the camera zooms in on anything smaller), and the lower third at 40 px. Fill the frame.
- Keep each frame fast, well under 50 ms.
- Give my topic its own demo content; do not reuse the reference's story ("Your first automation in an invented app called Flowdesk") unless my content asks for it.

## Sound
- Bed: a warm, slow pad (padBed) with soft hats while the steps run, no kick. It drops away under the title card for a moment.
- Map events to the kit: every cursor click gets "click"; modals, menus, nodes and chips get "pop" (higher pitch for smaller things); typing gets "keys"; every camera zoom in or out gets a soft pink-noise swell; step pills get a two-note chime that climbs a little with each step; the toggle gets a short bright swish; a toast or the result gets a chime; an incoming notification gets "ping"; panels sliding in get a soft "whoosh".
- Full mix (no voiceover): keep the warm pad and soft hats, crisp clicks on every click, and a quiet moment before the result appears.
- Sync is everything: the sound score reads the same TL times as the picture.

## Helpers to reuse (from the original prompt)
One self-contained HTML file (an artifact if you can), built on the reference file below:
- Keep the page, the player (play/pause, scrub, time, sound toggle, loop, Load voiceover) and the CM and SFX blocks unchanged.
- Replace the demo's story: TL, CAM, CURSOR, STEP_NAMES, the app pieces (sidebar, header, homePage, emptyState, modal, editor), the spotlight calls in explainer(), titleCard(), notification(), outroCard() and scoreSound(). Keep and reuse the style's helpers (the ui-kit helpers (rr, track, rise, riseLine, typed, softCard, cursorArrow, checkMark, padBed), wallpaper(), appWindow() as the frame, spotlight(), cursor(), stepCallout() and the camera transform in explainer()).
- Aim for 15 to 40 seconds unless my content needs more, and set the duration in TL.D.
- Keep window.seek(t), window.DURATION, window.scoreSound and window.SFX exposed, so the video can be rendered frame by frame.
- Load the style's fonts before the first draw, as the reference does: DM Sans (400 to 700), DM Mono (400 and 500).
