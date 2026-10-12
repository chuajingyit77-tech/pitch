# 栖境 · Idle Worlds

A 3D idle screen for office computers. Every computer gets its own living world that runs as a
screensaver, and anyone walking past can feed the residents.

| # | World | Inspired by | Residents | Food |
|---|---|---|---|---|
| 1 | 深蓝 · 珊瑚礁 | ABZÛ, Endless Ocean | clownfish, tangs, angelfish, turtles, schools | 鱼食 |
| 2 | 锦鲤 · 庭院池塘 | Sekiro, Ghost of Tsushima | koi in 11 varieties | 鱼食 |
| 3 | 芒原 · 狐与鸟居 | Ghost of Tsushima | foxes, white foxes | 油豆腐 |
| 4 | 晴岛 · 热带海岛 | Sea of Thieves, Animal Crossing | crabs, gulls, turtles, dolphins | 小鱼干 |
| 5 | 雨林 · 瀑布与萤火 | Ori, Horizon | tree frogs, macaws, morpho butterflies | 热带水果 |
| 6 | 云海 · 蟠桃仙境 | Kung Fu Panda, Chinese celestial paintings | tai-chi tortoise, cranes, blue spirit birds | 蟠桃 |

## What makes each computer's world its own

- On first launch the browser generates a world seed. Layout, rocks, coral, koi patterns and
  resident names all come from it, so no two computers look the same. It is stored in
  `localStorage` (key `qijing-v1`) together with resident growth and feeding counts.
- The computer's name is editable in the top-left corner and in Settings.
- Light follows the real local time: dawn, day, golden hour, dusk and night all differ.
  Settings can pin a manual time.

## Using it

- Click water or ground to feed. Space scatters a handful. Drag to look around, scroll to zoom.
- Keys `1`–`6` switch worlds, `F` fullscreen screensaver, `M` sound, `H` hide the HUD.
- After 8 seconds without input the HUD fades and the camera drifts: screensaver mode
  (30 fps power saving by default). Settings can rotate through the worlds every 10/30/60 minutes.
- Quality is automatic and never reloads the picture. The detail tier comes from the device (phones
  `low`, integrated GPUs `medium`, others `high`). Rendering resolution then adapts smoothly to how
  fast this computer actually draws, judged against the screen's own refresh rate. Each world
  remembers its level.

## Stability (no flashing)

The picture is kept steady on purpose:
- No reload or black fade ever happens except when you switch worlds yourself.
- Anti-aliasing (MSAA) is on every tier, including phones, and cut-out leaves and grass get smoothed edges.
- Before bloom, every frame is cleaned of NaN/Inf pixels and of extreme one-pixel highlights.
- Point lights have a small physical radius, so a lamp never burns a hot spot into a nearby surface.
- Exposure, bloom and grading ease toward each world's settings instead of jumping.
- The sun moves in one-minute steps, each glided over about two seconds. Shadow edges neither shimmer every
  frame nor jump. The key light fades out and back in at dusk and dawn rather than snapping from sun to moon.
- While someone is looking, the camera holds perfectly still; the gentle drift and bob only run in
  screensaver mode.
- There is no animated film grain, only a static dither.
- There is no backdrop blur over the 3D view, and no tap-highlight flash on phones.
- A lost GPU context (driver reset, phone memory pressure) shows a calm "restoring" message and
  rebuilds itself.
- Frames are capped at ~75 fps on 120/144 Hz screens and at 30 fps in screensaver mode.

## An always-on iPad (or any kiosk screen)

`play.html` is the same app as a stand-alone, full-screen page with no login. It works on iPadOS / iOS 15
and newer, so an iPad Air 2, iPad mini 4 or iPad 5th generation and anything later. It is served
straight from this public repository:

    https://raw.githack.com/chuajingyit77-tech/pitch/idle-worlds-3d/idle-world-3d/play.html

To set the iPad up:
1. Open the link in Safari. Tap Share, then "Add to Home Screen". The home-screen icon opens it full
   screen, without the address bar.
2. Settings → Display & Brightness → Auto-Lock → Never. Keep the iPad on its charger.
3. Optional: Settings → Accessibility → Guided Access (triple-click the side or Home button to start)
   keeps it locked to the world.

Older iPads and iPhones (iOS before 17) get a lighter "lite" tier automatically: fewer creatures and
plants, a smaller picture, and 30 fps. Every 15 minutes the page checks `version.json`. When a new build
has been pushed, it reloads by itself during screensaver mode, after saving the world.

If that host is ever unavailable, turn on GitHub Pages for the repository (Settings → Pages → branch
`idle-worlds-3d`, folder `/`). The page is then at
`https://chuajingyit77-tech.github.io/pitch/idle-world-3d/play.html`.

`play.html` and `version.json` are generated: after changing anything, run
`python3 idle-world-3d/tools/build_standalone.py`.

## Setting it up on several office computers

- Open the same link on every computer. Each browser keeps its own world, seed, residents and
  feeding history.
- To pin a computer to one world, add an anchor to the link: `#reef`, `#koi`, `#meadow`,
  `#island`, `#jungle` or `#cloudsea`.
- When leaving the desk, press `F` (or the fullscreen button). After 8 seconds the HUD fades and the
  world becomes a screensaver; anyone walking past can click to feed.
- For an always-on display, keep the page open in a full-screen or kiosk browser window, or set it
  as an interactive live wallpaper with a tool that accepts web pages (for example Lively Wallpaper
  on Windows). A classic OS screensaver closes on the first mouse movement, so feeding only works
  in a browser window or live wallpaper.

## Running locally

It is a static site. Serve the folder (any static server) and open `index.html`; three.js r160 is
loaded from jsDelivr through the import map. The page markup omits `<html>/<head>/<body>`
because the artifact host adds them; browsers handle that fine.

```
npx http-server idle-world-3d -p 8080
```

## Structure

- `app.js` — renderer, post-processing (MSAA scene pass with HDR sanitize, bloom, ACES/AgX, grading,
  vignette, dither, tilt-shift), dynamic resolution,
  camera rig, feeding input, residents, save data, idle mode, ambience, HUD.
- `lib/util.js` — seeded randomness, simplex noise, canvas textures, GLSL snippets, wind sway,
  solar time-of-day model.
- `lib/fish.js` — procedural fish: body/fin geometry, painted texture atlases with scale normals,
  koi varieties, a swim shader with travelling body waves, instancing and steering.
- `lib/audio.js` — synthesised ambience (waves, rain, wind, birds, insects, chimes, pads).
- `scenes/*.js` — one world per module. See `SCENES.md` for the authoring guide.

## Credits

- Fox: model by PixelMannen (CC0), rigging and animation by tomkranis (CC BY 4.0),
  glTF conversion by AsoboStudio and scurest (CC BY 4.0).
- Parrot, Flamingo, Stork: mirada / ro.me, from the three.js examples.
- Barramundi Fish: Microsoft (CC0).
- Water normal maps: three.js examples.
- three.js (MIT). Everything else — fish, plants, terrain, sky, sound — is procedural.
