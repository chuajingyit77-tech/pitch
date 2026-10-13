// 芒原 · gentle giants: when they pass, and where.
//
// The first pass starts 20–45 s after the world opens, then one every 3–5 minutes (seeded jitter). By night it is
// the nine-tailed spirit fox, by day (from first light to dusk) the sika herd. Every route enters and leaves out of
// view (beyond the frame, behind a maple, or dissolving deep in the mist) and crosses the default view; the passes
// take turns: near and far, left to right and right to left. Between passes nothing is drawn or updated.
import * as THREE from 'three';
import { clamp, makeRng } from '../../lib/util.js';
import { SpiritFox } from './spirit.js';
import { DeerHerd } from './deer.js';

/** Push route points clear of every prop, then nudge the ones whose curve still passes too close. */
function clearRoute(pts, obstacles, margin) {
  for (let pass = 0; pass < 8; pass++) {
    for (const p of pts) for (const o of obstacles) {
      const dx = p.x - o.x, dz = p.z - o.z, d = Math.hypot(dx, dz), R = o.r + margin + 0.6;
      if (d < R) { const k = d > 1e-4 ? R / d : 0; if (k) { p.x = o.x + dx * k; p.z = o.z + dz * k; } else p.x += R; }
    }
    const curve = new THREE.CatmullRomCurve3(pts.map(p => new THREE.Vector3(p.x, 0, p.z)), false, 'centripetal');
    const S = curve.getSpacedPoints(Math.max(40, Math.round(curve.getLength() * 2)));
    let worst = null, wd = 0;
    for (let i = 0; i < S.length; i++) for (const o of obstacles) {
      const pen = o.r + margin - Math.hypot(S[i].x - o.x, S[i].z - o.z);
      if (pen > wd) { wd = pen; worst = { i: i / (S.length - 1), o }; }
    }
    if (!worst) break;
    // move the control point nearest that stretch away from the prop
    const k = Math.round(worst.i * (pts.length - 1));
    const p = pts[clamp(k, 1, pts.length - 2)];
    const dx = p.x - worst.o.x, dz = p.z - worst.o.z, d = Math.hypot(dx, dz) || 1;
    p.x += dx / d * (wd + 0.5); p.z += dz / d * (wd + 0.5);
  }
  return pts;
}

export class Giants {
  /**
   * opts: { env, scene, heightAt, fogU, seed, obstacles, target (Vector3), shrine (Vector3), knoll {x, z} }
   */
  constructor(o) {
    this.o = o;
    this.rng = makeRng(o.seed ^ 0x61a2);
    this.fox = new SpiritFox({ env: o.env, scene: o.scene, heightAt: o.heightAt, fogU: o.fogU, seed: o.seed });
    this.herd = new DeerHerd({ env: o.env, scene: o.scene, heightAt: o.heightAt, fogU: o.fogU, seed: o.seed, obstacles: o.obstacles });
    this.clock = 0;
    this.next = this.rng.range(20, 45);
    this.kind = null;
    this.passN = { fox: 0, deer: 0 };
    this.foxOrder = this.rng.shuffle(['nearR', 'far', 'midL', 'nearR', 'midL', 'far']);
    this.deerFlip = this.rng.chance(0.5);
    this.toriiLook = new THREE.Vector3(0, 1.6, 0.3);
    this.shrineLook = new THREE.Vector3(o.shrine.x, o.shrine.y + 0.9, o.shrine.z + 0.4);
  }
  get active() { return this.kind !== null; }

  /* ---------------- routes ---------------- */
  foxRoute(name, reverse) {
    const r = this.rng, K = this.o.knoll;
    let pts, pause, look;
    if (name === 'nearR') {
      // in from the right edge, along the near field, a long look at the torii, then away past the shrine
      pts = [[24, 8.5], [15, 5.0], [10.2, 2.6], [6.6 + r.range(-0.4, 0.4), 1.0], [5.0, -3.0], [3.9, -9.0], [3.6, -16], [5.0, -24]];
      pause = 3; look = this.toriiLook;
    } else if (name === 'midL') {
      // from beyond the left maple, behind it, a look over its shoulder at the shrine, then off to the right
      pts = [[-26, 2], [-17, -3], [-10.5, -7.5], [-5.5 + r.range(-0.5, 0.5), -9.6], [0.5, -13], [5.5, -19], [9, -27]];
      pause = 3; look = this.shrineLook;
    } else {
      // far: across the knoll, stopping on its crest to look back toward the torii
      pts = [[-30, K.z + 8], [-18, K.z + 3], [-7, K.z + 0.5], [K.x - 1.5, K.z], [K.x + 9, K.z - 1], [K.x + 19, K.z + 2], [K.x + 30, K.z + 8]];
      pause = 3; look = this.toriiLook;
    }
    pts = pts.map(([x, z]) => ({ x: x + r.range(-0.6, 0.6), z: z + r.range(-0.6, 0.6) }));
    if (reverse) { pts.reverse(); pause = pts.length - 1 - pause; }
    clearRoute(pts, this.o.obstacles, 1.1);
    return { pts, pause, look, speed: r.range(0.85, 1.0), pauseFor: r.range(7, 10) };
  }
  deerRoute(flip) {
    const r = this.rng, K = this.o.knoll;
    const dz = r.range(-1.8, 1.8);
    let pts = [[K.x + 22, K.z + 3], [K.x + 12, K.z + 1.6], [K.x + 1, K.z + 0.2], [K.x - 7, K.z - 0.6], [K.x - 16, K.z - 1.4], [K.x - 26, K.z - 2.5]]
      .map(([x, z]) => ({ x: x + r.range(-0.5, 0.5), z: z + dz + r.range(-0.5, 0.5) }));
    let graze = 2;
    if (flip) { pts.reverse(); graze = pts.length - 1 - graze; }
    clearRoute(pts, this.o.obstacles, 1.6);
    return { pts, graze, grazeFor: r.range(22, 32), speed: r.range(0.75, 0.85) };
  }

  /* ---------------- schedule ---------------- */
  start(kind, el) {
    kind = kind || (el < -3 ? 'fox' : 'deer');
    if (kind === 'fox') {
      const n = this.passN.fox++;
      const name = this.foxOrder[n % this.foxOrder.length];
      this.fox.begin(this.foxRoute(name, (n + (this.o.seed & 1)) % 2 === 1));
    } else {
      const n = this.passN.deer++;
      this.herd.begin(this.deerRoute((n % 2 === 1) !== this.deerFlip));
    }
    this.kind = kind;
  }
  /** ctx: { night, el, pr, pxK, wind (Vector2), rim (Color) } */
  update(dt, t, ctx) {
    this.clock += dt;
    if (!this.kind && this.clock >= this.next) {
      this.start(null, ctx.el);
      this.next = this.clock + this.rng.range(180, 300);
    }
    if (this.kind === 'fox' && !this.fox.update(dt, t, ctx)) this.kind = null;
    else if (this.kind === 'deer' && !this.herd.update(dt, t, ctx)) this.kind = null;
    this.fox.idle(dt, ctx);
  }
  /** Test hook: start a pass now (by the hour, or `kind`) and run it `secs` seconds on. */
  debug(kind, secs, ctx) {
    if (this.kind === 'fox') this.fox.end(); else if (this.kind === 'deer') this.herd.end();
    this.kind = null;
    this.start(kind, ctx.el);
    const step = 1 / 30;
    for (let s = 0; s < secs && this.kind; s += step) {
      if (this.kind === 'fox' && !this.fox.update(step, this.clock + s, ctx)) this.kind = null;
      else if (this.kind === 'deer' && !this.herd.update(step, this.clock + s, ctx)) this.kind = null;
    }
    this.next = this.clock + this.rng.range(180, 300);
    return this.kind;
  }
  onFood(p) { if (this.kind === 'deer') this.herd.startle(p); }
  /** Name tags for the shell's hover labels. */
  tags(out) {
    if (this.kind === 'fox' && this.fox.dis < 0.6) out.push({ label: '九尾狐', pos: this.fox.labelPos, radius: 1.2 });
    if (this.kind === 'deer') for (const d of this.herd.deer) out.push({ label: d.kind === 0 ? '梅花鹿 · 雄' : '梅花鹿', pos: d.labelPos, radius: 0.6 });
    return out;
  }
  dispose() { this.fox.dispose(); this.herd.dispose(); }
}
