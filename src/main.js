// Wires the simulation to the operations board.

import { createTown, tick, stats, performanceBand, seniority } from './engine.js';
import { GUILDS, RESOURCES, BUILDINGS, COURSES } from './data.js';
import { computeGeometry, drawMap, drawPins } from './view.js';

const $ = (id) => document.getElementById(id);
const guildById = Object.fromEntries(GUILDS.map((g) => [g.id, g]));
const bldById = Object.fromEntries(BUILDINGS.map((b) => [b.id, b]));
const SCALE = 520; // full bar for the stores gauges

let town = createTown(66);
let geo = computeGeometry();
let timer = null;
let speed = 260;
let filter = 'all';
let selected = null;

const svg = $('map');
drawMap(svg, geo);

/* ------------------------------------------------------------ rendering */

function renderPipeline(s) {
  $('day').textContent = town.day;
  $('n-study').textContent = s.students;
  $('n-grad').textContent = s.graduates;
  $('n-work').textContent = s.employed;
  $('m-perf').textContent = s.employed ? `${Math.round(s.avgPerformance * 100)}%` : '—';
  $('m-gpa').textContent = s.avgGpa ? s.avgGpa.toFixed(2) : '—';
  $('m-well').textContent = `${Math.round(s.wellbeing * 100)}%`;
  $('m-open').textContent = s.openPosts;
  $('pipe-note').textContent = s.employed === 66 ? 'fully placed' : `${s.totals.hires} placed so far`;
  $('legend-tail').textContent = town.fullEmploymentDay
    ? `All 66 placed on day ${town.fullEmploymentDay}`
    : '';
}

function renderResources() {
  const list = $('res-list');
  if (!list.children.length) {
    for (const r of RESOURCES) {
      const row = document.createElement('div');
      row.className = 'res';
      row.style.setProperty('--tint', r.color);
      row.innerHTML = `<span aria-hidden="true">${r.emoji}</span>
        <span class="name">${r.name}</span>
        <span><span class="amt" data-amt="${r.id}">0</span> <span class="flow" data-flow="${r.id}"></span></span>
        <span class="bar"><span data-bar="${r.id}" style="width:0%"></span></span>`;
      list.appendChild(row);
    }
  }
  for (const r of RESOURCES) {
    const stock = town.resources[r.id];
    const flow = town.flows[r.id] || 0;
    list.querySelector(`[data-amt="${r.id}"]`).textContent = Math.round(stock);
    const f = list.querySelector(`[data-flow="${r.id}"]`);
    f.textContent = `${flow >= 0 ? '+' : ''}${flow.toFixed(1)}`;
    f.classList.toggle('neg', flow < 0);
    list.querySelector(`[data-bar="${r.id}"]`).style.width = `${Math.min(100, (stock / SCALE) * 100)}%`;
  }
}

function renderLog() {
  const box = $('log');
  box.innerHTML = town.log
    .slice(0, 40)
    .map((e) => `<div class="entry" data-kind="${e.kind}"><span class="d">D${String(e.day).padStart(3, '0')}</span><span class="t">${e.text}</span></div>`)
    .join('');
  $('log-note').textContent = `${town.ledger.graduates} graduated · ${town.ledger.hires} hired`;
}

function visible() {
  return town.citizens.filter((c) => filter === 'all' || c.stage === filter);
}

function renderRoster() {
  const box = $('roster');
  box.innerHTML = visible()
    .map((c) => {
      const g = guildById[c.guild];
      const perf = c.stage === 'employed' ? c.performance : c.mastery;
      const band = c.stage === 'employed' ? performanceBand(c.performance).label : null;
      const role = c.stage === 'employed'
        ? `${c.role} · ${bldById[c.post.buildingId].name}`
        : c.stage === 'graduate'
          ? `${c.honours.label} — awaiting placement`
          : `Studying · ${Math.round(c.mastery * 100)}% mastery`;
      const foot = c.stage === 'employed'
        ? `<span>${band}</span><span>${Math.round(c.performance * 100)}%</span>`
        : `<span>${g.name.replace(' Guild', '')}</span><span>${c.stage === 'graduate' ? c.gpa.toFixed(2) : 'in class'}</span>`;
      return `<button class="card${c.id === selected ? ' is-selected' : ''}" data-citizen="${c.id}" style="--tint:${g.color}">
        <span class="top"><i class="dot"></i><span class="nm">${c.name}</span><span class="lv">${c.stage === 'employed' ? 'L' + c.level : ''}</span></span>
        <span class="role">${role}</span>
        <span class="meter"><span style="width:${Math.round(perf * 100)}%;background:${c.stage === 'employed' ? 'var(--good)' : 'var(--brass)'}"></span></span>
        <span class="foot">${foot}</span>
      </button>`;
    })
    .join('');
}

function renderDossier() {
  const c = town.citizens.find((x) => x.id === selected);
  const panel = $('dossier');
  if (!c) {
    panel.classList.remove('open');
    panel.setAttribute('aria-hidden', 'true');
    return;
  }
  const g = guildById[c.guild];
  const b = c.post ? bldById[c.post.buildingId] : null;
  const mentor = c.mentor ? town.citizens.find((m) => m.id === c.mentor) : null;
  const apt = Object.entries(c.aptitudes).sort((a, z) => z[1] - a[1]).slice(0, 5);
  const status = c.stage === 'employed'
    ? `${seniority(c.level)} · ${c.role}`
    : c.stage === 'graduate' ? `${c.honours.label} · awaiting placement` : 'Student, Gradient Academy';

  $('dossier-body').innerHTML = `
    <h3>${c.name}</h3>
    <p class="sub">${g.emoji} ${g.name} &middot; ${status}</p>

    <div class="dsec">
      <h4>Standing</h4>
      ${c.stage === 'employed' ? `
        <div class="kv"><span>Posted to</span><span>${b.name}</span></div>
        <div class="kv"><span>Performance</span><span>${Math.round(c.performance * 100)}% · ${performanceBand(c.performance).label}</span></div>
        <div class="kv"><span>Level</span><span>${c.level} · ${seniority(c.level)}</span></div>
        <div class="kv"><span>Hired on</span><span>Day ${c.hiredOn}</span></div>` : ''}
      ${c.gpa ? `<div class="kv"><span>Final GPA</span><span>${c.gpa.toFixed(2)} · ${c.honours.label}</span></div>` : ''}
      ${c.stage === 'student' ? `<div class="kv"><span>Mastery</span><span>${Math.round(c.mastery * 100)}%</span></div>` : ''}
      <div class="kv"><span>Wellbeing</span><span>${Math.round(c.wellbeing * 100)}%</span></div>
      ${mentor ? `<div class="kv"><span>Mentor</span><span>${mentor.name}</span></div>` : ''}
    </div>

    <div class="dsec">
      <h4>Academy transcript</h4>
      <div class="transcript">
        ${COURSES.map((co) => `<div class="course"><span aria-hidden="true">${co.emoji}</span>
          <span class="cinfo"><span class="cname">${co.name}</span><span class="track"><span style="width:${Math.round(c.courses[co.id] * 100)}%"></span></span></span>
          <span class="g">${c.courses[co.id] ? Math.round(c.courses[co.id] * 100) : '—'}</span></div>`).join('')}
      </div>
    </div>

    <div class="dsec">
      <h4>Strongest aptitudes</h4>
      ${apt.map(([k, v]) => `<div class="apt"><span class="lbl">${k}</span><span class="track"><span style="width:${Math.round(v * 100)}%"></span></span><span class="val">${Math.round(v * 100)}</span></div>`).join('')}
    </div>

    <div class="dsec">
      <h4>Record</h4>
      ${c.highlights.length ? c.highlights.slice(-6).reverse().map((h) => `<p class="hl">${h}</p>`).join('') : '<p class="hl">Still in class — first term.</p>'}
    </div>`;
  panel.classList.add('open');
  panel.setAttribute('aria-hidden', 'false');
}

function render() {
  const s = stats(town);
  renderPipeline(s);
  renderResources();
  renderLog();
  renderRoster();
  drawPins(svg, geo, town, selected);
  if (selected) renderDossier();
}

/* ------------------------------------------------------------ controls */

function advance() {
  tick(town);
  render();
}

function setRunning(on) {
  clearInterval(timer);
  timer = on ? setInterval(advance, speed) : null;
  const btn = $('play');
  btn.textContent = on ? 'Pause' : 'Run';
  btn.classList.toggle('running', on);
}

$('play').addEventListener('click', () => setRunning(!timer));
$('step').addEventListener('click', () => { setRunning(false); advance(); });
$('reset').addEventListener('click', () => {
  setRunning(false);
  town = createTown(66);
  selected = null;
  $('dossier').classList.remove('open');
  render();
});

document.querySelectorAll('.speeds button').forEach((b) => {
  b.addEventListener('click', () => {
    speed = Number(b.dataset.speed);
    document.querySelectorAll('.speeds button').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
    if (timer) setRunning(true);
  });
});

document.querySelectorAll('.chip').forEach((b) => {
  b.addEventListener('click', () => {
    filter = b.dataset.filter;
    document.querySelectorAll('.chip').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
    renderRoster();
  });
});

$('roster').addEventListener('click', (e) => {
  const card = e.target.closest('[data-citizen]');
  if (!card) return;
  selected = card.dataset.citizen;
  renderRoster();
  drawPins(svg, geo, town, selected);
  renderDossier();
});

svg.addEventListener('click', (e) => {
  const pin = e.target.closest('[data-pin]');
  if (!pin) return;
  selected = pin.dataset.pin;
  renderRoster();
  drawPins(svg, geo, town, selected);
  renderDossier();
});

$('dossier-close').addEventListener('click', () => {
  selected = null;
  $('dossier').classList.remove('open');
  $('dossier').setAttribute('aria-hidden', 'true');
  renderRoster();
  drawPins(svg, geo, town, selected);
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && selected) $('dossier-close').click();
  if (e.key === ' ' && e.target === document.body) { e.preventDefault(); setRunning(!timer); }
});

render();
setRunning(true);
