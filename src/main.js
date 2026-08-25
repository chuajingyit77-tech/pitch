// Wires the simulation to the operations board.

import { createTown, tick, stats, performanceBand, seniority, issueDecree, note, creditWorkshop } from './engine.js';
import { GUILDS, RESOURCES, BUILDINGS, COURSES } from './data.js';
import { parseDecree, DECREE_BY_KEY, QUICK_DECREES, decreeCostText } from './decrees.js';
import { digestSource, docToMarkdown, slugify, isAccepted, isPdf, fileTooLarge, totalTooLarge } from './workshop.js';
import { extractPdfText } from './pdf.js';
import { DELIVERABLES, DELIVERABLE_BY_ID, assemble } from './deliverables.js';
import { computeGeometry, drawMap, drawPins, startSky } from './view.js';

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
let wsSources = [];
let wsLang = 'en';
let wsKind = 'proposal';
let wsDoc = null;
const WS_KEY = 'gradient-town-workshop';

const svg = $('map');
drawMap(svg, geo);
startSky($('sky'));

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

function renderActiveDecrees() {
  const box = $('active-decrees');
  box.innerHTML = town.decrees
    .filter((d) => !d.instant)
    .map((d) => {
      const left = Math.max(0, d.until - town.day);
      return `<span class="decree-badge">${d.emoji} ${d.name} <b>${left}d</b></span>`;
    })
    .join('');
}

function renderQuickDecrees() {
  $('quick-decrees').innerHTML = QUICK_DECREES.map((key) => {
    const d = DECREE_BY_KEY[key];
    return `<button type="button" data-decree="${key}" title="${d.blurb} (${decreeCostText(d)})">
      <span aria-hidden="true">${d.emoji}</span> ${d.name} <span class="cost">${decreeCostText(d)}</span>
    </button>`;
  }).join('');
}

function saySomething(text, kind) {
  const box = $('decree-feedback');
  box.textContent = text;
  box.className = `decree-feedback ${kind}`;
}

function order(key, spoken) {
  if (!key) {
    saySomething(`I couldn't read that order — try “focus on food”, “hold a festival”, or pick one below.`, 'err');
    return;
  }
  const result = issueDecree(town, key);
  saySomething(`${result.ok ? '✓' : '✗'} ${result.message}`, result.ok ? 'ok' : 'err');
  if (result.ok && spoken) $('decree-input').value = '';
  render();
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
      ${c.workshopJobs ? `<div class="kv"><span>Workshop pieces</span><span>${c.workshopJobs}</span></div>` : ''}
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
  renderActiveDecrees();
  drawPins(svg, geo, town, selected);
  if (selected) renderDossier();
}


/* ------------------------------------------------------------ workshop */

const esc = (v) => String(v)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

const guildTint = (name) => (GUILDS.find((g) => g.name === name) || {}).color || '#d4a373';

function renderKinds() {
  $('kinds').innerHTML = DELIVERABLES.map((d) => `<button type="button" data-kind="${d.id}" aria-pressed="${
    d.id === wsKind}"><span aria-hidden="true">${d.emoji}</span> ${wsLang === 'zh' ? d.zh : d.en}</button>`).join('');
  const spec = DELIVERABLE_BY_ID[wsKind];
  $('make').textContent = wsLang === 'zh' ? spec.ctaZh : spec.ctaEn;
}

function wsSay(text, kind = '') {
  const box = $('ws-status');
  box.textContent = text;
  box.className = `note ${kind}`;
}

function saveWorkshop() {
  try {
    localStorage.setItem(WS_KEY, JSON.stringify({ sources: wsSources, brief: readBrief(), lang: wsLang, kind: wsKind }));
  } catch { /* private browsing, or the drawer is full — the page still works */ }
}

function loadWorkshop() {
  let saved = null;
  try { saved = JSON.parse(localStorage.getItem(WS_KEY) || 'null'); } catch { saved = null; }
  if (!saved) return;
  wsSources = Array.isArray(saved.sources) ? saved.sources : [];
  wsLang = saved.lang === 'zh' ? 'zh' : 'en';
  if (DELIVERABLE_BY_ID[saved.kind]) wsKind = saved.kind;
  const b = saved.brief || {};
  $('f-title').value = b.title || '';
  $('f-client').value = b.client || '';
  $('f-goal').value = b.goal || '';
  $('f-points').value = (b.points || []).join('\n');
  $('f-budget').value = b.budget || '';
  $('f-timeline').value = b.timeline || '';
  document.querySelectorAll('.langs button').forEach((x) => x.setAttribute('aria-pressed', String(x.dataset.lang === wsLang)));
  renderKinds();
  renderSources();
}

function readBrief() {
  return {
    title: $('f-title').value.trim(),
    client: $('f-client').value.trim(),
    goal: $('f-goal').value.trim(),
    points: $('f-points').value.split('\n').map((x) => x.trim()).filter(Boolean),
    budget: $('f-budget').value.trim(),
    timeline: $('f-timeline').value.trim(),
  };
}

function renderSources() {
  const box = $('sources');
  box.innerHTML = wsSources
    .map((s, i) => `<div class="source">
      <span class="nm">${esc(s.name)}</span>
      ${s.pages ? `<span class="kind">PDF · ${s.pages}p</span>` : ''}
      <span class="meta">${s.highlights.length} pts · ${(s.chars / 1000).toFixed(1)}k</span>
      <button class="drop-one" data-drop="${i}" title="Remove" aria-label="Remove ${esc(s.name)}">×</button>
    </div>`)
    .join('');
}

function addSource(name, text, extra = {}) {
  const total = wsSources.reduce((a, s) => a + s.chars, 0) + text.length;
  if (totalTooLarge(total)) {
    wsSay('That is more material than the workshop can hold — remove a file first.', 'err');
    return false;
  }
  wsSources.push({ ...digestSource(name, text), ...extra });
  renderSources();
  saveWorkshop();
  return true;
}

const PDF_TROUBLE = {
  'not-pdf': 'that file is not really a PDF',
  encrypted: 'that PDF is password-protected',
  'no-text': 'that PDF has no text in it — it is probably a scan',
  unreadable: 'the text in that PDF did not come out legibly',
};

async function readOneFile(file) {
  if (!isAccepted(file.name)) {
    wsSay(`${file.name} is not a kind the town reads — paste its contents into the box instead.`, 'err');
    return false;
  }
  if (fileTooLarge(file.size)) {
    wsSay(`${file.name} is too large (over 8 MB).`, 'err');
    return false;
  }
  if (isPdf(file.name)) {
    const result = await extractPdfText(await file.arrayBuffer());
    if (!result.ok) {
      wsSay(`${file.name}: ${PDF_TROUBLE[result.reason] || 'the text could not be read'}. Copy the text and paste it in instead.`, 'err');
      return false;
    }
    return addSource(file.name, result.text, { pages: result.pages });
  }
  const text = await file.text();
  return addSource(file.name, text);
}

let wsQueue = Promise.resolve();

// Reads are queued: dropping a second file while the first is still being read
// must not interleave two updates to the same list.
function takeFiles(fileList) {
  const files = [...fileList];
  if (!files.length) return wsQueue;
  wsQueue = wsQueue.then(() => readFiles(files));
  return wsQueue;
}

async function readFiles(files) {
  wsSay('Reading…', '');
  let added = 0;
  for (const file of files) {
    try {
      if (await readOneFile(file)) added++;
    } catch {
      wsSay(`Could not read ${file.name}.`, 'err');
    }
  }
  if (added) wsSay(`${wsSources.length} source${wsSources.length === 1 ? '' : 's'} ready`, 'ok');
}

function blocksToHtml(blocks) {
  return blocks.map((b) => {
    if (b.type === 'p') return `<p>${esc(b.text)}</p>`;
    if (b.type === 'list') return `<ul>${b.items.map((i) => `<li>${esc(i)}</li>`).join('')}</ul>`;
    if (b.type === 'quotes') return b.items.map((i) => `<blockquote>${esc(i)}</blockquote>`).join('');
    if (b.type === 'table') {
      return `<div class="ws-table-wrap"><table class="ws-table">
        <thead><tr>${b.head.map((h) => `<th>${esc(h)}</th>`).join('')}</tr></thead>
        <tbody>${b.rows.map((r) => `<tr>${r.map((c, i) => `<td${i === r.length - 1 ? ' class="src"' : ''}>${esc(c)}</td>`).join('')}</tr>`).join('')}</tbody>
      </table></div>`;
    }
    if (b.type === 'checklist') {
      return `<ul class="ws-checklist">${b.items.map((i) => `<li><button type="button" class="tick" data-copy-line>${
        wsLang === 'zh' ? '复制' : 'Copy'}</button><span>${esc(i)}</span></li>`).join('')}</ul>`;
    }
    if (b.type === 'prompt') {
      return `<div class="ws-prompt">
        <button type="button" class="ctl copy-prompt" data-copy-prompt>${
          wsLang === 'zh' ? '复制这段 prompt' : 'Copy this prompt'}</button>
        <pre>${esc(b.text)}</pre>
      </div>`;
    }
    if (b.type === 'steps') {
      return b.items.map((i) => `<div class="ws-step"><span class="n">${i.n}</span><span>${
        i.text ? `<b>${esc(i.name)}</b> — ${esc(i.text)}` : esc(i.name)
      }</span></div>`).join('');
    }
    return '';
  }).join('');
}

function renderProposal() {
  const box = $('ws-doc');
  if (!wsDoc) {
    box.innerHTML = '<p class="ws-empty">Give the town something to work with — a few points is enough. Your material stays in this browser.</p>';
    return;
  }
  box.innerHTML = `
    <h3>${esc(wsDoc.title)}</h3>
    <p class="doc-sub">${esc(wsDoc.subtitle)}</p>
    ${wsDoc.sections.map((s) => `<section class="ws-sec">
      <h4>${esc(s.heading)}${s.status ? `<span class="tag ${esc(s.status)}">${
        s.status === 'good' ? (wsDoc.lang === 'zh' ? '通过' : 'OK') : wsDoc.lang === 'zh' ? '要看' : 'Look'
      }</span>` : ''}</h4>
      ${blocksToHtml(s.blocks)}
      ${s.author ? `<span class="ws-by" style="--tint:${guildTint(s.author.guild)}"><i></i>${
        esc(s.author.name)} · ${esc(s.author.role)} · ${esc(s.author.guild)}</span>` : ''}
    </section>`).join('')}
    <p class="ws-note">${esc(wsDoc.note)}</p>`;
  box.scrollTop = 0;
}

function lightUpAuthors(doc) {
  document.querySelectorAll('.pin.is-working').forEach((p) => p.classList.remove('is-working'));
  const ids = doc.sections.map((s) => s.author && s.author.id).filter(Boolean);
  for (const id of ids) {
    const pin = svg.querySelector(`[data-pin="${id}"]`);
    if (pin) pin.classList.add('is-working');
  }
  clearTimeout(lightUpAuthors.timer);
  lightUpAuthors.timer = setTimeout(() => {
    document.querySelectorAll('.pin.is-working').forEach((p) => p.classList.remove('is-working'));
  }, 12000);
}

function makeProposal() {
  const brief = readBrief();
  const pasted = $('paste').value.trim();
  if (pasted) {
    addSource(wsLang === 'zh' ? '贴上的资料' : 'Pasted notes', pasted);
    $('paste').value = '';
  }
  if (!brief.title && !brief.goal && !brief.points.length && !wsSources.length) {
    wsSay('Tell the town what it is, or hand it some material first.', 'err');
    return;
  }
  wsDoc = assemble(wsKind, brief, wsSources, town, wsLang);
  renderProposal();
  lightUpAuthors(wsDoc);
  $('export-md').hidden = false;
  $('copy-md').hidden = false;
  const signed = wsDoc.sections.filter((s) => s.author).length;
  const spec = DELIVERABLE_BY_ID[wsKind];
  creditWorkshop(town, wsDoc.sections.map((s) => s.author && s.author.id), spec.en.toLowerCase());
  wsSay(wsLang === 'zh'
    ? `${spec.zh}已备好 · ${wsDoc.sections.length} 节 · ${signed} 人署名`
    : `${spec.en} ready · ${wsDoc.sections.length} sections · ${signed} signed`, 'ok');
  note(town, 'town', `${spec.emoji} The Workshop: ${spec.en.toLowerCase()} assembled by ${signed} citizens from ${wsSources.length} source${wsSources.length === 1 ? '' : 's'}.`);
  saveWorkshop();
  renderLog();
}

async function exportMarkdown() {
  if (!wsDoc) return;
  const filename = `${slugify(wsDoc.title)}-${wsDoc.kind}.md`;
  const data = docToMarkdown(wsDoc);
  try {
    const downloads = window.claude && typeof window.claude.use === 'function'
      ? await window.claude.use('downloads')
      : null;
    if (downloads) {
      await downloads.save({ filename, data });
      wsSay(`Saved as ${filename}`, 'ok');
      return;
    }
  } catch (err) {
    if (err && err.code === 'declined') { wsSay('Save cancelled.', ''); return; }
    wsSay('Could not save the file — use Copy instead.', 'err');
    return;
  }
  // Outside the artifact viewer a plain download link still works.
  const url = URL.createObjectURL(new Blob([data], { type: 'text/markdown' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
  wsSay(`Saved as ${filename}`, 'ok');
}

async function copyMarkdown() {
  if (!wsDoc) return;
  try {
    await navigator.clipboard.writeText(docToMarkdown(wsDoc));
    wsSay('Copied to the clipboard', 'ok');
  } catch {
    wsSay('Could not copy — select the text and copy it by hand.', 'err');
  }
}

function wireWorkshop() {
  const drop = $('drop');
  $('files').addEventListener('change', (e) => { takeFiles(e.target.files); e.target.value = ''; });
  for (const type of ['dragenter', 'dragover']) {
    drop.addEventListener(type, (e) => { e.preventDefault(); drop.classList.add('over'); });
  }
  for (const type of ['dragleave', 'drop']) {
    drop.addEventListener(type, (e) => { e.preventDefault(); drop.classList.remove('over'); });
  }
  drop.addEventListener('drop', (e) => takeFiles(e.dataTransfer.files));

  $('sources').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-drop]');
    if (!btn) return;
    wsSources.splice(Number(btn.dataset.drop), 1);
    renderSources();
    saveWorkshop();
  });

  document.querySelectorAll('.langs button').forEach((b) => {
    b.addEventListener('click', () => {
      wsLang = b.dataset.lang;
      document.querySelectorAll('.langs button').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
      renderKinds();
      if (wsDoc) makeProposal();
      saveWorkshop();
    });
  });

  $('kinds').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-kind]');
    if (!btn) return;
    wsKind = btn.dataset.kind;
    renderKinds();
    if (wsDoc) makeProposal();
    saveWorkshop();
  });

  $('make').addEventListener('click', makeProposal);
  $('export-md').addEventListener('click', exportMarkdown);
  $('copy-md').addEventListener('click', copyMarkdown);
  for (const id of ['f-title', 'f-client', 'f-goal', 'f-points', 'f-budget', 'f-timeline']) {
    $(id).addEventListener('change', saveWorkshop);
  }
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

$('decree-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const text = $('decree-input').value;
  order(parseDecree(text), true);
});

$('quick-decrees').addEventListener('click', (e) => {
  const btn = e.target.closest('[data-decree]');
  if (btn) order(btn.dataset.decree, false);
});

$('play').addEventListener('click', () => setRunning(!timer));
$('step').addEventListener('click', () => { setRunning(false); advance(); });
$('reset').addEventListener('click', () => {
  setRunning(false);
  town = createTown(66);
  selected = null;
  $('dossier').classList.remove('open');
  saySomething('', '');
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

$('ws-doc').addEventListener('click', async (e) => {
  const line = e.target.closest('[data-copy-line]');
  if (line) {
    try {
      await navigator.clipboard.writeText(line.parentElement.querySelector('span').textContent);
      line.textContent = wsLang === 'zh' ? '已复制' : 'Copied';
      setTimeout(() => { line.textContent = wsLang === 'zh' ? '复制' : 'Copy'; }, 1800);
    } catch { /* the text is on screen either way */ }
    return;
  }
  const btn = e.target.closest('[data-copy-prompt]');
  if (!btn) return;
  const text = btn.parentElement.querySelector('pre').textContent;
  try {
    await navigator.clipboard.writeText(text);
    btn.textContent = wsLang === 'zh' ? '已复制 ✓' : 'Copied ✓';
    setTimeout(() => { btn.textContent = wsLang === 'zh' ? '复制这段 prompt' : 'Copy this prompt'; }, 2200);
  } catch {
    wsSay(wsLang === 'zh' ? '复制失败——请手动选取。' : 'Could not copy — select the text by hand.', 'err');
  }
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

renderQuickDecrees();
renderKinds();
wireWorkshop();
loadWorkshop();
render();
setRunning(true);
