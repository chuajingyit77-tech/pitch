#!/bin/bash
# The checks to run before every push (see /CLAUDE.md). Usage: tools/qa/check_ipad.sh [outdir] [worlds...]
# Needs: playwright (global, NODE_PATH below) and `npm install --prefix tools/qa` once for three@0.160.0.
set -u
QA="$(cd "$(dirname "$0")" && pwd)"
OUT="${1:-$PWD/qa-out}"; shift || true
WORLDS="${*:-reef koi meadow island jungle cloudsea}"
export NODE_PATH="$(npm root -g)"
mkdir -p "$OUT"
echo "== 0. Syntax (every app .js file as an ES module)"
"$QA/syncheck.sh" || exit 1
echo "== 1. Safari 14 / WebGL 1 iPad emulation: load + feed every world (shader errors, page errors, screenshots)"
FEED=1 timeout 3600 node "$QA/ios14.cjs" "$OUT/ios14" $WORLDS
echo "== 2. Flicker / NaN on the iPad's own path (WebGL 1, low tier) and on WebGL 2, noon and night"
JOBS=""; for w in $WORLDS; do JOBS="$JOBS $w:12 $w:21"; done
GL1=1 Q=low VW=480 VH=270 timeout 5400 node "$QA/flicker.cjs" "$OUT/flicker_gl1" $JOBS
Q=low VW=480 VH=270 timeout 5400 node "$QA/flicker.cjs" "$OUT/flicker_low" $JOBS
echo "== 3. Motion: snaps, jumps, misalignment, 30 vs 60 fps"
for w in $WORLDS; do timeout 1500 node "$QA/motion.cjs" "$OUT/motion" "$w" --fps 60,30 --secs 20 --feed 8 | grep -E "^==|frame-rate"; done
echo "== 4. Skinned creatures: WebGL 1 pose = WebGL 2 pose"
timeout 2400 node "$QA/skin_parity.cjs" "$OUT/parity" meadow cloudsea
echo "done: $OUT"
