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
| 6 | 云海 · 光之鳐 | Sky: Children of the Light, Journey | light mantas, sky jellies, light spirits | 星光 |

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
- Quality is automatic: it drops a level if the first seconds run below ~38 fps.

To run it full-screen on a desk all day, open the page in a kiosk browser window, or load the
URL in a live-wallpaper tool that accepts web pages (for example Lively Wallpaper on Windows,
or a WebView screensaver on macOS).

## Running locally

It is a static site. Serve the folder (any static server) and open `index.html`; three.js r160 is
loaded from jsDelivr through the import map. The page markup omits `<html>/<head>/<body>`
because the artifact host adds them; browsers handle that fine.

```
npx http-server idle-world-3d -p 8080
```

## Structure

- `app.js` — renderer, post-processing (bloom, ACES/AgX, grading, vignette, grain, tilt-shift),
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
- Water normal maps and the sunset HDRI: three.js examples (HDRI by Poly Haven, CC0).
- three.js (MIT). Everything else — fish, plants, terrain, sky, sound — is procedural.
