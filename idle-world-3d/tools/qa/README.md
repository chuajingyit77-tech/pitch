# QA tools for 栖境

These tools check every change the same way before it is pushed (see `/CLAUDE.md`). They run the real page
in headless Chromium. The GPU is software (SwiftShader), so expect about 0.1–1 fps and a minute or more per
world.

## Setup (once per machine)

    npm install --prefix idle-world-3d/tools/qa        # three@0.160.0, served in place of the jsDelivr CDN
    export NODE_PATH=$(npm root -g)                    # playwright is used from the global install

## Before every push

    idle-world-3d/tools/qa/check_ipad.sh <outdir>       # all six worlds; or name some: ... <outdir> koi reef

It first checks the syntax of every app file (`syncheck.sh`; plain `node --check` silently passes ES modules), then runs five checks:
1. **The iPad emulation**: Safari 14 on an iPad Air 3, iOS 14.8, WebGL 1, 1112×834 at 2×. Each world loads,
   is fed, and gets a screenshot. It must show zero shader or page errors. Look at the screenshots.
2. **Flicker and NaN** on the iPad's own path (`GL1=1`: WebGL 1, no MSAA) and on WebGL 2, low tier, at noon
   and at night. `flickerPermille` must stay well under 1, with no NaN. The WebGL 1 path matters most: without
   MSAA and with three's sRGB handling it shimmered several times more than WebGL 2. The probe stops the page's
   own animation loop and steps the world itself, so a run repeats exactly and two builds can be compared number
   for number.
3. **The motion probe**. It looks for snaps, jumps (teleports), bodies not following their path, and
   motion that differs between 30 and 60 fps. It also steps the world itself, so both runs start from the same
   state and differ only in their time step. The 30/60 comparison uses mean speed and turn rate over the time
   before the feeding: after it, which fish wins which pellet turns on a single step and the runs part ways.
   Creatures that roll dice during play need their own random streams (`rng.fork(...)`); on the shared
   `Math.random` their choices depend on what else drew that frame, and so on the frame rate.
4. **Skinning parity**. Bone-animated creatures must have the same pose in WebGL 1 as in WebGL 2
   (IoU 1.000).
5. **View windows**. The meadow draws only the part of its field that can be in view; every test view must
   render pixel for pixel the same as the whole field (`cullcheck.cjs`).
6. **The guardians' lessons** (`lesson.cjs`), on the iPad and on a phone held upright: a whole lesson played
   through. It must end `PASS` with no console problems. Look at the screenshots.

## Long runs, the clock of day and the GPU

The iPad stays on one world all day, following the real clock. Run these after changes to anything that lives for
hours (timers, schedules, pools of creatures), to the time of day or lighting, or to what a world draws:

- **Soak** (`soak.cjs`): hours of play in time-lapse with feeding, sampling NaN, flicker, renderer memory, heap and
  page errors. Run each world from dawn and from evening (`--start 4.5`, `--start 16.5`, `--hours 6`); every world
  must end `steady`. It found the island whale's stack overflow, which needed 15-30 minutes of play to show.
- **Day sweep** (`daysweep.cjs`): the whole day in 2-minute steps, walked twice at different paces of the world's
  own time; a jump of light (a lamp switching, an environment map swapped in a step) shows at the same hour, in the
  same region and the same way, in both walks, while a creature passing or a glow breathing does not. Check what it
  finds with the light ramp, in real time: the koi pond's busy nights still raise a few coincidences.
- **Light ramp** (`lightramp.cjs`): a few minutes of dawn or dusk in real time, through the page's own clock (a
  stand-in `Date`), at 30 fps. `tick share` is the part of each minute's change of light that lands in the 3 s after
  the minute turns: about 1 when the clock stepped once a minute (each step a 2-3 s pulse: koi at 18:24, 1.03), an
  even ramp gives 0.05 plus the noise of moving creatures (koi now 0.14-0.4). The CSV shows the clock itself; with
  `--shots s1,s2` it saves frames, with `--every 1 --fps 60` it also counts shimmering pixels.
- **GPU cost** (`gpucost.cjs`): what the A12 has to shade in the default view. Opaque surfaces cost one fragment per
  visible pixel there (the GPU hides opaque overdraw); every cut-out or blended fragment in front of them costs in
  full. Lists the costliest objects with a rough weight for their shaders and writes an overdraw heat map.

## Single tools

Run each tool with `node idle-world-3d/tools/qa/<tool>`. Each file's header lists its options.

| tool | what it does |
|---|---|
| `ios14.cjs <out> [worlds]` | iPad / Safari 14 emulation of `play.html`. With `FEED=1` it also feeds each world. |
| `ipadshot.cjs <out.png> <world> [hour] [dpr]` | One iPad screenshot at a fixed hour and seed, plus the frame's draw cost. `VIEW='{"dist":0}'` is the closest zoom; `dpr 0.734` emulates the old 0.5 MP picture. |
| `flicker.cjs <out> world:hour …` | NaN/Inf, brightest pixel and temporal flicker heatmaps. Env: `GL1=1` (iPad path), `Q`, `VW`/`VH`, `VIEW`, `EVAL` (page code run once each world is up, e.g. `__idle.current.inst.debugGiant(0)`). |
| `motion.cjs <out> <world>` | Per-mover motion statistics, compared at 60 and 30 fps. Env `EVAL` as above, run before each run. |
| `skin_parity.cjs <out> [worlds]` | Silhouettes of skinned creatures in WebGL 1 vs WebGL 2. |
| `cullcheck.cjs [world] [--gl2 1]` | Fields drawn only where they can be in view (the meadow's susuki): every view rendered with and without the view window must match pixel for pixel, at calm, in a storm and with grass pressed just outside the view. Prints the triangles saved. |
| `closeup.cjs <out> <world>` | iPad close-ups of fish (or `--name obj`), `--gl2 1` for the WebGL 2 A/B. |
| `syncheck.sh` | Syntax of every app file as an ES module. |
| `shoot.cjs --scene <id> …` | Desktop screenshot. Options include hours, view, feed, quality and UI. |
| `phone.cjs …` | Same as `shoot.cjs`, emulating an iPhone 13. |
| `tour.cjs <out>` | Visits every world in one page, testing switching and dispose. |
| `nanhunt.cjs <out> world:hour …` | Finds which objects produce NaN pixels. |
| `thumbs.cjs world:hour …` | Re-renders the dock thumbnails in `assets/thumbs`. |
| `lesson.cjs <out> [--phone]` | Plays a guardian's lesson through in the iPad emulation (or on a phone held upright): screenshots of the board, the guardian flying in, the close-up, a wrong and a right answer, the key-point card, the completion with the new resident, the marker, the guardian's own menu and a lesson put down halfway. Checks the saved progress, stars, badge and new resident, and that there were no errors. |
| `portrait.cjs [--world koi] [--id heron]` | Renders a guardian's portrait for the lessons board (`assets/guardians/<id>.jpg`). |
| `soak.cjs <out> <world> [--hours 3] [--start 5.5] [--every 10]` | Hours of play in time-lapse: NaN, flicker, memory, heap, errors over time. `--t0` starts the world clock days in. |
| `daysweep.cjs <out> <world> [--from 0] [--to 24] [--step 2]` | The day in steps, walked twice: brightness of the screen and 12 regions per step, and the jumps that come from the clock. `--from-json <world>_sweep.json` looks again at a saved sweep. |
| `lightramp.cjs <out> <world> [--at 18:20] [--minutes 3]` | Real-time light through the page's own clock: how each minute's change of light is spread, peak change per second, shimmer (`--every 1`). |
| `gpucost.cjs <out> world:hour …` | iPad GPU cost map: pixels per opaque object, fragments per cut-out or blended object, shader weights, overdraw heat map. |

After changing anything, rebuild the stand-alone page with `python3 idle-world-3d/tools/build_standalone.py`.
That regenerates `play.html` and `version.json`; a running iPad then reloads itself onto the new build.
