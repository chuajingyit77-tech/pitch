// Plan-view renderer: districts as survey plots, citizens as brass pins that travel.

import { GUILDS, BUILDINGS, RESOURCES } from './data.js';
import { BUILDING_BY_ID, performanceBand, seniority } from './engine.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
const VIEW_W = 1200;
const VIEW_H = 654;
const PAD = 24;
const GAP = 18;
const CELL_W = 274;
const CELL_H = 190;

// Four columns, three rows. The Hearth campus takes a double plot in the middle band.
const PLOT_LAYOUT = [
  { guild: 'aether',    col: 0, row: 0, span: 1 },
  { guild: 'verdant',   col: 1, row: 0, span: 1 },
  { guild: 'forge',     col: 2, row: 0, span: 1 },
  { guild: 'lattice',   col: 3, row: 0, span: 1 },
  { guild: 'mender',    col: 0, row: 1, span: 1 },
  { guild: 'hearth',    col: 1, row: 1, span: 2 },
  { guild: 'ledger',    col: 3, row: 1, span: 1 },
  { guild: 'wayfinder', col: 0, row: 2, span: 1 },
  { guild: 'keystone',  col: 1, row: 2, span: 1 },
  { guild: 'lumen',     col: 2, row: 2, span: 1 },
  { guild: 'chorus',    col: 3, row: 2, span: 1 },
];

const el = (name, attrs = {}, children = []) => {
  const node = document.createElementNS(SVG_NS, name);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  for (const c of children) node.appendChild(c);
  return node;
};
const text = (str, attrs) => {
  const t = el('text', attrs);
  t.textContent = str;
  return t;
};

function plotRect(entry) {
  const x = PAD + entry.col * (CELL_W + GAP);
  const y = PAD + entry.row * (CELL_H + GAP);
  const w = CELL_W * entry.span + GAP * (entry.span - 1);
  return { x, y, w, h: CELL_H };
}

// Geometry for every building and its pin quad, computed once.
export function computeGeometry() {
  const geo = { buildings: {}, plots: [] };
  PLOT_LAYOUT.forEach((entry, i) => {
    const guild = GUILDS.find((g) => g.id === entry.guild);
    const rect = plotRect(entry);
    const plate = `D-${String(i + 1).padStart(2, '0')}`;
    geo.plots.push({ ...rect, guild, plate });

    const list = BUILDINGS.filter((b) => b.guild === entry.guild);
    const n = list.length;
    const inset = 12;
    const bw = (rect.w - inset * 2 - (n - 1) * 10) / n;
    const bh = 84;
    const isCampus = entry.guild === 'hearth';
    list.forEach((b, j) => {
      const bx = rect.x + inset + j * (bw + 10);
      const by = rect.y + 42;
      // On the campus the Academy gets a full-width quad along the bottom for its students,
      // so the other campus buildings keep a shallow band directly beneath their block.
      const quad = isCampus
        ? { x: bx, y: by + bh + 6, w: bw, h: 18 }
        : { x: bx, y: by + bh + 8, w: bw, h: rect.y + rect.h - (by + bh + 14) };
      geo.buildings[b.id] = { building: b, guild, x: bx, y: by, w: bw, h: bh, cx: bx + bw / 2, quad };
    });
    if (isCampus) {
      geo.buildings.academy.quad = {
        x: rect.x + inset, y: rect.y + 42 + bh + 28, w: rect.w - inset * 2, h: 26,
      };
    }
  });
  return geo;
}

// Pins cluster inside their building's quad, wrapping into rows.
export function pinSlot(geo, buildingId, slot, total = 1) {
  const g = geo.buildings[buildingId];
  if (!g) return { x: VIEW_W / 2, y: VIEW_H / 2 };
  const step = 11;
  const perRow = Math.max(3, Math.floor(g.quad.w / step));
  const row = Math.floor(slot / perRow);
  const col = slot % perRow;
  const maxRows = Math.max(1, Math.round(g.quad.h / step));
  const usedW = Math.min(total, perRow) * step;
  return {
    x: g.quad.x + (g.quad.w - usedW) / 2 + col * step + step / 2,
    y: g.quad.y + 6 + Math.min(row, maxRows - 1) * step,
  };
}

export function drawMap(svg, geo) {
  svg.setAttribute('viewBox', `0 0 ${VIEW_W} ${VIEW_H}`);
  svg.innerHTML = '';

  const defs = el('defs');
  const grid = el('pattern', { id: 'survey-grid', width: 24, height: 24, patternUnits: 'userSpaceOnUse' });
  grid.appendChild(el('path', { d: 'M 24 0 L 0 0 0 24', fill: 'none', stroke: 'var(--rule-faint)', 'stroke-width': 1 }));
  defs.appendChild(grid);
  svg.appendChild(defs);

  svg.appendChild(el('rect', { x: 0, y: 0, width: VIEW_W, height: VIEW_H, fill: 'url(#survey-grid)' }));

  // Streets: the gaps between plots, drawn as paved bands.
  const streets = el('g', { class: 'streets' });
  for (let c = 1; c < 4; c++) {
    const x = PAD + c * (CELL_W + GAP) - GAP / 2;
    streets.appendChild(el('line', { x1: x, y1: PAD, x2: x, y2: VIEW_H - PAD, class: 'street' }));
  }
  for (let r = 1; r < 3; r++) {
    const y = PAD + r * (CELL_H + GAP) - GAP / 2;
    streets.appendChild(el('line', { x1: PAD, y1: y, x2: VIEW_W - PAD, y2: y, class: 'street' }));
  }
  svg.appendChild(streets);

  const plots = el('g', { class: 'plots' });
  for (const p of geo.plots) {
    const g = el('g', { class: 'plot', 'data-guild': p.guild.id });
    g.appendChild(el('rect', {
      x: p.x, y: p.y, width: p.w, height: p.h, rx: 4,
      class: 'plot-fill', style: `--tint:${p.guild.color}`,
    }));
    g.appendChild(text(p.plate, { x: p.x + 12, y: p.y + 19, class: 'plate' }));
    g.appendChild(text(p.guild.name.replace(' Guild', '').toUpperCase(), { x: p.x + 46, y: p.y + 19, class: 'plot-name' }));
    g.appendChild(text(p.guild.domain, { x: p.x + 12, y: p.y + 32, class: 'plot-domain' }));
    plots.appendChild(g);
  }
  svg.appendChild(plots);

  const blocks = el('g', { class: 'blocks' });
  for (const id of Object.keys(geo.buildings)) {
    const b = geo.buildings[id];
    const g = el('g', { class: 'block', 'data-building': id, tabindex: '0' });
    g.appendChild(el('rect', {
      x: b.x, y: b.y, width: b.w, height: b.h, rx: 3,
      class: 'block-fill', style: `--tint:${b.guild.color}`,
    }));
    g.appendChild(text(b.building.emoji, { x: b.cx, y: b.y + 30, class: 'block-glyph', 'text-anchor': 'middle' }));
    // Wrap the building name onto two lines so nothing overflows its block.
    const words = b.building.name.split(' ');
    const lines = words.length > 2 ? [words.slice(0, -1).join(' '), words.slice(-1)[0]] : words;
    lines.forEach((ln, i) => {
      g.appendChild(text(ln, { x: b.cx, y: b.y + 48 + i * 11, class: 'block-name', 'text-anchor': 'middle' }));
    });
    g.appendChild(text('', { x: b.cx, y: b.y + b.h - 8, class: 'block-staff', 'text-anchor': 'middle', 'data-staff': id }));
    const title = el('title');
    title.textContent = `${b.building.name} — ${b.building.blurb}`;
    g.appendChild(title);
    blocks.appendChild(g);
  }
  svg.appendChild(blocks);

  svg.appendChild(el('g', { class: 'pins', id: 'pin-layer' }));
}

export function drawPins(svg, geo, town, selectedId) {
  const layer = svg.querySelector('#pin-layer');
  const slots = {};
  const staff = {};
  const totals = {};
  const where = (c) => (c.stage === 'employed' ? c.post.buildingId : c.location);
  for (const c of town.citizens) totals[where(c)] = (totals[where(c)] || 0) + 1;

  for (const c of town.citizens) {
    const loc = where(c);
    const slot = (slots[loc] = (slots[loc] ?? -1) + 1);
    const { x, y } = pinSlot(geo, loc, slot, totals[loc]);
    if (c.stage === 'employed') staff[loc] = (staff[loc] || 0) + 1;

    let pin = layer.querySelector(`[data-pin="${c.id}"]`);
    if (!pin) {
      pin = el('g', { class: 'pin', 'data-pin': c.id, tabindex: '0' });
      pin.appendChild(el('circle', { r: 4, class: 'pin-dot' }));
      const title = el('title');
      title.textContent = c.name;
      pin.appendChild(title);
      layer.appendChild(pin);
    }
    pin.setAttribute('transform', `translate(${x.toFixed(1)} ${y.toFixed(1)})`);
    pin.setAttribute('data-stage', c.stage);
    pin.setAttribute('style', `--tint:${GUILDS[c.guildIndex].color}`);
    pin.classList.toggle('is-selected', c.id === selectedId);
    pin.querySelector('title').textContent =
      c.stage === 'employed' ? `${c.name} — ${c.role}` : `${c.name} — ${c.stage}`;
  }

  for (const id of Object.keys(geo.buildings)) {
    const label = svg.querySelector(`[data-staff="${id}"]`);
    if (label) {
      const n = staff[id] || 0;
      const seats = geo.buildings[id].building.posts.reduce((a, p) => a + p.seats, 0);
      label.textContent = n ? `${n}/${seats} staffed` : `${seats} posts open`;
      label.classList.toggle('is-empty', n === 0);
    }
  }
}

export { GUILDS, BUILDINGS, RESOURCES, BUILDING_BY_ID, performanceBand, seniority };
