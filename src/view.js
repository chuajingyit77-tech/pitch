// The world: eleven floating isles in a nebula sky, drawn in isometric projection.
// Buildings are real little structures — spires, domes, tiered pagodas — and every
// citizen is a small luminous figure standing on the ground.

import { GUILDS, BUILDINGS } from './data.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
const VIEW_W = 1440;
const VIEW_H = 880;
const CENTER = { x: 720, y: 406 };

const clamp01 = (v) => Math.min(1, Math.max(0, v));
const el = (name, attrs = {}, kids = []) => {
  const n = document.createElementNS(SVG_NS, name);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
  for (const k of kids) n.appendChild(k);
  return n;
};
const poly = (pts, attrs) => el('polygon', { points: pts.map((p) => p.join(',')).join(' '), ...attrs });
const lerp = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];

// Each guild builds in its own manner.
const ARCHITECTURE = {
  aether:    { roof: 'spire',  wall: '#2b3f63', h: 46 },
  verdant:   { roof: 'terrace', wall: '#2c4a44', h: 32 },
  forge:     { roof: 'gable',  wall: '#4a3a3a', h: 34 },
  lattice:   { roof: 'flat',   wall: '#263a56', h: 40 },
  mender:    { roof: 'dome',   wall: '#43334a', h: 30 },
  ledger:    { roof: 'pagoda', wall: '#4a4034', h: 34 },
  wayfinder: { roof: 'arch',   wall: '#2f3a5c', h: 38 },
  keystone:  { roof: 'gable',  wall: '#35395e', h: 36 },
  lumen:     { roof: 'dome',   wall: '#26454e', h: 34 },
  chorus:    { roof: 'pagoda', wall: '#4a3550', h: 32 },
  hearth:    { roof: 'pagoda', wall: '#4a4038', h: 40 },
};

// The campus sits at the centre; the ten guild isles ring it.
const RING = { rx: 505, ry: 206 };

export function computeGeometry() {
  const isles = [];
  const others = GUILDS.filter((g) => g.id !== 'hearth');
  others.forEach((guild, i) => {
    const a = -Math.PI / 2 + (i / others.length) * Math.PI * 2;
    const cx = CENTER.x + Math.cos(a) * RING.rx;
    const cy = CENTER.y + Math.sin(a) * RING.ry;
    const depth = clamp01((Math.sin(a) + 1) / 2);        // nearer isles sit lower and read larger
    const s = 0.82 + depth * 0.26;
    isles.push({
      guild, cx, cy,
      rx: 152 * s, ry: 76 * s, scale: s,
      plate: `ISLE ${String(i + 1).padStart(2, '0')}`,
      yard: { u0: -0.72, u1: 0.72, v0: 0.28, v1: 0.86, cols: 5 },
    });
  });
  const campus = {
    guild: GUILDS.find((g) => g.id === 'hearth'),
    cx: CENTER.x, cy: CENTER.y + 18,
    rx: 272, ry: 136, scale: 1.2, isCampus: true,
    plate: 'THE CAMPUS',
    yard: { u0: -0.78, u1: 0.78, v0: 0.16, v1: 0.9, cols: 11 },
  };
  isles.push(campus);

  // Buildings stand in a row across the upper half of their isle.
  const buildings = {};
  for (const isle of isles) {
    const list = BUILDINGS.filter((b) => b.guild === isle.guild.id);
    const n = list.length;
    list.forEach((b, j) => {
      const spread = isle.isCampus ? 0.5 : 0.42;
      const t = n === 1 ? 0 : -spread + (j / (n - 1)) * spread * 2;
      const back = (isle.isCampus ? -0.3 : -0.26) + (j % 2) * 0.07;
      const u = t + back;
      const v = -t + back;
      const arch = ARCHITECTURE[isle.guild.id];
      buildings[b.id] = {
        building: b, isle, u, v,
        du: isle.isCampus ? 0.115 : 0.15,
        dv: isle.isCampus ? 0.115 : 0.15,
        h: (arch.h + (b.id === 'academy' ? 16 : 0)) * isle.scale * 0.82,
        arch,
        labelDrop: (j % 2) * 26,
        tint: isle.guild.color,
      };
    });
  }
  return { isles, buildings };
}

const project = (isle, u, v, lift = 0) => [
  isle.cx + (u - v) * isle.rx * 0.5,
  isle.cy + (u + v) * isle.ry * 0.5 - lift,
];

/* ---------------------------------------------------------------- defs */

function defs() {
  const d = el('defs');
  d.innerHTML = `
    <radialGradient id="isleTop" cx="42%" cy="34%" r="72%">
      <stop offset="0%" stop-color="#2f5e63" />
      <stop offset="55%" stop-color="#22454f" />
      <stop offset="100%" stop-color="#152c3b" />
    </radialGradient>
    <linearGradient id="isleRock" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#1b3040" />
      <stop offset="60%" stop-color="#101d2e" />
      <stop offset="100%" stop-color="#080e1c" stop-opacity="0.2" />
    </linearGradient>
    <linearGradient id="fall" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#8fe9ff" stop-opacity="0.5" />
      <stop offset="100%" stop-color="#8fe9ff" stop-opacity="0" />
    </linearGradient>
    <linearGradient id="bridge" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%" stop-color="#9df3d8" stop-opacity="0.05" />
      <stop offset="50%" stop-color="#9df3d8" stop-opacity="0.5" />
      <stop offset="100%" stop-color="#ffd79a" stop-opacity="0.28" />
    </linearGradient>
    <filter id="glow" x="-70%" y="-70%" width="240%" height="240%">
      <feGaussianBlur stdDeviation="3.4" result="b" />
      <feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
    </filter>
    <filter id="softglow" x="-90%" y="-90%" width="280%" height="280%">
      <feGaussianBlur stdDeviation="7" />
    </filter>`;
  return d;
}

/* ---------------------------------------------------------------- isles */

function drawIsle(isle) {
  const g = el('g', { class: 'isle', 'data-guild': isle.guild.id });
  const { cx, cy, rx, ry } = isle;
  const N = [cx, cy - ry / 2 * 1], E = [cx + rx / 2 * 1, cy], S = [cx, cy + ry / 2], W = [cx - rx / 2, cy];
  const top = [[cx, cy - ry], [cx + rx, cy], [cx, cy + ry], [cx - rx, cy]];

  // aura beneath the isle
  g.appendChild(el('ellipse', {
    cx, cy: cy + ry * 0.5, rx: rx * 1.15, ry: ry * 0.95,
    fill: isle.guild.color, opacity: 0.1, filter: 'url(#softglow)',
  }));

  // the rock underside, tapering to a point
  const depth = ry * (isle.isCampus ? 2.5 : 2.1);
  const rock = `M ${cx - rx} ${cy} L ${cx - rx * 0.55} ${cy + ry * 0.72}
    L ${cx - rx * 0.2} ${cy + depth * 0.62} L ${cx} ${cy + depth}
    L ${cx + rx * 0.26} ${cy + depth * 0.55} L ${cx + rx * 0.6} ${cy + ry * 0.68}
    L ${cx + rx} ${cy} L ${cx} ${cy + ry} Z`;
  g.appendChild(el('path', { d: rock, fill: 'url(#isleRock)' }));

  // ground
  g.appendChild(poly(top, { fill: 'url(#isleTop)', stroke: isle.guild.color, 'stroke-opacity': 0.32 }));
  g.appendChild(poly(top, { fill: 'none', stroke: isle.guild.color, 'stroke-opacity': 0.5, 'stroke-width': 1.2, filter: 'url(#glow)', class: 'isle-rim' }));

  // a light stream falling from the underside
  g.appendChild(el('path', {
    d: `M ${cx - rx * 0.1} ${cy + depth * 0.7} L ${cx + rx * 0.06} ${cy + depth * 0.7} L ${cx + rx * 0.02} ${cy + depth * 2.1} L ${cx - rx * 0.04} ${cy + depth * 2.1} Z`,
    fill: 'url(#fall)', class: 'fall',
  }));

  if (isle.isCampus) {
    const [px, py] = project(isle, 0, 0.42);
    g.appendChild(el('ellipse', { cx: px, cy: py, rx: rx * 0.34, ry: ry * 0.34, fill: '#7ef0c8', opacity: 0.07 }));
    g.appendChild(el('ellipse', {
      cx: px, cy: py, rx: rx * 0.34, ry: ry * 0.34, fill: 'none',
      stroke: '#ffd79a', 'stroke-opacity': 0.4, 'stroke-dasharray': '4 9', class: 'plaza',
    }));
    g.appendChild(el('ellipse', { cx: px, cy: py, rx: rx * 0.17, ry: ry * 0.17, fill: 'none', stroke: '#7ef0c8', 'stroke-opacity': 0.32 }));
  }

  // ground detailing: a path across the isle and a few stones
  g.appendChild(el('path', {
    d: `M ${project(isle, -0.8, 0.1)} L ${project(isle, 0.8, 0.1)}`.replace(/,/g, ' '),
    stroke: '#7fe3d0', 'stroke-opacity': 0.14, 'stroke-width': 2 * isle.scale, fill: 'none',
  }));

  g.appendChild(el('text', {
    x: cx, y: cy + ry + 20 * isle.scale, class: 'isle-label', 'text-anchor': 'middle',
  })).textContent = isle.guild.name.replace(' Guild', '').toUpperCase();
  return g;
}

/* ------------------------------------------------------------ buildings */

function windowsOn(face, h, cols, tint) {
  // face = [bottomLeft, bottomRight]; windows are parallelograms lifted off the ground
  const out = [];
  for (let i = 0; i < cols; i++) {
    const t0 = 0.16 + (i * 0.72) / cols;
    const t1 = t0 + 0.36 / cols;
    for (const [y0, y1] of [[0.3, 0.56], [0.64, 0.86]]) {
      const a = lerp(face[0], face[1], t0);
      const b = lerp(face[0], face[1], t1);
      out.push(poly(
        [[a[0], a[1] - h * y0], [b[0], b[1] - h * y0], [b[0], b[1] - h * y1], [a[0], a[1] - h * y1]],
        { fill: tint, opacity: 0.75, class: 'win' },
      ));
    }
  }
  return out;
}

function roofOf(kind, top, cx, cyTop, w, tint, scale) {
  const parts = [];
  const rh = w * 0.55;
  const apex = [cx, cyTop - rh];
  const [a, b, c, d] = top;                        // back, right, front, left

  if (kind === 'spire') {
    parts.push(poly([a, b, apex], { fill: tint, opacity: 0.5 }));
    parts.push(poly([b, c, apex], { fill: tint, opacity: 0.78 }));
    parts.push(poly([c, d, apex], { fill: tint, opacity: 0.62 }));
    parts.push(el('line', { x1: cx, y1: cyTop - rh, x2: cx, y2: cyTop - rh * 2.5, stroke: tint, 'stroke-width': 2 * scale, filter: 'url(#glow)' }));
    parts.push(el('circle', { cx, cy: cyTop - rh * 2.7, r: 4 * scale, fill: '#ffffff', filter: 'url(#glow)', class: 'beacon' }));
  } else if (kind === 'dome') {
    const r = w * 0.62;
    parts.push(el('path', {
      d: `M ${cx - r} ${cyTop} A ${r} ${r * 1.15} 0 0 1 ${cx + r} ${cyTop} Z`,
      fill: tint, opacity: 0.72,
    }));
    parts.push(el('path', {
      d: `M ${cx - r * 0.5} ${cyTop - r * 0.5} A ${r * 0.6} ${r * 0.7} 0 0 1 ${cx + r * 0.1} ${cyTop - r * 0.86}`,
      stroke: '#ffffff', 'stroke-opacity': 0.35, fill: 'none', 'stroke-width': 1.4,
    }));
    parts.push(el('circle', { cx, cy: cyTop - r * 1.16, r: 3 * scale, fill: '#fff3d0', filter: 'url(#glow)', class: 'beacon' }));
  } else if (kind === 'pagoda') {
    for (let tier = 0; tier < 3; tier++) {
      const k = 1 - tier * 0.26;
      const lift = tier * rh * 0.52;
      const eave = top.map((p) => [cx + (p[0] - cx) * (k + 0.22), cyTop - lift + (p[1] - cyTop) * (k + 0.22)]);
      const peak = [cx, cyTop - lift - rh * 0.5 * k];
      parts.push(poly([eave[0], eave[1], peak], { fill: tint, opacity: 0.45 }));
      parts.push(poly([eave[1], eave[2], peak], { fill: tint, opacity: 0.8 }));
      parts.push(poly([eave[2], eave[3], peak], { fill: tint, opacity: 0.6 }));
    }
    parts.push(el('circle', { cx, cy: cyTop - rh * 1.7, r: 3.4 * scale, fill: '#ffe6ac', filter: 'url(#glow)', class: 'beacon' }));
  } else if (kind === 'gable') {
    const ridgeA = [(a[0] + d[0]) / 2, (a[1] + d[1]) / 2 - rh * 0.8];
    const ridgeB = [(b[0] + c[0]) / 2, (b[1] + c[1]) / 2 - rh * 0.8];
    parts.push(poly([d, c, ridgeB, ridgeA], { fill: tint, opacity: 0.72 }));
    parts.push(poly([a, b, ridgeB, ridgeA], { fill: tint, opacity: 0.42 }));
    parts.push(el('line', { x1: ridgeA[0], y1: ridgeA[1], x2: ridgeB[0], y2: ridgeB[1], stroke: '#ffffff', 'stroke-opacity': 0.25 }));
  } else if (kind === 'terrace') {
    parts.push(poly(top, { fill: tint, opacity: 0.5 }));
    for (let i = 0; i < 3; i++) {
      const p = lerp(lerp(d, c, 0.2 + i * 0.3), lerp(a, b, 0.2 + i * 0.3), 0.4);
      parts.push(el('circle', { cx: p[0], cy: p[1] - 4, r: 4.5 * scale, fill: tint, opacity: 0.9 }));
    }
  } else if (kind === 'arch') {
    parts.push(poly(top, { fill: tint, opacity: 0.42 }));
    for (let i = 0; i < 2; i++) {
      parts.push(el('ellipse', {
        cx, cy: cyTop - rh * (0.5 + i * 0.55), rx: w * (0.7 - i * 0.18), ry: w * 0.22,
        fill: 'none', stroke: tint, 'stroke-width': 1.6, opacity: 0.85, class: 'ring',
      }));
    }
  } else {
    // flat roof with a mast
    parts.push(poly(top, { fill: tint, opacity: 0.34 }));
    parts.push(poly(top.map((p) => [cx + (p[0] - cx) * 0.62, cyTop + (p[1] - cyTop) * 0.62]), { fill: tint, opacity: 0.5 }));
    parts.push(el('line', { x1: cx, y1: cyTop, x2: cx, y2: cyTop - rh * 1.5, stroke: tint, 'stroke-width': 1.6, opacity: 0.9 }));
    parts.push(el('circle', { cx, cy: cyTop - rh * 1.5, r: 2.6 * scale, fill: '#bff6ff', filter: 'url(#glow)', class: 'beacon' }));
  }
  return parts;
}

function drawBuilding(id, spec) {
  const { isle, u, v, du, dv, h, arch, tint, building } = spec;
  const g = el('g', { class: 'build', 'data-building': id, tabindex: '0' });
  const base = [[u - du, v - dv], [u + du, v - dv], [u + du, v + dv], [u - du, v + dv]]
    .map(([U, V]) => project(isle, U, V));
  const top = base.map((p) => [p[0], p[1] - h]);
  const w = (base[1][0] - base[3][0]) * 0.5;

  // shadow on the ground
  g.appendChild(el('ellipse', {
    cx: (base[0][0] + base[2][0]) / 2, cy: (base[0][1] + base[2][1]) / 2 + 3,
    rx: Math.abs(w) * 1.15, ry: Math.abs(w) * 0.5, fill: '#04070f', opacity: 0.35,
  }));

  // walls: the two faces that meet at the near corner
  g.appendChild(poly([base[3], base[2], top[2], top[3]], { fill: arch.wall, class: 'wall-l' }));
  g.appendChild(poly([base[2], base[1], top[1], top[2]], { fill: arch.wall, class: 'wall-r' }));
  for (const win of windowsOn([base[3], base[2]], h, 2, tint)) g.appendChild(win);
  for (const win of windowsOn([base[2], base[1]], h, 2, tint)) g.appendChild(win);

  // a lit doorway on the near corner
  const door = lerp(base[3], base[2], 0.5);
  g.appendChild(poly(
    [[door[0] - 3, door[1]], [door[0] + 3, door[1] + 1.5], [door[0] + 3, door[1] - h * 0.3], [door[0] - 3, door[1] - h * 0.3 - 1.5]],
    { fill: '#ffdca6', opacity: 0.9, filter: 'url(#glow)' },
  ));

  const cx = (top[1][0] + top[3][0]) / 2;
  const cyTop = (top[0][1] + top[2][1]) / 2;
  if (id === 'academy') {
    g.appendChild(el('path', {
      d: `M ${cx - 14} ${cyTop} L ${cx + 14} ${cyTop} L ${cx + 5} ${cyTop - 190} L ${cx - 5} ${cyTop - 190} Z`,
      fill: 'url(#fall)', opacity: 0.5, class: 'fall',
    }));
  }
  for (const part of roofOf(arch.roof, top, cx, cyTop, Math.abs(w), tint, isle.scale)) g.appendChild(part);

  const APEX = { spire: 1.55, pagoda: 1.0, dome: 0.78, gable: 0.5, flat: 0.9, terrace: 0.25, arch: 0.66 };
  const apex = cyTop - Math.abs(w) * (APEX[arch.roof] ?? 0.6);
  spec.labelPos = [cx, apex - 11 - (spec.labelDrop || 0)];

  const t = el('title');
  t.textContent = `${building.name} — ${building.blurb}`;
  g.appendChild(t);
  return g;
}

/* ---------------------------------------------------------------- world */

export function drawMap(svg, geo) {
  svg.setAttribute('viewBox', `0 0 ${VIEW_W} ${VIEW_H}`);
  svg.innerHTML = '';
  svg.appendChild(defs());

  // light bridges from the campus out to every isle
  const campus = geo.isles.find((i) => i.isCampus);
  const bridges = el('g', { class: 'bridges' });
  for (const isle of geo.isles) {
    if (isle.isCampus) continue;
    const mx = (campus.cx + isle.cx) / 2;
    const my = (campus.cy + isle.cy) / 2 - 70;
    bridges.appendChild(el('path', {
      d: `M ${campus.cx} ${campus.cy} Q ${mx} ${my} ${isle.cx} ${isle.cy}`,
      class: 'bridge', stroke: 'url(#bridge)', fill: 'none',
    }));
  }
  svg.appendChild(bridges);

  // painter's algorithm: far isles first
  const order = [...geo.isles].sort((a, b) => a.cy - b.cy);
  for (const isle of order) {
    const g = el('g', { class: 'isle-group' });
    g.appendChild(drawIsle(isle));
    const built = Object.entries(geo.buildings)
      .filter(([, s]) => s.isle === isle)
      .sort((a, z) => project(isle, a[1].u, a[1].v)[1] - project(isle, z[1].u, z[1].v)[1]);
    for (const [id, spec] of built) g.appendChild(drawBuilding(id, spec));
    svg.appendChild(g);
  }

  // name plates last, so no roof can cover them
  const plates = el('g', { class: 'plates' });
  for (const [id, spec] of Object.entries(geo.buildings)) {
    const [lx, ly] = spec.labelPos;
    const name = el('text', { x: lx, y: ly, class: 'build-name', 'text-anchor': 'middle' });
    name.textContent = spec.building.short;
    plates.appendChild(name);
    plates.appendChild(el('text', {
      x: lx, y: ly + 9.5, class: 'build-staff', 'text-anchor': 'middle', 'data-staff': id,
    }));
  }
  svg.appendChild(plates);

  svg.appendChild(el('g', { class: 'pins', id: 'pin-layer' }));
}

/* ---------------------------------------------------------------- pins */

function yardSlot(isle, i, total) {
  const y = isle.yard;
  const cols = Math.min(y.cols, Math.max(1, total));
  const rows = Math.ceil(total / cols);
  const col = i % cols;
  const row = Math.floor(i / cols);
  const u = cols === 1 ? (y.u0 + y.u1) / 2 : y.u0 + (col / (cols - 1)) * (y.u1 - y.u0);
  const v = rows === 1 ? y.v0 : y.v0 + (row / Math.max(1, rows - 1)) * (y.v1 - y.v0);
  return [u, v];
}

function makePin(c) {
  const g = el('g', { class: 'pin', 'data-pin': c.id, tabindex: '0' });
  g.appendChild(el('ellipse', { cx: 0, cy: 1, rx: 4.5, ry: 2, fill: '#04060e', opacity: 0.4 }));
  g.appendChild(el('circle', { cx: 0, cy: -7, r: 7.5, class: 'aura', filter: 'url(#softglow)' }));
  g.appendChild(el('path', { d: 'M -3.1 0 L -2.1 -6.4 Q 0 -8.2 2.1 -6.4 L 3.1 0 Z', class: 'robe' }));
  g.appendChild(el('circle', { cx: 0, cy: -9.2, r: 2.1, class: 'head' }));
  g.appendChild(el('circle', { cx: 0, cy: -13.5, r: 1.6, class: 'halo' }));
  g.appendChild(el('title'));
  return g;
}

export function drawPins(svg, geo, town, selectedId) {
  const layer = svg.querySelector('#pin-layer');
  const where = (c) => (c.stage === 'employed' ? c.post.buildingId : c.location);
  const totals = {};
  const slots = {};
  const staff = {};
  for (const c of town.citizens) totals[where(c)] = (totals[where(c)] || 0) + 1;

  const placed = [];
  for (const c of town.citizens) {
    const loc = where(c);
    const spec = geo.buildings[loc];
    if (!spec) continue;
    const i = (slots[loc] = (slots[loc] ?? -1) + 1);
    if (c.stage === 'employed') staff[loc] = (staff[loc] || 0) + 1;

    // citizens gather in their building's yard; the campus yard holds the whole student body
    const isle = spec.isle;
    const total = totals[loc];
    const [u, v] = isle.isCampus && loc === 'academy'
      ? yardSlot(isle, i, total)
      : yardSlot({ ...isle, yard: { ...isle.yard, u0: spec.u - 0.3, u1: spec.u + 0.3, cols: 3 } }, i, total);
    const [x, y] = project(isle, u, v);

    let pin = layer.querySelector(`[data-pin="${c.id}"]`);
    if (!pin) { pin = makePin(c); layer.appendChild(pin); }
    pin.setAttribute('transform', `translate(${x.toFixed(1)} ${y.toFixed(1)}) scale(${(isle.scale * 1.22).toFixed(2)})`);
    pin.setAttribute('data-stage', c.stage);
    pin.setAttribute('style', `--tint:${GUILDS[c.guildIndex].color}`);
    pin.classList.toggle('is-selected', c.id === selectedId);
    pin.querySelector('title').textContent =
      c.stage === 'employed' ? `${c.name} — ${c.role}` : `${c.name} — ${c.stage}`;
    placed.push({ pin, y });
  }
  // keep nearer citizens in front
  placed.sort((a, b) => a.y - b.y).forEach(({ pin }) => layer.appendChild(pin));

  for (const [id, spec] of Object.entries(geo.buildings)) {
    const label = svg.querySelector(`[data-staff="${id}"]`);
    if (!label) continue;
    const n = staff[id] || 0;
    const seats = spec.building.posts.reduce((a, p) => a + p.seats, 0);
    label.textContent = n ? `${n}/${seats}` : `${seats} open`;
    label.classList.toggle('is-empty', n === 0);
  }
}

/* ------------------------------------------------------------- the sky */

export function startSky(canvas) {
  const ctx = canvas.getContext('2d');
  const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  let W = 0, H = 0, stars = [], motes = [], clouds = [];

  const seedRand = (() => { let a = 20260821; return () => ((a = (a * 1664525 + 1013904223) >>> 0) / 4294967296); })();

  function size() {
    const r = canvas.getBoundingClientRect();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    W = Math.max(1, r.width); H = Math.max(1, r.height);
    canvas.width = W * dpr; canvas.height = H * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    stars = Array.from({ length: 220 }, () => ({
      x: seedRand() * W, y: seedRand() * H * 0.92,
      r: seedRand() * 1.3 + 0.25, p: seedRand() * Math.PI * 2, s: 0.4 + seedRand(),
    }));
    motes = Array.from({ length: 46 }, () => ({
      x: seedRand() * W, y: seedRand() * H,
      r: seedRand() * 1.8 + 0.6, v: 0.08 + seedRand() * 0.22, drift: (seedRand() - 0.5) * 0.16,
      hue: seedRand() > 0.5 ? '#ffd9a0' : '#9ff0dd',
    }));
    clouds = Array.from({ length: 7 }, (_, i) => ({
      x: seedRand() * W, y: H * (0.18 + seedRand() * 0.7),
      rx: 190 + seedRand() * 320, ry: 34 + seedRand() * 54,
      v: 0.04 + seedRand() * 0.09, o: 0.05 + seedRand() * 0.07,
      hue: i % 3 === 0 ? '155, 120, 255' : i % 3 === 1 ? '80, 190, 220' : '255, 170, 190',
    }));
  }

  function frame(t) {
    ctx.clearRect(0, 0, W, H);
    const sky = ctx.createLinearGradient(0, 0, 0, H);
    sky.addColorStop(0, '#05060f');
    sky.addColorStop(0.42, '#0b1030');
    sky.addColorStop(0.74, '#132043');
    sky.addColorStop(1, '#0d2b3f');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, W, H);

    for (const c of clouds) {
      if (!still) c.x += c.v;
      if (c.x - c.rx > W) c.x = -c.rx;
      const g = ctx.createRadialGradient(c.x, c.y, 0, c.x, c.y, c.rx);
      g.addColorStop(0, `rgba(${c.hue}, ${c.o})`);
      g.addColorStop(1, `rgba(${c.hue}, 0)`);
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.ellipse(c.x, c.y, c.rx, c.ry, 0, 0, Math.PI * 2);
      ctx.fill();
    }

    for (const s of stars) {
      const tw = still ? 0.75 : 0.55 + Math.sin(t / 900 * s.s + s.p) * 0.35;
      ctx.globalAlpha = tw;
      ctx.fillStyle = '#dbe8ff';
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    for (const m of motes) {
      if (!still) { m.y -= m.v; m.x += m.drift; }
      if (m.y < -6) { m.y = H + 6; m.x = seedRand() * W; }
      const g = ctx.createRadialGradient(m.x, m.y, 0, m.x, m.y, m.r * 6);
      g.addColorStop(0, m.hue);
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.globalAlpha = 0.5;
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(m.x, m.y, m.r * 6, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    if (!still) requestAnimationFrame(frame);
  }

  size();
  window.addEventListener('resize', () => { size(); if (still) frame(0); });
  requestAnimationFrame(frame);
}
