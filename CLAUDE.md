# Standing requirements from the owner (栖境 · idle-world-3d)

The owner writes in Chinese — reply in Chinese. They have said these once and do not want to say them again.

## The device that matters most
- An old **iPad Air 3 on iOS 14.8** (Safari 14, WebGL 1 only, A12 GPU). It stays on all day as a decorative
  screen, opened from its home-screen icon (`idle-world-3d/play.html` through the githack link in
  `idle-world-3d/README.md`). Never ask them to update iOS or install anything.
- Everything must run smoothly there (60 fps is the target) and look its best there. Phones and office PCs
  must work just as well.

## Quality bar
- Do the job fully, and to the best technical standard, the first time. The owner judges the finished
  result, not the effort, and half-finished work must never reach them.
- Fish, flowers, leaves and creatures must look refined up close:
  - no jaggies, dark fringes or pixel noise;
  - nothing flat or toy-like.
- Creatures must move naturally: no sliding, snapping, lockstep, or motion that changes with frame rate.
- No flicker or flashing of any kind.

## Before every push
- Check every world in the Safari 14 / WebGL 1 iPad emulation:
  - zero shader errors;
  - it loads, and feeding works;
  - the screenshots look right.
- Also run the low-tier flicker probe and the motion probe. The test tools and how to run them are in
  `idle-world-3d/tools/qa/`.
- Rebuild `play.html` and `version.json` with `python3 idle-world-3d/tools/build_standalone.py`. A running
  iPad then reloads itself onto the new build.
- Work on branch `idle-worlds-3d`. Commit and push only complete, tested work.
- When the owner asks how it is going, show screenshots from the iPad emulation.
