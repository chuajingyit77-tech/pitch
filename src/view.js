// The world, drawn as a storybook: isles of grass floating in a bright sky,
// cottages with steep coloured roofs and smoking chimneys, and small round
// people standing on the ground. Everything is drawn with a soft ink line,
// the way a picture book is.

import { GUILDS, BUILDINGS } from './data.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
const VIEW_W = 1440;
const VIEW_H = 880;
const CENTER = { x: 720, y: 398 };
const RING = { rx: 505, ry: 188 };
const INK = '#5b4636';

const el = (name, attrs = {}, kids = []) => {
  const n = document.createElementNS(SVG_NS, name);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
  for (const k of kids) n.appendChild(k);
  return n;
};
const poly = (pts, attrs) => el('polygon', { points: pts.map((p) => p.join(',')).join(' '), ...attrs });
const lerp = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];

// Every guild builds in its own storybook manner.
const ARCHITECTURE = {
  aether:    { roof: 'cone',   h: 44, wall: '#fdf3e0', chimney: false, vane: 'star' },
  verdant:   { roof: 'thatch', h: 30, wall: '#fbf0dc', chimney: true },
  forge:     { roof: 'gable',  h: 32, wall: '#f6e7d2', chimney: true },
  lattice:   { roof: 'gable',  h: 36, wall: '#fdf3e0', chimney: false, vane: 'dish' },
  mender:    { roof: 'dome',   h: 28, wall: '#fdf3e6', chimney: true },
  ledger:    { roof: 'awning', h: 30, wall: '#fbeed6', chimney: true },
  wayfinder: { roof: 'mill',   h: 36, wall: '#fdf3e0', chimney: false },
  keystone:  { roof: 'gable',  h: 34, wall: '#f8eeda', chimney: true, vane: 'bell' },
  lumen:     { roof: 'dome',   h: 32, wall: '#fdf3e0', chimney: false, vane: 'star' },
  chorus:    { roof: 'tent',   h: 28, wall: '#fdf0e4', chimney: false },
  hearth:    { roof: 'tower',  h: 40, wall: '#fdf4e4', chimney: true, vane: 'flag' },
};

export function computeGeometry() {
  const isles = [];
  const others = GUILDS.filter((g) => g.id !== 'hearth');
  others.forEach((guild, i) => {
    const a = -Math.PI / 2 + (i / others.length) * Math.PI * 2;
    const cx = CENTER.x + Math.cos(a) * RING.rx;
    const cy = CENTER.y + Math.sin(a) * RING.ry;
    const s = 0.82 + Math.min(1, Math.max(0, (Math.sin(a) + 1) / 2)) * 0.26;
    isles.push({
      guild, cx, cy, rx: 152 * s, ry: 76 * s, scale: s,
      yard: { u0: -0.72, u1: 0.72, v0: 0.28, v1: 0.86, cols: 5 },
    });
  });
  isles.push({
    guild: GUILDS.find((g) => g.id === 'hearth'),
    cx: CENTER.x, cy: CENTER.y + 18,
    rx: 272, ry: 136, scale: 1.2, isCampus: true,
    yard: { u0: -0.78, u1: 0.78, v0: 0.16, v1: 0.9, cols: 11 },
  });

  const buildings = {};
  for (const isle of isles) {
    const list = BUILDINGS.filter((b) => b.guild === isle.guild.id);
    const n = list.length;
    list.forEach((b, j) => {
      const spread = isle.isCampus ? 0.58 : 0.42;
      const t = n === 1 ? 0 : -spread + (j / (n - 1)) * spread * 2;
      const back = (isle.isCampus ? -0.3 : -0.26) + (j % 2) * 0.07;
      const arch = ARCHITECTURE[isle.guild.id];
      buildings[b.id] = {
        building: b, isle,
        u: t + back, v: -t + back,
        du: isle.isCampus ? 0.115 : 0.15,
        dv: isle.isCampus ? 0.115 : 0.15,
        h: (arch.h + (b.id === 'academy' ? 18 : 0)) * isle.scale * 0.82,
        arch,
        labelDrop: (j % 2) * 30,
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
    <radialGradient id="grassTop" cx="42%" cy="32%" r="74%">
      <stop offset="0%" stop-color="#b6dd8b" />
      <stop offset="60%" stop-color="#93c96f" />
      <stop offset="100%" stop-color="#6fae5b" />
    </radialGradient>
    <linearGradient id="soil" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#a9764c" />
      <stop offset="45%" stop-color="#8a5c3b" />
      <stop offset="100%" stop-color="#6d472d" />
    </linearGradient>
    <linearGradient id="brook" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#bfe6f2" stop-opacity="0.95" />
      <stop offset="100%" stop-color="#bfe6f2" stop-opacity="0" />
    </linearGradient>
    <filter id="softshadow" x="-40%" y="-40%" width="180%" height="200%">
      <feDropShadow dx="0" dy="5" stdDeviation="6" flood-color="#5b4636" flood-opacity="0.18" />
    </filter>
    <filter id="lampglow" x="-120%" y="-120%" width="340%" height="340%">
      <feGaussianBlur stdDeviation="3" />
    </filter>`;
  return d;
}

/* ---------------------------------------------------------------- isles */

function drawIsle(isle) {
  const g = el('g', { class: 'isle', 'data-guild': isle.guild.id });
  const { cx, cy, rx, ry } = isle;
  const top = [[cx, cy - ry], [cx + rx, cy], [cx, cy + ry], [cx - rx, cy]];
  const depth = ry * (isle.isCampus ? 2.2 : 1.9);

  // the earth underneath, rounded and lumpy rather than jagged
  g.appendChild(el('path', {
    d: `M ${cx - rx} ${cy}
        C ${cx - rx * 0.9} ${cy + ry * 1.1}, ${cx - rx * 0.5} ${cy + depth * 0.7}, ${cx - rx * 0.12} ${cy + depth * 0.92}
        Q ${cx} ${cy + depth * 1.08} ${cx + rx * 0.16} ${cy + depth * 0.88}
        C ${cx + rx * 0.55} ${cy + depth * 0.66}, ${cx + rx * 0.92} ${cy + ry * 1.05}, ${cx + rx} ${cy}
        L ${cx} ${cy + ry} Z`,
    fill: 'url(#soil)', stroke: INK, 'stroke-opacity': 0.35, 'stroke-width': 1.6,
  }));

  // grass
  g.appendChild(poly(top, { fill: 'url(#grassTop)', stroke: INK, 'stroke-opacity': 0.42, 'stroke-width': 1.8 }));

  // a winding path and a few tufts of grass
  const p0 = project(isle, -0.78, 0.12);
  const p1 = project(isle, 0, 0.34);
  const p2 = project(isle, 0.78, 0.12);
  g.appendChild(el('path', {
    d: `M ${p0[0]} ${p0[1]} Q ${p1[0]} ${p1[1] + 8} ${p2[0]} ${p2[1]}`,
    fill: 'none', stroke: '#e9d7ae', 'stroke-width': 5 * isle.scale, 'stroke-linecap': 'round', opacity: 0.85,
  }));
  for (let i = 0; i < 7; i++) {
    const u = -0.85 + (i / 6) * 1.7;
    const [tx, ty] = project(isle, u, 0.62 + (i % 3) * 0.09);
    g.appendChild(el('path', {
      d: `M ${tx} ${ty} q -3 -6 -1 -9 M ${tx} ${ty} q 3 -7 5 -9`,
      stroke: '#5f9c4d', 'stroke-width': 1.4, fill: 'none', 'stroke-linecap': 'round', opacity: 0.75,
    }));
    if (i % 2 === 0) {
      g.appendChild(el('circle', { cx: tx + 5, cy: ty - 9, r: 2, fill: i % 4 === 0 ? '#f2b441' : '#e8879b', stroke: INK, 'stroke-opacity': 0.25, 'stroke-width': 0.6 }));
    }
  }

  // vines and a little waterfall spilling off the underside
  for (const side of [-1, 1]) {
    const vx = cx + side * rx * 0.62;
    const vy = cy + ry * 0.42;
    g.appendChild(el('path', {
      d: `M ${vx} ${vy} q ${side * 6} 16 ${-side * 3} 30`,
      stroke: '#6fae5b', 'stroke-width': 2, fill: 'none', 'stroke-linecap': 'round', opacity: 0.8,
    }));
  }
  g.appendChild(el('path', {
    d: `M ${cx - rx * 0.035} ${cy + depth * 0.92} L ${cx + rx * 0.03} ${cy + depth * 0.92}
        Q ${cx + rx * 0.05} ${cy + depth * 1.3} ${cx + rx * 0.012} ${cy + depth * 1.45}
        L ${cx - rx * 0.016} ${cy + depth * 1.45} Z`,
    fill: 'url(#brook)', class: 'brook',
  }));

  if (isle.isCampus) {
    const [px, py] = project(isle, 0, 0.42);
    g.appendChild(el('ellipse', { cx: px, cy: py, rx: rx * 0.34, ry: ry * 0.34, fill: '#f7e9c4', opacity: 0.55, stroke: INK, 'stroke-opacity': 0.2 }));
    g.appendChild(el('ellipse', { cx: px, cy: py, rx: rx * 0.17, ry: ry * 0.17, fill: 'none', stroke: '#c9a86a', 'stroke-opacity': 0.6, 'stroke-dasharray': '5 7' }));
  }

  const label = el('text', {
    x: cx - rx * 0.52, y: cy + ry + 15 * isle.scale, class: 'isle-label', 'text-anchor': 'middle',
  });
  label.textContent = isle.guild.name.replace(' Guild', '');
  g.appendChild(label);
  return g;
}

/* ------------------------------------------------------------ buildings */

function arcWindow(face, h, t, lift, w, tint) {
  const a = lerp(face[0], face[1], t);
  const b = lerp(face[0], face[1], t + w);
  const top = 0.34;
  return el('path', {
    d: `M ${a[0]} ${a[1] - h * lift} L ${b[0]} ${b[1] - h * lift}
        L ${b[0]} ${b[1] - h * (lift + top) + 3} Q ${(a[0] + b[0]) / 2} ${(a[1] + b[1]) / 2 - h * (lift + top) - 4} ${a[0]} ${a[1] - h * (lift + top) + 3} Z`,
    fill: tint, stroke: INK, 'stroke-opacity': 0.4, 'stroke-width': 0.9, class: 'win',
  });
}

function roofOf(kind, top, cx, cyTop, w, tint, scale, arch) {
  const parts = [];
  const [a, b, c, d] = top;
  const rh = w * 0.9;
  const eaves = top.map((p) => [cx + (p[0] - cx) * 1.2, cyTop + (p[1] - cyTop) * 1.2]);
  const shade = { fill: tint, stroke: INK, 'stroke-opacity': 0.42, 'stroke-width': 1.4, 'stroke-linejoin': 'round' };

  if (kind === 'cone' || kind === 'tent' || kind === 'tower') {
    const height = kind === 'tower' ? rh * 1.5 : rh * 1.25;
    const apex = [cx, cyTop - height];
    parts.push(poly([eaves[3], eaves[0], apex], { ...shade, opacity: 0.85 }));
    parts.push(poly([eaves[0], eaves[1], apex], { ...shade, opacity: 0.72 }));
    parts.push(poly([eaves[1], eaves[2], apex], shade));
    parts.push(poly([eaves[2], eaves[3], apex], { ...shade, filter: undefined, opacity: 0.9 }));
    if (kind === 'tent') {
      for (let i = 1; i < 4; i++) {
        const edge = lerp(eaves[2], eaves[1], i / 4);
        parts.push(el('line', { x1: apex[0], y1: apex[1], x2: edge[0], y2: edge[1], stroke: '#fdf3e0', 'stroke-width': 1.6, opacity: 0.8 }));
      }
    }
  } else if (kind === 'dome') {
    const r = w * 0.78;
    parts.push(el('path', {
      d: `M ${cx - r} ${cyTop + 2} A ${r} ${r * 1.05} 0 0 1 ${cx + r} ${cyTop + 2} Z`, ...shade,
    }));
    parts.push(el('path', {
      d: `M ${cx - r * 0.52} ${cyTop - r * 0.55} A ${r * 0.62} ${r * 0.66} 0 0 1 ${cx + r * 0.06} ${cyTop - r * 0.9}`,
      stroke: '#fff8e8', 'stroke-opacity': 0.7, fill: 'none', 'stroke-width': 2,
    }));
  } else if (kind === 'thatch') {
    parts.push(el('path', {
      d: `M ${eaves[3][0]} ${eaves[3][1]} Q ${cx} ${cyTop - rh * 1.5} ${eaves[1][0]} ${eaves[1][1]}
          Q ${cx} ${cyTop + rh * 0.25} ${eaves[3][0]} ${eaves[3][1]} Z`, ...shade,
    }));
    for (let i = 0; i < 3; i++) {
      parts.push(el('path', {
        d: `M ${cx - w * 0.5 + i * w * 0.5} ${cyTop - rh * 0.2} q 4 -${rh * 0.5} 2 -${rh * 0.85}`,
        stroke: INK, 'stroke-opacity': 0.16, fill: 'none', 'stroke-width': 1.2,
      }));
    }
  } else if (kind === 'awning') {
    parts.push(poly([eaves[3], eaves[2], eaves[1], [cx, cyTop - rh * 0.5]], shade));
    const stripeW = (eaves[1][0] - eaves[3][0]) / 6;
    for (let i = 0; i < 3; i++) {
      const x0 = eaves[3][0] + stripeW * (i * 2 + 0.5);
      parts.push(poly([[x0, eaves[3][1] + (i * 2 + 0.5) * 0], [x0 + stripeW, eaves[3][1]], [cx, cyTop - rh * 0.5]],
        { fill: '#fff6e4', opacity: 0.55 }));
    }
  } else if (kind === 'mill') {
    parts.push(poly([eaves[3], eaves[0], eaves[1], eaves[2]], { ...shade, opacity: 0.9 }));
    const hubY = cyTop - rh * 0.5;
    const blades = el('g', { class: 'blades', style: `--hx:${cx}px; --hy:${hubY}px` });
    for (let i = 0; i < 4; i++) {
      blades.appendChild(el('rect', {
        x: cx - 1.6, y: hubY - w * 1.15, width: 3.2, height: w * 1.15,
        fill: '#fdf3e0', stroke: INK, 'stroke-opacity': 0.4, 'stroke-width': 0.9, rx: 1.4,
        transform: `rotate(${i * 90} ${cx} ${hubY})`,
      }));
    }
    parts.push(blades);
    parts.push(el('circle', { cx, cy: hubY, r: 2.6, fill: INK, opacity: 0.7 }));
  } else {
    // gable: a steep pitched roof with a ridge
    const ridgeA = [(eaves[0][0] + eaves[3][0]) / 2, (eaves[0][1] + eaves[3][1]) / 2 - rh];
    const ridgeB = [(eaves[1][0] + eaves[2][0]) / 2, (eaves[1][1] + eaves[2][1]) / 2 - rh];
    parts.push(poly([eaves[0], eaves[1], ridgeB, ridgeA], { ...shade, opacity: 0.78 }));
    parts.push(poly([eaves[3], eaves[2], ridgeB, ridgeA], shade));
    parts.push(el('line', {
      x1: ridgeA[0], y1: ridgeA[1], x2: ridgeB[0], y2: ridgeB[1],
      stroke: '#fff6e4', 'stroke-opacity': 0.5, 'stroke-width': 1.6,
    }));
  }

  // weather vanes, bells and flags
  const vaneY = kind === 'dome' ? cyTop - w * 0.85 : cyTop - rh * 1.35;
  if (arch.vane === 'star') {
    parts.push(el('path', {
      d: `M ${cx} ${vaneY - 8} l 2.2 4.6 5 .7 -3.6 3.5 .9 5-4.5-2.4-4.5 2.4.9-5-3.6-3.5 5-.7z`,
      fill: '#f7c948', stroke: INK, 'stroke-opacity': 0.35, 'stroke-width': 0.8, class: 'twinkle',
    }));
  } else if (arch.vane === 'flag') {
    parts.push(el('line', { x1: cx, y1: vaneY + 4, x2: cx, y2: vaneY - 14, stroke: INK, 'stroke-width': 1.4, opacity: 0.7 }));
    parts.push(el('path', { d: `M ${cx} ${vaneY - 14} q 9 3 14 0 l 0 7 q -6 3 -14 0 z`, fill: '#d96c5f', stroke: INK, 'stroke-opacity': 0.4, 'stroke-width': 0.9, class: 'flag' }));
  } else if (arch.vane === 'bell') {
    parts.push(el('path', { d: `M ${cx - 4} ${vaneY} q 0 -7 4 -7 t 4 7 z`, fill: '#e0b64a', stroke: INK, 'stroke-opacity': 0.4, 'stroke-width': 0.9 }));
  } else if (arch.vane === 'dish') {
    parts.push(el('ellipse', { cx, cy: vaneY - 2, rx: 6, ry: 3, fill: '#fdf3e0', stroke: INK, 'stroke-opacity': 0.4, 'stroke-width': 0.9 }));
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

  g.appendChild(el('ellipse', {
    cx: (base[0][0] + base[2][0]) / 2, cy: (base[0][1] + base[2][1]) / 2 + 3,
    rx: Math.abs(w) * 1.2, ry: Math.abs(w) * 0.52, fill: '#4f7a3f', opacity: 0.22,
  }));

  const wallStroke = { stroke: INK, 'stroke-opacity': 0.42, 'stroke-width': 1.4, 'stroke-linejoin': 'round' };
  g.appendChild(poly([base[3], base[2], top[2], top[3]], { fill: arch.wall, class: 'wall-l', ...wallStroke }));
  g.appendChild(poly([base[2], base[1], top[1], top[2]], { fill: arch.wall, class: 'wall-r', ...wallStroke }));

  const glow = '#ffd98a';
  g.appendChild(arcWindow([base[3], base[2]], h, 0.2, 0.34, 0.22, glow));
  g.appendChild(arcWindow([base[2], base[1]], h, 0.58, 0.34, 0.22, glow));
  if (h > 34) {
    g.appendChild(arcWindow([base[3], base[2]], h, 0.55, 0.62, 0.18, glow));
    g.appendChild(arcWindow([base[2], base[1]], h, 0.24, 0.62, 0.18, glow));
  }

  // a rounded door on the near corner, with a lamp beside it
  const door = lerp(base[3], base[2], 0.52);
  g.appendChild(el('path', {
    d: `M ${door[0] - 3.4} ${door[1]} L ${door[0] - 3.4} ${door[1] - h * 0.22}
        Q ${door[0]} ${door[1] - h * 0.34} ${door[0] + 3.4} ${door[1] - h * 0.22}
        L ${door[0] + 3.4} ${door[1] + 1.6} Z`,
    fill: '#9c6b43', stroke: INK, 'stroke-opacity': 0.5, 'stroke-width': 1,
  }));
  g.appendChild(el('circle', { cx: door[0] + 7, cy: door[1] - h * 0.3, r: 2.2, fill: '#ffcf6b', class: 'lamp' }));

  const cx = (top[1][0] + top[3][0]) / 2;
  const cyTop = (top[0][1] + top[2][1]) / 2;
  for (const part of roofOf(arch.roof, top, cx, cyTop, Math.abs(w), tint, isle.scale, arch)) g.appendChild(part);

  // chimney and a curl of smoke
  if (arch.chimney) {
    const chx = cx + Math.abs(w) * 0.62;
    const chy = cyTop - Math.abs(w) * 0.45;
    g.appendChild(el('rect', {
      x: chx - 3, y: chy - 12, width: 6, height: 15, rx: 1.5,
      fill: '#c98a63', stroke: INK, 'stroke-opacity': 0.45, 'stroke-width': 1,
    }));
    const smoke = el('g', { class: 'smoke' });
    for (let i = 0; i < 3; i++) {
      smoke.appendChild(el('circle', {
        cx: chx, cy: chy - 14, r: 3 + i * 0.6, fill: '#fffaf0', opacity: 0.75,
        style: `animation-delay:${i * 1.1}s`,
      }));
    }
    g.appendChild(smoke);
  }

  const APEX = { cone: 1.5, tower: 1.75, tent: 1.4, dome: 0.95, thatch: 1.6, awning: 0.8, mill: 1.3, gable: 1.1 };
  spec.labelPos = [cx, cyTop - Math.abs(w) * (APEX[arch.roof] ?? 1.1) - 11 - (spec.labelDrop || 0)];

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

  const campus = geo.isles.find((i) => i.isCampus);
  const bridges = el('g', { class: 'bridges' });
  for (const isle of geo.isles) {
    if (isle.isCampus) continue;
    const mx = (campus.cx + isle.cx) / 2;
    const my = (campus.cy + isle.cy) / 2 - 62;
    bridges.appendChild(el('path', {
      d: `M ${campus.cx} ${campus.cy} Q ${mx} ${my} ${isle.cx} ${isle.cy}`,
      class: 'bridge', fill: 'none',
    }));
  }
  svg.appendChild(bridges);

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

  const plates = el('g', { class: 'plates' });
  for (const [id, spec] of Object.entries(geo.buildings)) {
    const [lx, ly] = spec.labelPos;
    const name = el('text', { x: lx, y: ly, class: 'build-name', 'text-anchor': 'middle' });
    name.textContent = spec.building.short;
    plates.appendChild(name);
    plates.appendChild(el('text', {
      x: lx, y: ly + 10.5, class: 'build-staff', 'text-anchor': 'middle', 'data-staff': id,
    }));
  }
  svg.appendChild(plates);
  svg.appendChild(el('g', { class: 'pins', id: 'pin-layer' }));
}

/* ---------------------------------------------------------------- folk */

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
  g.appendChild(el('ellipse', { cx: 0, cy: 1.5, rx: 4.6, ry: 2, fill: '#4f7a3f', opacity: 0.3 }));
  g.appendChild(el('path', {
    d: 'M -4 0.5 Q -4.4 -6 -1.9 -7.6 L 1.9 -7.6 Q 4.4 -6 4 0.5 Z',
    class: 'robe', stroke: INK, 'stroke-opacity': 0.45, 'stroke-width': 1,
  }));
  g.appendChild(el('circle', { cx: 0, cy: -9.6, r: 2.9, class: 'head', stroke: INK, 'stroke-opacity': 0.45, 'stroke-width': 1 }));
  g.appendChild(el('path', { d: 'M -2.9 -10.6 Q 0 -13.6 2.9 -10.6 Q 0 -12 -2.9 -10.6 Z', class: 'hair' }));
  g.appendChild(el('circle', { cx: 0, cy: -14.4, r: 2.4, class: 'halo' }));
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

    const isle = spec.isle;
    const [u, v] = isle.isCampus && loc === 'academy'
      ? yardSlot(isle, i, totals[loc])
      : yardSlot({ ...isle, yard: { ...isle.yard, u0: spec.u - 0.3, u1: spec.u + 0.3, cols: 3 } }, i, totals[loc]);
    const [x, y] = project(isle, u, v);

    let pin = layer.querySelector(`[data-pin="${c.id}"]`);
    if (!pin) { pin = makePin(c); layer.appendChild(pin); }
    pin.setAttribute('transform', `translate(${x.toFixed(1)} ${y.toFixed(1)}) scale(${(isle.scale * 1.15).toFixed(2)})`);
    pin.setAttribute('data-stage', c.stage);
    pin.setAttribute('style', `--tint:${GUILDS[c.guildIndex].color}`);
    pin.classList.toggle('is-selected', c.id === selectedId);
    pin.querySelector('title').textContent =
      c.stage === 'employed' ? `${c.name} — ${c.role}` : `${c.name} — ${c.stage}`;
    placed.push({ pin, y });
  }
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
  let W = 0, H = 0, clouds = [], birds = [], petals = [];

  const seedRand = (() => { let a = 20260821; return () => ((a = (a * 1664525 + 1013904223) >>> 0) / 4294967296); })();

  function size() {
    const r = canvas.getBoundingClientRect();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    W = Math.max(1, r.width); H = Math.max(1, r.height);
    canvas.width = W * dpr; canvas.height = H * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    clouds = Array.from({ length: 9 }, () => ({
      x: seedRand() * W, y: H * (0.05 + seedRand() * 0.66),
      s: 0.5 + seedRand() * 0.9, v: 0.05 + seedRand() * 0.11,
    }));
    birds = Array.from({ length: 5 }, () => ({
      x: seedRand() * W, y: H * (0.08 + seedRand() * 0.3),
      s: 0.7 + seedRand() * 0.6, v: 0.18 + seedRand() * 0.2, p: seedRand() * 6,
    }));
    petals = Array.from({ length: 26 }, () => ({
      x: seedRand() * W, y: seedRand() * H,
      r: 1.6 + seedRand() * 2.2, v: 0.16 + seedRand() * 0.3,
      drift: (seedRand() - 0.5) * 0.5, p: seedRand() * 6,
      hue: ['#ffd6e0', '#fff0c2', '#e6f2c8'][Math.floor(seedRand() * 3)],
    }));
  }

  function puff(x, y, s) {
    ctx.beginPath();
    ctx.ellipse(x, y, 44 * s, 26 * s, 0, 0, Math.PI * 2);
    ctx.ellipse(x - 34 * s, y + 6 * s, 28 * s, 18 * s, 0, 0, Math.PI * 2);
    ctx.ellipse(x + 32 * s, y + 7 * s, 30 * s, 19 * s, 0, 0, Math.PI * 2);
    ctx.ellipse(x + 4 * s, y - 15 * s, 26 * s, 18 * s, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  function frame(t) {
    ctx.clearRect(0, 0, W, H);
    const sky = ctx.createLinearGradient(0, 0, 0, H);
    sky.addColorStop(0, '#8fd0ea');
    sky.addColorStop(0.42, '#bfe4f0');
    sky.addColorStop(0.72, '#f6e2c0');
    sky.addColorStop(1, '#f7cfa4');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, W, H);

    // a low sun with a warm halo
    const sunX = W * 0.78, sunY = H * 0.2;
    const halo = ctx.createRadialGradient(sunX, sunY, 0, sunX, sunY, H * 0.42);
    halo.addColorStop(0, 'rgba(255, 234, 178, 0.9)');
    halo.addColorStop(1, 'rgba(255, 234, 178, 0)');
    ctx.fillStyle = halo;
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = '#fff3cd';
    ctx.beginPath();
    ctx.arc(sunX, sunY, 30, 0, Math.PI * 2);
    ctx.fill();

    for (const c of clouds) {
      if (!still) c.x += c.v;
      if (c.x - 90 * c.s > W) c.x = -90 * c.s;
      ctx.fillStyle = 'rgba(255, 255, 255, 0.5)';
      puff(c.x, c.y + 7 * c.s, c.s);
      ctx.fillStyle = 'rgba(255, 255, 255, 0.92)';
      puff(c.x, c.y, c.s);
    }

    ctx.strokeStyle = 'rgba(91, 70, 54, 0.45)';
    ctx.lineWidth = 1.4;
    for (const b of birds) {
      if (!still) b.x += b.v;
      if (b.x > W + 20) b.x = -20;
      const flap = Math.sin(t / 260 + b.p) * 2.4;
      ctx.beginPath();
      ctx.moveTo(b.x - 6 * b.s, b.y);
      ctx.quadraticCurveTo(b.x - 3 * b.s, b.y - 3 * b.s - flap, b.x, b.y);
      ctx.quadraticCurveTo(b.x + 3 * b.s, b.y - 3 * b.s - flap, b.x + 6 * b.s, b.y);
      ctx.stroke();
    }

    for (const p of petals) {
      if (!still) { p.y += p.v; p.x += Math.sin(t / 1400 + p.p) * 0.4 + p.drift * 0.2; }
      if (p.y > H + 6) { p.y = -6; p.x = seedRand() * W; }
      ctx.fillStyle = p.hue;
      ctx.globalAlpha = 0.85;
      ctx.beginPath();
      ctx.ellipse(p.x, p.y, p.r, p.r * 0.62, Math.sin(t / 900 + p.p), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    if (!still) requestAnimationFrame(frame);
  }

  size();
  window.addEventListener('resize', () => { size(); if (still) frame(0); });
  requestAnimationFrame(frame);
}
