# Tall Tale 3D: funny true stories, 9:16

Playful, clever, high-retention short videos. Flat 2D cartoon people (thick ink outlines, big round white heads, bean bodies, stick
limbs) acting inside a sunny, saturated 3D world: small-town streets, wallpapered shops, meadows, bank vaults, courtrooms. The camera moves
in every shot, faces react on every beat, bold captions highlight active words at 1.1x speech speed.
Example: `example/` = **THE GIRL WHO WAS MAILED TO GRANDMA** (1914; 52 s, 21 shots). Sheet: `style-sheet.png`.

## 1. High-Retention Rules (CRITICAL)

### Pillar 1: Hook & Script
- **Open Mid-Action (First 3 Seconds)**: Plunge immediately into the action with an unanswered "open-loop" curiosity gap. Zero intro, zero filler ("Did you know?", "Meet John"), and never give away the ending in the hook.
- **Sentence Length**: Strict maximum of **8–12 words per sentence**. Crisp, punchy, conversational sentences with rhythmic flow.
- **Duration**: **35–45 seconds total** (~85–115 words at 1.1x speech rate).
- **Infinite Seamless Loop**: End on a twist or setup line that grammatically and narratively loops right back into the opening first line without a seam.

### Pillar 2: Visual Pacing & Composition
- **Cut Frequency**: Change the visual frame every **2.5–3.0 seconds** (never let a single camera shot stay longer than 3.0s).
- **Alternating Camera Rhythm**: Continuously cycle through 3 distinct visual perspectives:
  1. `Close-up character reaction` (tight camera on toon face: shock, smug smile, sweat drop, eyebrow raise, jaw drop).
  2. `Wide action shot` (full toon body interacting with environment, running, walking down boardwalk, riding train, crowd).
  3. `Prop / document insert` (macro view of the physical artifact: newspaper headline, telegram, scale, wanted poster, blueprint, currency stack).
  Repeat: Close-Up → Wide Action → Prop Insert → Close-Up → Wide Action → Prop Insert...
- **Caption Clearance**: Keep the central upper-middle space clear and high-contrast so captions are instantly readable on mobile.

### Pillar 3: Audio & Captions
- **Zero Dead Air**: Trim all voiceover silences longer than 0.15s down to <= 0.08s. Speech speed defaults to **1.1x** (`speed=1.1`).
- **Seamless Audio Loop**: Lead silence <= 0.05s and outro silence <= 0.06s so the loop between video end and video start has zero dead air.
- **Bold 3–4 Word Captions**: Render bold, 3–4 word animated chunks with **active-word highlight** (current spoken word in vibrant `#FFE600` yellow with subtle pop, other words bold white `#FFFFFF` with heavy `#0B0B10` black outline).
- **Safe Zone (Y=1250px)**: Center-lower third positioned around Y=1250px to stay clear of YouTube Shorts bottom UI (sound title, channel handle, subscribe button) and side action buttons.

---

## 2. Engine map (`example/src/`)
| file | gives you |
|---|---|
| `core/engine.js` | `makeEngine` (neutral tone curve, soft shadows, bloom, depth of field, saturation grade), `camera(fov)` |
| `core/toon.js` | `drawToon(g, look, st)` (2D drawing), `new Toon(look, { height, res })` (3D cut-out: `.at(x,y,z)`, `.set(st)`, `.face(cam)`, `.tint(col)`, `.restyle(patch)`), `PROPS` held in hands |
| `core/world.js` | sets: `mainStreet(E, { shops, dusk })` (returns `buildings` with each shop's position), `interior(E, { wall, motif, floor, ceiling, view, signText, counterOn })`, `meadow(E, { sunset, fenceOn })`; pieces: `sky, clouds, sunlight, hills, tree, pole, wire, lamp, barrel, crate, car, fence, bunting, signBoard, facade, extras`; painted textures `T.planks/wallpaper/brick/siding/dirt/grass/felt`; `snapshot(E, scene, cam)` renders a set into a texture (window views) |
| `core/props.js` | `house()` (`.door` opens), `signpost`, `platformScale()` (`.set(lbs)`), `train()` (`.update(t)`), `rails`, `cubbies`, `mailSack`, `parcel`, `desk`, `poster(lines)`, `chickCrate()` |
| `core/captions.js` | 3-4 word captions with active-word highlight at Y=1250 safe zone, `captionText(text, x, y)` |

**Toon look**: `{ body, pattern: plain│check│stripes│overalls│vest│apron│stamps, patCol, hat: none│cap│bowler│boater│beanie│visor│tophat│bun│flower│bow│mailcap, hatCol, band, neck: none│bowtie│tie│scarf│collar, neckCol, dots, extra: [mustache, glasses, freckles, blush, pencil, monocle], kid, stamps }`.
**Toon state**: `{ mood: neutral│smug│happy│laugh│shock│worried│angry│sad│sly│proud│tired│dizzy, look: [dx, dy], blink, talk, sweat, tears, armL / armR: [shoulder°, elbow°] (0 = down, 150 = up), legs: stand│walk│run│sit│jump, phase, lean, bob, holdL / holdR: PROPS.x, flip }`. A prop made with arguments (`PROPS.book('RULES', 1)`) needs a `v: 'something'` in the state that changes when the prop changes, so the cut-out redraws.
Positions: people stand at y 0 (boardwalks y 0.18, on a counter y 1.26). Interior counter: x 2.2..3.2, clerk at x 3.55.

## 3. Shot anatomy (see `example/src/shots.js`)
Build every set once at the top, give each set its own cut-outs, then per shot: place people, `set()` their state from
`t`, `shoot(scene, people, camFrom, camTo, lookFrom, lookTo, k, LOOK)` (moves the camera, turns everyone to face it,
renders with depth of field), `blit()`, then any 2D overlay (a RETURN TO SENDER stamp). Cues go on the word
(`cue(Wd('banned', 17), 'stamp')`).
Keep shots strictly between 2.5 and 3.0 seconds, alternating Close-up Reaction → Wide Action → Prop Insert.

## 4. QA Pitfalls
- **Captions overlapping YouTube UI**: Verify captions render around Y=1250px, never down in Y=1450–1920.
- **Dead air**: Voiceover pauses must never exceed 0.15s; speech speed must be 1.1x.
- **Side sliver**: Keep camera within ~60° of facing people (`.face(cam)` handles the rest).
- **People inside furniture**: Check feet heights (boardwalk 0.18, counter top 1.18 + scale 0.08).
- **Shadow bounds**: Move `sun.key.target` near the action when you build a new set.
- **Rendering speed**: `SOFTWARE_GL=1 QS='&res=0.6&aa=0&shadow=1024' FPS=24` without a GPU, ≈2-3 s/frame.
