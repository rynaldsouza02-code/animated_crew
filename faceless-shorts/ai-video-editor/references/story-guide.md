# Writing story.js

story.js is the only code you write for an edit. It draws the motion graphics for the edited video
(cut.mp4) in one of the seven styles. The page loads, in order:

1. `styles/<style>/base.js`: the style engine, unchanged from the Nafay 3D Style Library reference. It holds
   CM (helpers and seeded randomness), SFX (synthesized sound kit), the style's palette `C`, fonts, drawing
   helpers, and the reference demo (scene functions, `explainer`, `scoreSound`) as a worked example.
2. `story.js`: yours.
3. `engine/player.js`: the editor player. It defines `FOOTAGE`, `gfxInOut`, `window.seek` and the render hooks.

## The contract

```js
var EDIT = {
  D: 312.4,                         // length of cut.mp4 in seconds (edit.json "cut_seconds")
  SPANS: [[12.1, 18.6], [40.0, 52.3]], // where graphics are on screen. Outside them the plain footage plays.
  draw(ctx, t) { ... },             // draws frame t, only called inside a span. Design space is 1280 x 720.
  score(k) { ... },                 // all sound effects for the whole video, at the same times as the picture
};
```

- Times are seconds of the EDITED video. Take them from `transcript_edited.txt` / `transcript_edited.json`.
- Start a span about 0.1 to 0.3 s before the first word it illustrates; end it when the idea is done.
  Leave plain footage between spans. Spans must not overlap.
- Every frame is a pure function of t (the renderer draws frames out of order on several workers).
  Use `CM.rng(seed)` and `CM.noise1(seed)`, never `Math.random`. Caching static layers is fine.
- Keep each frame fast (well under 50 ms). Make offscreen canvases once (`CM.layer(w, h)`), not per frame.
- Declare `TL`, `CUTS`, `PUNCH`, `SCENES` with `var` if you reuse those names (base.js declares them with var
  so you can redefine them). Name your own scene functions freshly (for example `gfxIntro`, `gfxSteps`).
- Never assign `window.scoreSound` or `window.seek`, and do not redefine the style's helpers unless you mean to
  change them everywhere.
- Draw at 1280 x 720 always. The renderer makes it sharp at 1080p or 4K by itself.
- Text in any script works: Devanagari falls back to Noto Sans Devanagari inside every style font.

## Footage

```js
FOOTAGE.full(c, z = 1, fx = 0.5, fy = 0.38)      // the footage full frame, zoomed z around the face point
FOOTAGE.draw(c, x, y, w, h, z, fx, fy)           // cover-fit into any rect (picture-in-picture, cards, phones)
gfxInOut(c, t, a, b, drawFn, { type, d })        // full-screen graphics for span [a, b] with an entrance and exit
                                                 // from/to the footage: type 'push' | 'up' | 'fade' | 'cut'
```

`FOOTAGE` is always the footage at time t. Warm Canvas's own A-roll helpers (`fullARoll`, `pip`,
`arollFeed`) already use it, so call them directly.

## Two ways to use a style

**Talking-head styles (Warm Canvas):** the speaker stays the star. Mode 1 is full-frame footage with a caption
(`caption()`) or side chips (`sideChip()`); mode 2 is the warm canvas with the speaker in the PiP (`canvasBG()`,
`pip()`) and cards in the left column (`COLX`). See `references/example-story-warm-canvas.js`, a complete,
rendered example.

**Full-screen styles (Creator Motion Graphics, Chalk Talk, Clean Tech, Software Walkthrough, Data Story,
Pop Info):** the graphics replace the picture for a beat while the voice continues, then cut back to the
speaker. Wrap each beat in `gfxInOut` (or use the style's own transitions between beats inside one span).
Creator Motion Graphics also works over the footage: draw `FOOTAGE.full(c)`, darken it
(`c.fillStyle = 'rgba(0,0,0,0.55)'; c.fillRect(0, 0, 1280, 720)`), then its kinetic words on top.

To learn a style, read in base.js everything after the `STYLE:` banner: the palette, the helpers, and the demo
scene functions (`sceneXxx`), which show exactly how backgrounds, type, cards and motion are built. Copy their
patterns and invent new content for this video. The demo's own `explainer(ctx, t)` composites its scenes with
`CUTS`; you can build your own small compositor the same way, or call one scene function per span.

A useful pattern for long videos: one function per beat, each with its own local time.

```js
var BEATS = [
  { a: 12.1, b: 18.6, draw: gfxIntro },
  { a: 40.0, b: 52.3, draw: gfxSteps },
];
var EDIT = {
  D: 312.4,
  SPANS: BEATS.map((x) => [x.a, x.b]),
  draw(c, t) { const x = BEATS.find((x) => t >= x.a && t < x.b); gfxInOut(c, t, x.a, x.b, (g, tt) => x.draw(g, tt, tt - x.a), { type: 'push' }); },
  score(k) { BEATS.forEach((x) => x.sound && x.sound(k, x.a)); },
};
```

## Sound

- `score(k)` gets the SFX kit: `k.play(name, t, opts)` for the named sounds in base.js (`slam`, `whoosh`, `click`,
  `tick`, `keys`, `marker`, `strike`, `stamp`, `boom`, ...), plus `k.voice()`, `k.hiss()`, `k.drone()`.
  Each style's demo `scoreSound` shows its own palette (Warm Canvas: soft paper slides, low wooden taps).
- The mix is always rendered in voiceover mode (music bus low, `soft` sounds at 55%), because it sits under
  a real voice. Keep it sparse: one sound per visual event that deserves one, never more than two at once.
- No chimes, bells, pings, sparkles or high-pitched game-style pops (`ping`, `shimmer`, `sparkle`, `pop`).
  No music beat under speech.
- Every sound time must come from the same TL numbers as the picture.

## Taste rules (the user's defaults)

- Add motion graphics only where they communicate something: a list, a number, a comparison, a process, a
  definition, a before/after. Never decoration for its own sake. Plenty of the video stays plain footage.
- Never put a small coloured label or tag above a title or heading. Put supporting text below or beside.
- One idea per beat; on-screen words are short (2 to 6 words), spelled exactly as spoken where possible.
- Double-check any facts and numbers you show; if the speaker says them, match what they said.
- Follow the style's own rules in `styles/<style>/style.md`. Ignore the parts of that file about storyboards,
  asking for a topic, the player, target duration or rendering: this skill handles those.

## Checking your work

```
python scripts/render.py WORK --check           # loads the page; prints errors, spans, output size
python scripts/render.py WORK --stills auto     # 3 stills per span -> WORK/stills/contact.png
python scripts/render.py WORK --stills 14.2,15  # stills at chosen times
```

Open the contact sheet (it is an image file) and look at it: text inside the frame and not overlapping,
nothing covering the speaker's face in a PiP, readable sizes, the style's look. Fix and re-check before
the full render.
