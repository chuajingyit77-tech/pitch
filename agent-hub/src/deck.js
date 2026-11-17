// Turns a structured deck (slides as data) into one self-contained HTML file.
// The model decides the story; this renderer owns the look, so every deck is consistent and readable.

const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

export const LAYOUTS = ['cover', 'statement', 'bullets', 'stats', 'compare', 'quote', 'chart', 'closing'];

const LIMITS = { title: 90, body: 320, bullet: 130, bullets: 6, stats: 4, bars: 7 };

function visibleText(slide) {
  const parts = [slide.kicker, slide.title, slide.body, slide.cta, ...(slide.bullets || [])];
  for (const s of slide.stats || []) parts.push(s.value, s.label);
  for (const c of slide.columns || []) parts.push(c.heading, ...(c.points || []));
  if (slide.quote) parts.push(slide.quote.text, slide.quote.by);
  for (const b of slide.chart?.bars || []) parts.push(b.label, String(b.value));
  return parts.filter(Boolean).join(' \n ');
}

const NUM = /\d[\d,]*(?:\.\d+)?/g;
const norm = (n) => n.replace(/,/g, '').replace(/\.0+$/, '');

/** Numbers worth checking: skips years and small bare counts like "3 steps". */
function claimsIn(text) {
  const found = new Set();
  for (const m of text.matchAll(NUM)) {
    const n = norm(m[0]);
    const value = Number(n);
    const next = text.slice(m.index + m[0].length, m.index + m[0].length + 2);
    const prev = text[m.index - 1] || '';
    const hasUnit = /^(%|\s?%|[kKmMbB万亿倍xX])/.test(next) || /[$¥€£]/.test(prev);
    if (!hasUnit && Number.isInteger(value) && (value <= 10 || (value >= 1900 && value <= 2100))) continue;
    found.add(n);
  }
  return found;
}

/**
 * Check a deck against the fact sheet and the layout limits.
 * Returns the warnings for the model, and which slides carry numbers no fact backs up.
 */
export function reviewDeck(deck, facts) {
  const warnings = [];
  const known = new Set();
  for (const f of facts) for (const m of String(f.claim).matchAll(NUM)) known.add(norm(m[0]));
  const unverified = [];
  deck.slides.forEach((s, i) => {
    const n = i + 1;
    if (!LAYOUTS.includes(s.layout)) warnings.push(`Slide ${n}: unknown layout "${s.layout}", rendered as "statement".`);
    if ((s.title || '').length > LIMITS.title) warnings.push(`Slide ${n}: title is ${s.title.length} characters; keep it under ${LIMITS.title}.`);
    if ((s.body || '').length > LIMITS.body) warnings.push(`Slide ${n}: body is too long for one screen; cut it to under ${LIMITS.body} characters.`);
    if ((s.bullets || []).length > LIMITS.bullets) warnings.push(`Slide ${n}: ${s.bullets.length} bullets; use at most ${LIMITS.bullets} or split the slide.`);
    for (const b of s.bullets || []) if (b.length > LIMITS.bullet) warnings.push(`Slide ${n}: a bullet is over ${LIMITS.bullet} characters.`);
    if ((s.stats || []).length > LIMITS.stats) warnings.push(`Slide ${n}: at most ${LIMITS.stats} stats fit on one slide.`);
    if ((s.chart?.bars || []).length > LIMITS.bars) warnings.push(`Slide ${n}: at most ${LIMITS.bars} bars fit in one chart.`);
    const missing = [...claimsIn(visibleText(s))].filter((x) => !known.has(x));
    if (missing.length) {
      unverified[i] = missing;
      warnings.push(
        `Slide ${n}: the numbers ${missing.join(', ')} are not in the fact sheet. Save a sourced fact for each with save_fact, or remove them. Until then the slide is marked "to be confirmed".`,
      );
    }
  });
  return { warnings, unverified };
}

function slideHtml(s, i, total, flagged) {
  const layout = LAYOUTS.includes(s.layout) ? s.layout : 'statement';
  const kicker = s.kicker ? `<p class="kicker">${esc(s.kicker)}</p>` : '';
  const title = s.title ? `<h2>${esc(s.title)}</h2>` : '';
  const body = s.body ? `<p class="body">${esc(s.body)}</p>` : '';
  let inner = '';
  if (layout === 'cover' || layout === 'closing') {
    inner = `${kicker}<h1>${esc(s.title)}</h1>${body}${s.cta ? `<p class="cta">${esc(s.cta)}</p>` : ''}`;
  } else if (layout === 'bullets') {
    inner = `${kicker}${title}${body}<ul class="bullets">${(s.bullets || []).map((b) => `<li>${esc(b)}</li>`).join('')}</ul>`;
  } else if (layout === 'stats') {
    inner = `${kicker}${title}<div class="stats">${(s.stats || [])
      .map((x) => `<div class="stat"><div class="value">${esc(x.value)}</div><div class="label">${esc(x.label)}</div></div>`)
      .join('')}</div>${body}`;
  } else if (layout === 'compare') {
    inner = `${kicker}${title}<div class="columns">${(s.columns || [])
      .slice(0, 2)
      .map(
        (c, k) =>
          `<div class="col${k === 1 ? ' strong' : ''}"><h3>${esc(c.heading)}</h3><ul>${(c.points || []).map((p) => `<li>${esc(p)}</li>`).join('')}</ul></div>`,
      )
      .join('')}</div>`;
  } else if (layout === 'quote') {
    inner = `${kicker}<blockquote>${esc(s.quote?.text || s.title)}</blockquote>${s.quote?.by ? `<p class="by">${esc(s.quote.by)}</p>` : ''}`;
  } else if (layout === 'chart') {
    const bars = s.chart?.bars || [];
    const max = Math.max(...bars.map((b) => Number(b.value) || 0), 1);
    inner = `${kicker}${title}<div class="chart">${bars
      .map((b) => {
        const v = Number(b.value) || 0;
        return `<div class="bar-row"><span class="bar-label">${esc(b.label)}</span><span class="bar-track"><span class="bar" style="width:${Math.max(2, (v / max) * 100).toFixed(1)}%"></span></span><span class="bar-value">${esc(b.value)}${esc(s.chart?.unit || '')}</span></div>`;
      })
      .join('')}</div>${body}`;
  } else {
    inner = `${kicker}<h2 class="big">${esc(s.title)}</h2>${body}`;
  }
  const badge = flagged ? `<span class="flag" title="${esc(flagged.join(', '))}">待确认 · 数据未核实</span>` : '';
  const notes = s.notes ? `<aside class="notes">${esc(s.notes)}</aside>` : '';
  return `<section class="slide ${layout}" data-n="${i + 1}"><div class="wrap">${inner}</div>${badge}${notes}<span class="page">${i + 1} / ${total}</span></section>`;
}

export function renderDeck(deck, facts = []) {
  const accent = /^#[0-9a-f]{6}$/i.test(deck.accent || '') ? deck.accent : '#2b50ff';
  const { unverified } = reviewDeck(deck, facts);
  const sources = [...new Map(facts.filter((f) => f.source).map((f) => [f.source, f])).values()];
  const slides = [...deck.slides];
  const total = slides.length + (sources.length ? 1 : 0);
  let html = slides.map((s, i) => slideHtml(s, i, total, unverified[i])).join('\n');
  if (sources.length) {
    html += `\n<section class="slide sources" data-n="${total}"><div class="wrap"><p class="kicker">Sources</p><h2>数据来源</h2><ol>${sources
      .slice(0, 14)
      .map((f) => `<li><span>${esc(f.claim)}</span><a href="${esc(f.source)}" target="_blank" rel="noopener">${esc(f.source)}</a></li>`)
      .join('')}</ol></div><span class="page">${total} / ${total}</span></section>`;
  }
  return `<!doctype html>
<html lang="${esc(deck.lang || 'zh')}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(deck.title)}</title>
<style>
:root{--accent:${accent};--ink:#14161a;--muted:#5b616b;--paper:#faf9f6;--line:#e4e1da;--dark:#101216}
*{box-sizing:border-box;margin:0}
html{scroll-snap-type:y proximity;scroll-behavior:smooth}
body{font-family:Inter,-apple-system,"Segoe UI","PingFang SC","Noto Sans SC","Microsoft YaHei",sans-serif;color:var(--ink);background:var(--paper);-webkit-font-smoothing:antialiased}
.slide{position:relative;min-height:100vh;min-height:100dvh;display:flex;align-items:center;scroll-snap-align:start;padding:clamp(28px,6vw,96px);border-bottom:1px solid var(--line)}
.wrap{width:100%;max-width:1120px;margin:0 auto;overflow-wrap:anywhere}
.kicker{font-size:clamp(12px,1.1vw,15px);letter-spacing:.14em;text-transform:uppercase;color:var(--accent);font-weight:700;margin-bottom:clamp(14px,2vw,26px)}
h1{font-size:clamp(38px,7vw,92px);line-height:1.04;letter-spacing:-.03em;font-weight:800;text-wrap:balance}
h2{font-size:clamp(28px,4.2vw,56px);line-height:1.1;letter-spacing:-.02em;font-weight:750;text-wrap:balance;max-width:20em}
h2.big{font-size:clamp(34px,5.6vw,76px)}
.body{font-size:clamp(17px,1.7vw,24px);line-height:1.55;color:var(--muted);max-width:38em;margin-top:clamp(16px,2.2vw,30px);text-wrap:pretty}
.cover,.closing{background:var(--dark);color:#fff;border-bottom:0}
.cover .body,.closing .body{color:#b9bfc9}
.cover::before,.closing::before{content:"";position:absolute;inset:0 auto 0 0;width:clamp(6px,.8vw,12px);background:var(--accent)}
.cta{display:inline-block;margin-top:clamp(24px,3vw,44px);padding:.7em 1.3em;border-radius:999px;background:var(--accent);color:#fff;font-weight:700;font-size:clamp(16px,1.5vw,21px)}
.bullets{list-style:none;padding:0;margin-top:clamp(22px,3vw,44px);display:grid;gap:clamp(12px,1.6vw,22px);max-width:44em}
.bullets li{position:relative;padding-left:1.6em;font-size:clamp(18px,1.9vw,27px);line-height:1.4}
.bullets li::before{content:"";position:absolute;left:0;top:.55em;width:.6em;height:.6em;border-radius:2px;background:var(--accent)}
.stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:clamp(20px,3vw,48px);margin-top:clamp(28px,4vw,60px)}
.stat{border-top:3px solid var(--accent);padding-top:clamp(12px,1.6vw,22px)}
.stat .value{font-size:clamp(44px,7vw,104px);font-weight:800;letter-spacing:-.04em;line-height:1;font-variant-numeric:tabular-nums}
.stat .label{margin-top:.7em;font-size:clamp(15px,1.4vw,20px);color:var(--muted);line-height:1.4}
.columns{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:clamp(16px,2.4vw,36px);margin-top:clamp(24px,3.4vw,52px)}
.col{border:1px solid var(--line);border-radius:18px;padding:clamp(20px,2.6vw,38px);background:#fff}
.col.strong{background:var(--dark);color:#fff;border-color:var(--dark)}
.col h3{font-size:clamp(18px,1.8vw,26px);margin-bottom:.9em}
.col.strong h3{color:#fff}
.col ul{list-style:none;padding:0;display:grid;gap:.7em;font-size:clamp(15px,1.45vw,20px);line-height:1.45;color:var(--muted)}
.col.strong ul{color:#cfd4dc}
.col li::before{content:"— "}
blockquote{font-size:clamp(28px,4.4vw,60px);line-height:1.22;letter-spacing:-.02em;font-weight:650;text-wrap:balance;border-left:clamp(4px,.5vw,8px) solid var(--accent);padding-left:clamp(18px,2.6vw,40px)}
.by{margin-top:1.4em;padding-left:clamp(22px,3.1vw,48px);color:var(--muted);font-size:clamp(15px,1.5vw,21px)}
.chart{margin-top:clamp(24px,3.4vw,52px);display:grid;gap:clamp(10px,1.4vw,18px);max-width:60em}
.bar-row{display:grid;grid-template-columns:minmax(80px,14em) 1fr auto;align-items:center;gap:clamp(10px,1.4vw,20px);font-size:clamp(14px,1.4vw,20px)}
.bar-track{height:clamp(18px,2.2vw,32px);background:#eceae4;border-radius:6px;overflow:hidden}
.bar{display:block;height:100%;background:var(--accent);border-radius:6px}
.bar-row:not(:first-child) .bar{opacity:.55}
.bar-value{font-weight:700;font-variant-numeric:tabular-nums}
.sources ol{margin-top:clamp(18px,2.4vw,36px);padding-left:1.3em;display:grid;gap:.7em;font-size:clamp(12px,1.05vw,15px);color:var(--muted)}
.sources li span{display:block;color:var(--ink)}
.sources a{color:var(--accent);word-break:break-all}
.page{position:absolute;right:clamp(18px,3vw,44px);bottom:clamp(14px,2.4vw,32px);font-size:13px;color:#9aa0aa;font-variant-numeric:tabular-nums}
.flag{position:absolute;left:clamp(18px,3vw,44px);bottom:clamp(14px,2.4vw,32px);font-size:12px;font-weight:700;color:#8a4b00;background:#ffe9c2;border-radius:999px;padding:.35em .9em}
.notes{display:none;position:absolute;left:0;right:0;bottom:0;background:#fffbe8;color:#3d3a2c;border-top:1px solid #eadf9f;padding:14px clamp(18px,6vw,96px) 40px;font-size:15px;line-height:1.5}
body.show-notes .notes{display:block}
#bar{position:fixed;top:0;left:0;height:3px;background:var(--accent);width:0;z-index:5;transition:width .2s}
#tools{position:fixed;top:12px;right:14px;z-index:6;display:flex;gap:8px}
#tools button{font:inherit;font-size:12px;padding:.45em .9em;border-radius:999px;border:1px solid var(--line);background:#fff;color:var(--ink);cursor:pointer;opacity:.75}
#tools button:hover{opacity:1}
@media (max-width:640px){.bar-row{grid-template-columns:1fr auto}.bar-track{grid-column:1/-1;order:3}}
@page{size:1280px 720px;margin:0}
@media print{html{scroll-snap-type:none}#bar,#tools,.notes{display:none!important}.slide{min-height:0;height:720px;width:1280px;break-after:page;padding:64px 80px;-webkit-print-color-adjust:exact;print-color-adjust:exact}}
</style>
</head>
<body>
<div id="bar"></div>
<div id="tools"><button id="btn-notes" type="button">备注 N</button><button id="btn-print" type="button">导出 PDF</button></div>
${html}
<script>
const slides=[...document.querySelectorAll('.slide')];
const current=()=>{let best=0,d=1e9;slides.forEach((s,i)=>{const t=Math.abs(s.getBoundingClientRect().top);if(t<d){d=t;best=i}});return best};
const go=i=>slides[Math.max(0,Math.min(slides.length-1,i))].scrollIntoView();
addEventListener('keydown',e=>{
  if(['ArrowRight','ArrowDown','PageDown',' '].includes(e.key)){e.preventDefault();go(current()+1)}
  else if(['ArrowLeft','ArrowUp','PageUp'].includes(e.key)){e.preventDefault();go(current()-1)}
  else if(e.key==='n'||e.key==='N')document.body.classList.toggle('show-notes');
});
addEventListener('scroll',()=>{const max=document.documentElement.scrollHeight-innerHeight;document.getElementById('bar').style.width=(max>0?scrollY/max*100:0)+'%'},{passive:true});
document.getElementById('btn-notes').onclick=()=>document.body.classList.toggle('show-notes');
document.getElementById('btn-print').onclick=()=>print();
</script>
</body>
</html>`;
}

/**
 * Optional layout check in a real browser. Needs the `playwright` package; without it the check is skipped.
 * Reports slides taller than one desktop screen and any sideways overflow on a phone.
 */
export async function checkLayout(file) {
  let chromium;
  try {
    ({ chromium } = await import('playwright'));
  } catch {
    return { ran: false, problems: [] };
  }
  const problems = [];
  let browser;
  try {
    browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await page.goto(`file://${file}`);
    const tall = await page.evaluate(() =>
      [...document.querySelectorAll('.slide')].filter((s) => s.scrollHeight > innerHeight + 2).map((s) => s.dataset.n),
    );
    if (tall.length) problems.push(`Slides ${tall.join(', ')} are taller than one desktop screen (1440×900). Shorten their text or split them.`);
    await page.setViewportSize({ width: 390, height: 844 });
    const wide = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1);
    if (wide) problems.push('The deck scrolls sideways on a phone (390px wide). Shorten long unbroken words or labels.');
    return { ran: true, problems };
  } catch (e) {
    return { ran: false, problems: [], error: e.message };
  } finally {
    await browser?.close();
  }
}
