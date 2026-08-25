import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTown, tick, stats, issueDecree, activeModifiers, BUILDING_BY_ID } from './src/engine.js';
import { BUILDINGS, GUILDS, RESOURCES, CITIZEN_NAMES } from './src/data.js';
import { parseDecree, DECREE_BY_KEY, DECREES } from './src/decrees.js';
import { digestSource, docToMarkdown, slugify, isAccepted, isPdf, fileTooLarge, joinSoftBreaks } from './src/workshop.js';
import { extractPdfText, legibility } from './src/pdf.js';
import { measureText } from './src/deliverables.js';
import { readFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';

const nodeInflate = async (bytes) => new Uint8Array(inflateSync(Buffer.from(bytes)));
const fixture = (name) => readFileSync(new URL(`./test-fixtures/${name}`, import.meta.url));
import { assemble, DELIVERABLES, DELIVERABLE_BY_ID, LENSES } from './src/deliverables.js';
import { detectType, extractFigures, noticePeriods, readDocument, diaryDates } from './src/reading-room.js';

const run = (days, seed = 66) => {
  const town = createTown(seed);
  for (let i = 0; i < days; i++) tick(town);
  return town;
};

test('the town is founded with 66 citizens across 11 guilds', () => {
  const town = createTown(66);
  assert.equal(town.citizens.length, 66);
  assert.equal(GUILDS.length, 11);
  assert.equal(new Set(town.citizens.map((c) => c.name)).size, 66, 'names are unique');
  for (const g of GUILDS) assert.equal(CITIZEN_NAMES[g.id].length, 6);
});

test('every building belongs to a guild and offers real work', () => {
  assert.equal(BUILDINGS.length, 33);
  const seats = BUILDINGS.reduce((a, b) => a + b.posts.reduce((x, p) => x + p.seats, 0), 0);
  assert.ok(seats >= 66, `posts (${seats}) must cover the population`);
  for (const b of BUILDINGS) {
    assert.ok(GUILDS.some((g) => g.id === b.guild), `${b.id} has a guild`);
    assert.ok(b.blurb && b.posts.length > 0, `${b.id} is described and staffable`);
    assert.ok(Object.keys(b.outputs).length > 0, `${b.id} produces something`);
  }
});

test('everyone graduates in good standing and is hired within 60 days', () => {
  const town = run(60);
  const s = stats(town);
  assert.equal(s.employed, 66, 'all 66 are employed');
  assert.equal(s.students + s.graduates, 0);
  for (const c of town.citizens) {
    assert.ok(c.gpa >= 0.7, `${c.name} passed finals (${c.gpa})`);
    assert.ok(c.honours, `${c.name} graduated with honours`);
    assert.ok(c.post && c.role, `${c.name} holds a post`);
    assert.ok(c.graduatedOn < c.hiredOn, `${c.name} graduated before being hired`);
  }
});

test('placement matches people to work they are actually good at', () => {
  const town = run(60);
  for (const c of town.citizens) {
    const fit = c.aptitudes[c.post.skill];
    assert.ok(fit >= 0.5, `${c.name} placed on ${c.post.skill} with aptitude ${fit}`);
  }
  const homeGuild = town.citizens.filter((c) => BUILDING_BY_ID[c.post.buildingId].guild === c.guild).length;
  assert.ok(homeGuild >= 40, `most citizens work in their own guild (${homeGuild}/66)`);
});

test('nobody is left performing badly, and results improve with tenure', () => {
  const early = run(30);
  const late = run(150);
  for (const c of late.citizens) assert.ok(c.performance >= 0.72, `${c.name} is supported to ${c.performance}`);
  assert.ok(stats(late).avgPerformance >= stats(early).avgPerformance, 'the town gets better at its work');
  assert.ok(stats(late).totals.mentorships > 0, 'mentorship happens');
  assert.ok(stats(late).totals.promotions > 0, 'people are promoted');
});

test('the economy stays solvent — no store ever goes negative', () => {
  const town = createTown(66);
  for (let i = 0; i < 200; i++) {
    tick(town);
    for (const r of RESOURCES) {
      assert.ok(town.resources[r.id] >= 0, `${r.id} negative on day ${town.day}`);
    }
  }
});

test('stage counts always add up to the whole population', () => {
  const town = createTown(66);
  for (let i = 0; i < 80; i++) {
    tick(town);
    const s = stats(town);
    assert.equal(s.students + s.graduates + s.employed, 66, `day ${town.day}`);
  }
});

test('no post is ever held by two citizens', () => {
  const town = run(90);
  const held = town.citizens.map((c) => c.post.id);
  assert.equal(new Set(held).size, held.length);
});

test('the same seed replays the same town', () => {
  const a = run(50, 7);
  const b = run(50, 7);
  assert.deepEqual(stats(a), stats(b));
  assert.deepEqual(a.resources, b.resources);
  const fingerprint = (t) => t.citizens.map((c) => `${c.name}:${c.role}:${c.gpa}`).join('|');
  assert.equal(fingerprint(a), fingerprint(b));
  assert.notEqual(fingerprint(run(50, 8)), fingerprint(a), 'a different seed tells a different story');
});

/* ------------------------------------------------------------- decrees */

test('a written order is understood in English or Chinese', () => {
  assert.equal(parseDecree('put everything into energy'), 'focus:energy');
  assert.equal(parseDecree('把力气都放在能量上'), 'focus:energy');
  assert.equal(parseDecree('expand the academy'), 'expand_academy');
  assert.equal(parseDecree('来场庆典'), 'festival');
  assert.equal(parseDecree('让大家休息一下'), 'rest');
  assert.equal(parseDecree('we need more research'), 'innovate');
  assert.equal(parseDecree('asdfgh'), null, 'nonsense is refused, not guessed at');
  assert.equal(parseDecree(''), null);
});

test('a focus decree really changes what the town produces', () => {
  const plain = run(40);
  const ordered = run(40);
  assert.equal(issueDecree(ordered, 'focus:energy').ok, true);
  for (let i = 0; i < 5; i++) tick(ordered);
  for (let i = 0; i < 5; i++) tick(plain);
  assert.ok(ordered.flows.energy > plain.flows.energy * 1.5, `energy ${plain.flows.energy} -> ${ordered.flows.energy}`);
  assert.ok(ordered.flows.food < plain.flows.food, 'other work eases off');
});

test('a decree expires and the town goes back to normal', () => {
  const town = run(40);
  issueDecree(town, 'focus:energy');
  const spec = DECREE_BY_KEY['focus:energy'];
  for (let i = 0; i < spec.days; i++) tick(town);
  assert.equal(town.decrees.length, 0, 'the decree has run its course');
  const mods = activeModifiers(town);
  assert.equal(mods.mulDefault, 1);
  assert.deepEqual(mods.mul, {});
});

test('an order the town cannot afford is refused, and costs nothing', () => {
  const town = run(30);
  town.resources.food = 0;
  const before = { ...town.resources };
  const result = issueDecree(town, 'festival');
  assert.equal(result.ok, false);
  assert.match(result.message, /not enough food/i);
  assert.deepEqual(town.resources, before, 'a refused decree spends nothing');
  assert.equal(town.decrees.length, 0);
});

test('a new decree replaces the standing one in the same slot', () => {
  const town = run(40);
  issueDecree(town, 'focus:energy');
  issueDecree(town, 'focus:food');
  const focused = town.decrees.filter((d) => d.slot === 'focus');
  assert.equal(focused.length, 1);
  assert.equal(focused[0].key, 'focus:food');
});

test('chartering posts moves people only into work that suits them better', () => {
  const town = run(50);
  const before = new Map(town.citizens.map((c) => [c.id, c.aptitudes[c.post.skill]]));
  assert.equal(issueDecree(town, 'open_posts').ok, true);
  for (const c of town.citizens) {
    assert.ok(c.aptitudes[c.post.skill] >= before.get(c.id), `${c.name} is never moved into worse-fitting work`);
    assert.equal(c.stage, 'employed');
  }
  const held = town.citizens.map((c) => c.post.id);
  assert.equal(new Set(held).size, held.length, 'no post is double-held after a reshuffle');
});

test('decrees never break the town: everyone stays employed and stores stay solvent', () => {
  const town = createTown(66);
  const orders = ['focus:energy', 'festival', 'expand_academy', 'rest', 'mentor_all', 'innovate', 'open_posts', 'focus:care'];
  for (let i = 0; i < 160; i++) {
    tick(town);
    if (i % 12 === 0) issueDecree(town, orders[(i / 12) % orders.length]);
    for (const r of RESOURCES) assert.ok(town.resources[r.id] >= 0, `${r.id} negative on day ${town.day}`);
  }
  const s = stats(town);
  assert.equal(s.employed, 66);
  for (const c of town.citizens) assert.ok(c.performance >= 0.7, `${c.name} still doing well (${c.performance})`);
});

/* ------------------------------------------------------------ workshop */

const BRIEF_FILE = `Acme Coffee — retail expansion brief
We want to open 12 new stores across Malaysia by Q4 2026.
Budget is around RM 4.5 million for the first phase.
ok
Some filler text that carries no information whatsoever.
Our target audience is office workers aged 25-40.`;

test('reading a file keeps the lines that carry something', () => {
  const d = digestSource('brief.txt', BRIEF_FILE);
  assert.equal(d.name, 'brief.txt');
  assert.ok(d.highlights.length >= 3, 'it finds the substantive lines');
  assert.ok(d.highlights.some((h) => h.includes('RM 4.5 million')), 'money is kept');
  assert.ok(d.highlights.some((h) => h.includes('12 new stores')), 'numbers are kept');
  assert.ok(!d.highlights.some((h) => h === 'ok'), 'noise is dropped');
  assert.ok(!d.highlights.some((h) => h.includes('filler text')), 'lines saying nothing are dropped');
});

test('text files and PDFs are accepted, other formats are not', () => {
  assert.equal(isAccepted('notes.md'), true);
  assert.equal(isAccepted('data.CSV'), true);
  assert.equal(isAccepted('proposal.pdf'), true);
  assert.equal(isPdf('proposal.PDF'), true);
  assert.equal(isPdf('notes.md'), false);
  assert.equal(isAccepted('report.docx'), false, 'Word is not read; the text must be pasted');
  assert.equal(isAccepted('photo.png'), false);
  assert.equal(fileTooLarge(9 * 1024 * 1024), true);
  assert.equal(fileTooLarge(600 * 1024), false, 'a normal PDF fits');
});

test('the guilds assemble a full proposal, each section signed by a different citizen', () => {
  const town = run(50);
  const doc = assemble('proposal', {
    title: 'Retail expansion', client: 'Acme Coffee', goal: 'open 12 stores',
    points: ['Site selection', 'Fit-out playbook'], budget: 'RM 4.5m', timeline: 'by Q4',
  }, [digestSource('brief.txt', BRIEF_FILE)], town, 'en');

  assert.equal(doc.sections.length, 8);
  assert.equal(doc.title, 'Retail expansion');
  assert.match(doc.subtitle, /Acme Coffee/);
  const authors = doc.sections.map((s) => s.author && s.author.name);
  assert.ok(authors.every(Boolean), 'every section has an author');
  assert.equal(new Set(authors).size, authors.length, 'no citizen signs twice');
  for (const s of doc.sections) {
    assert.ok(s.heading && s.blocks.length, `${s.key} has a heading and content`);
    assert.ok(town.citizens.some((c) => c.name === s.author.name), 'the author is a real citizen');
  }
});

test('the draft carries the brief and the material into the markdown', () => {
  const town = run(50);
  const doc = assemble('proposal', {
    title: 'Retail expansion', client: 'Acme Coffee', goal: 'open 12 stores',
    points: ['Site selection framework'], budget: 'RM 4.5m', timeline: 'by Q4',
  }, [digestSource('brief.txt', BRIEF_FILE)], town, 'en');
  const md = docToMarkdown(doc);

  assert.match(md, /^# Retail expansion/);
  assert.match(md, /Acme Coffee/);
  assert.match(md, /- Site selection framework/, 'the points survive');
  assert.match(md, /> .*RM 4\.5 million/, 'quoted material survives');
  assert.match(md, /RM 4\.5m/, 'the budget survives');
  assert.match(md, /\*— \w+, .+\*/, 'sections are signed');
});

test('a draft can be assembled in Chinese, and in English, from the same brief', () => {
  const town = run(50);
  const brief = { title: '零售扩张', client: 'Acme', goal: '开 12 家店', points: ['选址'], budget: '450 万' };
  const zh = assemble('proposal', brief, [], town, 'zh');
  const en = assemble('proposal', brief, [], town, 'en');
  assert.equal(zh.sections[0].heading, '概述');
  assert.equal(en.sections[0].heading, 'Overview');
  assert.match(docToMarkdown(zh), /开 12 家店/);
  assert.equal(zh.sections.length, en.sections.length);
});

test('an almost-empty brief still produces a usable draft', () => {
  const town = run(50);
  const doc = assemble('proposal', { points: [] }, [], town, 'en');
  assert.equal(doc.sections.length, 8);
  assert.ok(doc.title.length > 0);
  const md = docToMarkdown(doc);
  assert.ok(md.length > 400, 'there is still a real document');
});

test('filenames are made safe for saving', () => {
  assert.equal(slugify('Retail expansion proposal'), 'retail-expansion-proposal');
  assert.equal(slugify('  ../../etc/passwd  '), 'etc-passwd');
  assert.equal(slugify(''), 'proposal');
  assert.ok(slugify('x'.repeat(200)).length <= 48);
});

/* --------------------------------------------------------- deliverables */

test('the town can make all eight things, from the same brief', () => {
  const town = run(50);
  const brief = {
    title: 'Coffee expansion', client: 'Acme', goal: 'open 12 stores by Q4',
    points: ['Site selection', 'Fit-out playbook'], budget: 'RM 4.5m', timeline: 'by Q4',
  };
  assert.equal(DELIVERABLES.length, 8);
  for (const spec of DELIVERABLES) {
    const doc = assemble(spec.id, brief, [], town, 'en');
    assert.ok(doc.sections.length >= 1, `${spec.id} has sections`);
    assert.equal(doc.kind, spec.id);
    assert.ok(doc.title, `${spec.id} has a title`);
    for (const s of doc.sections) {
      assert.ok(s.heading, `${spec.id}: every section has a heading`);
      assert.ok(s.blocks.length, `${spec.id}: every section has content`);
    }
    const md = docToMarkdown(doc);
    assert.ok(md.includes(doc.title), `${spec.id} markdown carries the title`);
  }
});

test('ideas puts all eleven guild lenses on your subject', () => {
  const town = run(50);
  const doc = assemble('ideas', { goal: 'open 12 stores by Q4', points: [] }, [], town, 'en');
  assert.equal(LENSES.length, 11);
  const lensSections = doc.sections.filter((s) => s.key.startsWith('lens-'));
  assert.equal(lensSections.length, 11, 'one angle per guild');
  for (const g of GUILDS) {
    assert.ok(doc.sections.some((s) => s.key === `lens-${g.id}`), `${g.name} has an angle`);
  }
  for (const s of lensSections) {
    assert.equal(s.blocks.length, 2, 'a question and a move');
    assert.match(s.blocks[0].text, /open 12 stores by Q4/, 'the question is about your subject');
    assert.ok(s.blocks[1].text.length > 30, 'the move is concrete');
  }
});

test('every section is signed by a real, distinct citizen with an id', () => {
  const town = run(50);
  for (const spec of DELIVERABLES) {
    const doc = assemble(spec.id, { title: 'X', points: ['a', 'b'] }, [], town, 'en');
    const ids = doc.sections.map((s) => s.author && s.author.id);
    assert.ok(ids.every(Boolean), `${spec.id}: every section is signed`);
    assert.equal(new Set(ids).size, ids.length, `${spec.id}: nobody signs twice`);
    for (const id of ids) {
      assert.ok(town.citizens.some((c) => c.id === id), `${spec.id}: ${id} is a real citizen`);
    }
  }
});

test('a town that has not graduated anyone can still be asked for work', () => {
  const town = createTown(66);
  tick(town);
  const doc = assemble('ideas', { goal: 'launch something', points: [] }, [], town, 'en');
  assert.equal(doc.sections.length, 11);
  assert.ok(doc.sections.every((s) => s.author), 'students sign when nobody is employed yet');
});

test('every deliverable can be assembled in Chinese', () => {
  const town = run(50);
  for (const spec of DELIVERABLES) {
    const doc = assemble(spec.id, { title: '咖啡扩张', client: 'Acme', goal: '开 12 家店', points: ['选址'] }, [], town, 'zh');
    assert.equal(doc.lang, 'zh');
    assert.equal(doc.kindName, spec.zh);
    const md = docToMarkdown(doc);
    assert.ok(/[一-龥]/.test(md), `${spec.id} produces Chinese text`);
  }
});

test('an unknown deliverable falls back to a proposal rather than breaking', () => {
  const town = run(40);
  const doc = assemble('nonsense', { title: 'X', points: [] }, [], town, 'en');
  assert.equal(doc.kind, 'proposal');
  assert.ok(doc.sections.length > 0);
});

/* -------------------------------------------------------------- reading PDFs */

test('a real PDF gives back its text, following the font tables', async () => {
  const r = await extractPdfText(fixture('sample-en.pdf'), nodeInflate);
  assert.equal(r.ok, true, `expected readable text, got ${r.reason}`);
  assert.ok(r.legible > 0.6, `legibility ${r.legible}`);
  assert.match(r.text, /Retail Expansion for Acme Coffee/);
  assert.match(r.text, /RM\s+4\.5 million/, 'a figure survives intact');
  assert.match(r.text, /foot traffic/);
  assert.ok(r.pages >= 1);
});

test('a Chinese PDF comes back as Chinese, not glyph soup', async () => {
  const r = await extractPdfText(fixture('sample-zh.pdf'), nodeInflate);
  assert.equal(r.ok, true, `expected readable text, got ${r.reason}`);
  assert.match(r.text, /咖啡零售扩张/);
  assert.match(r.text, /450 万令吉/);
  assert.ok(!/�/.test(r.text), 'no replacement characters');
});

test('something that is not a PDF is refused, not guessed at', async () => {
  const r = await extractPdfText(new TextEncoder().encode('just a text file, honestly'), nodeInflate);
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'not-pdf');
  assert.equal(r.text, '');
});

test('legibility separates language from salvage', () => {
  assert.ok(legibility('This is an ordinary English sentence.') > 0.7);
  assert.ok(legibility('������') < 0.2);
  assert.equal(legibility(''), 0);
});

test('lines broken by the page are rejoined, headings and lists are not', () => {
  const joined = joinSoftBreaks('Overview\nAcme Coffee intends to open 12 new\nstores across Malaysia.\n- first item\n- second item');
  assert.match(joined, /open 12 new stores across Malaysia\./, 'a split sentence is put back together');
  assert.ok(joined.startsWith('Overview\n'), 'a heading keeps its own line');
  assert.match(joined, /\n- first item\n- second item/, 'list items keep their own lines');
});

/* --------------------------------------------------------------- reviewing */

const WEAK_PROPOSAL = `Our Proposal for Globex
We are a world-class agency with cutting-edge capability and we deliver seamless outcomes.
We will work hard on the brand refresh and we guarantee results.
We are excited about this partnership and we look forward to working together.`;

const STRONG_PROPOSAL = `Proposal for Globex — brand refresh
You asked for a brand refresh before your March launch, and this sets out what that costs and what you get.
Scope: identity, packaging for 3 SKUs, and a one-page guideline.
Not included: photography, media buying, or web build. Those can be quoted separately.
You will receive: a logo suite, colour and type system, and packaging artwork for 3 SKUs.
Timeline: 6 weeks from signature, with a first version in week 2.
Our fee is RM 68,000, invoiced in two parts.
Success is measured by pack artwork approved and at press by 20 March 2026.
Why now: your March launch fixes the date, and press slots close 3 weeks before.
Next steps: approve this scope and we start on Monday.`;

test('a weak proposal is caught on the things that matter', () => {
  const town = run(50);
  const doc = assemble('review', {}, [digestSource('weak.txt', WEAK_PROPOSAL)], town, 'en');
  const flagged = doc.sections.filter((s) => s.status === 'look').map((s) => s.key);
  for (const key of ['check-ledger', 'check-wayfinder', 'check-keystone', 'check-lattice', 'check-forge', 'check-mender', 'check-chorus']) {
    assert.ok(flagged.includes(key), `${key} should be flagged on a weak proposal`);
  }
  const cliche = doc.sections.find((s) => s.key === 'check-chorus');
  assert.match(cliche.blocks[0].text, /world-class|cutting-edge/, 'the stock phrases are named');
  const promise = doc.sections.find((s) => s.key === 'check-mender');
  assert.match(promise.blocks[0].text, /guarantee/, 'the absolute promise is named');
});

test('a solid proposal passes almost everything, with evidence quoted back', () => {
  const town = run(50);
  const doc = assemble('review', {}, [digestSource('strong.txt', STRONG_PROPOSAL)], town, 'en');
  const flagged = doc.sections.filter((s) => s.status === 'look');
  assert.ok(flagged.length <= 1, `expected at most one flag, got ${flagged.map((s) => s.key).join(', ')}`);
  const money = doc.sections.find((s) => s.key === 'check-ledger');
  assert.equal(money.status, 'good');
  assert.match(money.blocks[1].items[0], /RM 68,000/, 'the price is quoted back with its sentence');
});

test('asked to review nothing, the town says so instead of inventing a verdict', () => {
  const town = run(50);
  const doc = assemble('review', { title: 'x' }, [], town, 'en');
  assert.equal(doc.sections.length, 1);
  assert.match(doc.sections[0].blocks[0].text, /Upload the PDF or paste/);
  assert.ok(!doc.sections.some((s) => s.status === 'good'), 'nothing is passed without a document');
});

test('the review reads a PDF end to end', async () => {
  const town = run(50);
  const r = await extractPdfText(fixture('sample-en.pdf'), nodeInflate);
  const doc = assemble('review', {}, [digestSource('sample-en.pdf', r.text)], town, 'en');
  assert.ok(doc.sections.length >= 11);
  const money = doc.sections.find((s) => s.key === 'check-ledger');
  assert.equal(money.status, 'good', 'it finds the price that is in the PDF');
  assert.match(money.blocks[1].items[0], /RM 4\.5 million/);
});

test('measurements describe the document rather than guessing', () => {
  const m = measureText(STRONG_PROPOSAL);
  assert.ok(m.words > 80);
  assert.ok(m.money.length >= 1);
  assert.ok(m.dates.length >= 2);
  assert.ok(m.you > 0);
  assert.equal(m.cliches.length, 0);
  assert.equal(measureText(WEAK_PROPOSAL).cliches.length >= 2, true);
});

/* ----------------------------------------------------------- the council */

test('the council prompt carries the question and all eleven seats', () => {
  const town = run(50);
  const doc = assemble('council', {
    title: 'Supplement decision',
    goal: 'should I take magnesium for sleep',
    points: ['I sleep about 5 hours', 'I drink coffee late'],
  }, [], town, 'en');

  const prompt = doc.sections.find((s) => s.key === 'prompt').blocks[0];
  assert.equal(prompt.type, 'prompt');
  assert.match(prompt.text, /should I take magnesium for sleep/, 'my question is in it');
  assert.match(prompt.text, /I sleep about 5 hours/, 'my context is in it');
  for (const g of GUILDS) {
    assert.ok(prompt.text.includes(g.name.replace(' Guild', '')), `${g.name} has a seat`);
  }
  assert.match(prompt.text, /Numbers over adjectives/);
  assert.match(prompt.text, /\[established\]/, 'certainty tagging is asked for');
  assert.match(prompt.text, /If I proceed anyway|proceed anyway/i, 'it asks for the go-ahead-anyway branch');
  assert.ok(prompt.text.length > 2500, 'the prompt is complete, not a stub');
});

test('the council prompt works in Chinese too', () => {
  const town = run(50);
  const doc = assemble('council', { goal: '我该不该买这款补剂', points: ['我一天睡 5 小时'] }, [], town, 'zh');
  const prompt = doc.sections.find((s) => s.key === 'prompt').blocks[0].text;
  assert.match(prompt, /我该不该买这款补剂/);
  assert.match(prompt, /我一天睡 5 小时/);
  assert.match(prompt, /议事规则/);
  assert.match(prompt, /\[已确立\]/);
});

test('material handed to the town rides along in the council prompt', () => {
  const town = run(50);
  const source = digestSource('label.txt', 'Each capsule contains 400mg of magnesium citrate.\nThe recommended dose is 2 capsules daily.\nPrice is RM 89 for 60 capsules.');
  const doc = assemble('council', { goal: 'should I buy this' }, [source], town, 'en');
  const prompt = doc.sections.find((s) => s.key === 'prompt').blocks[0].text;
  assert.match(prompt, /Material I am giving you/);
  assert.match(prompt, /400mg of magnesium citrate/);
});

test('a council prompt with no question still gives a usable frame', () => {
  const town = run(50);
  const doc = assemble('council', { points: [] }, [], town, 'en');
  const prompt = doc.sections.find((s) => s.key === 'prompt').blocks[0].text;
  assert.match(prompt, /write your question here/);
  assert.ok(prompt.length > 2500);
});

test('the prompt survives the trip through markdown', () => {
  const town = run(50);
  const doc = assemble('council', { goal: 'should I take this job' }, [], town, 'en');
  const md = docToMarkdown(doc);
  assert.match(md, /```/, 'the prompt is fenced');
  assert.match(md, /should I take this job/);
});

/* ------------------------------------------------------- the reading room */

const TENANCY = `TENANCY AGREEMENT
This Agreement is made on 1 March 2026 between Sunrise Property Sdn Bhd (the Landlord) and the Tenant.
1. Term. The tenancy shall be for a period of 24 months commencing 1 April 2026 and expiring 31 March 2028.
2. Rent. The Tenant shall pay monthly rent of RM 3,200 on or before the 5th day of each month. Late payment shall attract interest of 8% per annum.
3. Deposit. The Tenant shall pay a security deposit of RM 9,600. The security deposit shall be refunded within 90 days of expiry, less any deductions the Landlord deems reasonable.
4. Renewal. This Agreement shall automatically renew for a further term of 24 months unless either party gives written notice of not less than 90 days before expiry.
5. Rent Revision. Upon renewal the Landlord may revise the rent by up to 15% without the consent of the Tenant.
6. Early Termination. Should the Tenant terminate before expiry, the Tenant shall forfeit the entire security deposit.
7. Repairs. The Tenant shall be responsible for all repairs and maintenance including structural repairs.
8. Entry. The Landlord may enter the premises at any time for inspection.
9. Liability. The Tenant shall indemnify the Landlord against all claims, losses and damages of any nature whatsoever, without limit.
10. Governing Law. This Agreement shall be governed by the laws of Malaysia.`;

test('the town recognises what kind of document it is holding', () => {
  assert.equal(detectType(TENANCY).id, 'tenancy');
  assert.equal(detectType('The Employee shall serve a probation period. Salary is paid monthly. Employment may be terminated.').id, 'employment');
  assert.equal(detectType('Hello, just writing to say the weather is nice today and I hope you are well.').id, 'general');
});

test('every figure in a contract is pulled out and labelled', () => {
  const figures = extractFigures(TENANCY);
  const value = (v) => figures.find((f) => f.value.replace(/\s/g, '') === v.replace(/\s/g, ''));

  assert.ok(value('RM 3,200'), 'the rent is found');
  assert.equal(value('RM 3,200').role, 'rent');
  assert.ok(value('RM 9,600'), 'the deposit is found');
  assert.equal(value('RM 9,600').role, 'deposit');
  assert.equal(value('15%').role, 'increase', 'the rent revision is read as an increase');
  assert.ok(value('31 March 2028'), 'the expiry date is found');
  for (const f of figures) {
    assert.ok(f.context.length > 10, 'every figure carries the sentence it came from');
  }
});

test('a notice period is the number beside the word notice, not any duration nearby', () => {
  const periods = noticePeriods(TENANCY);
  assert.equal(periods.length, 1);
  assert.equal(periods[0].days, 90);
  assert.ok(!periods.some((p) => p.days === 720), 'the 24-month term is not mistaken for a notice period');
});

test('the calendar gives the deadline and the last day you can act', () => {
  const read = readDocument(TENANCY, 'en');
  const diary = diaryDates(read);
  const ends = diary.find((d) => !d.critical);
  const act = diary.find((d) => d.critical);

  assert.equal(ends.when, '2028-03-31', 'it ends when the document says it ends');
  assert.equal(act.when, '2028-01-01', '90 days before that is the last day to give notice');
  assert.ok(diary.every((d) => d.when >= '2026-01-01'), 'no dates from before the agreement');
});

test('the traps in a one-sided tenancy are all caught', () => {
  const read = readDocument(TENANCY, 'en');
  const caught = read.found.map((f) => f.check.id);
  for (const id of ['auto_renew', 'unilateral_change', 'unlimited_liability', 'penalty', 'deposit_return', 'repairs', 'entry']) {
    assert.ok(caught.includes(id), `${id} should be caught`);
  }
  for (const f of read.found) {
    assert.ok(f.quote.length > 25, `${f.check.id} quotes a real sentence, not a heading`);
    assert.ok(f.check.severity === 'high' || f.check.severity === 'medium');
  }
  assert.ok(read.found.filter((f) => f.check.severity === 'high').length >= 4);
});

test('what is missing from a document is reported as missing', () => {
  const bare = `SERVICE QUOTATION
We will deliver a brand refresh for Globex. The scope of work covers identity and packaging.
Our fee is RM 68,000. Invoice on completion.`;
  const read = readDocument(bare, 'en');
  const gaps = read.missing.map((c) => c.id);
  assert.ok(gaps.includes('scope_out'), 'nothing says what is out of scope');
  assert.ok(gaps.includes('dispute'), 'no dispute clause');
  for (const c of read.missing) {
    assert.ok(c.missingEn && c.askEn, `${c.id} explains the gap and gives something to ask`);
  }
});

test('the reading report carries numbers, clauses, questions and a prompt', () => {
  const town = run(50);
  const doc = assemble('reading', {}, [digestSource('tenancy.pdf', TENANCY)], town, 'en');
  const keys = doc.sections.map((s) => s.key);

  assert.ok(keys.includes('numbers'));
  assert.ok(keys.includes('diary'));
  assert.ok(keys.includes('asks'));
  assert.ok(keys.includes('further'));
  assert.ok(keys.includes('clause-auto_renew'));

  const table = doc.sections.find((s) => s.key === 'numbers').blocks[0];
  assert.equal(table.type, 'table');
  assert.equal(table.head.length, 3);
  assert.ok(table.rows.length >= 6);

  const asks = doc.sections.find((s) => s.key === 'asks').blocks.find((b) => b.type === 'checklist');
  assert.ok(asks.items.length >= 5, 'there are real questions to send back');
  assert.equal(new Set(asks.items).size, asks.items.length, 'no duplicate questions');

  const prompt = doc.sections.find((s) => s.key === 'further').blocks.find((b) => b.type === 'prompt');
  assert.match(prompt.text, /Full text/);
  assert.match(prompt.text, /automatically renew/, 'the document itself rides along');
  assert.match(prompt.text, /redlines/, 'it asks for wording I can send back');

  const md = docToMarkdown(doc);
  assert.match(md, /\| RM 3,200 \|/, 'the table survives into markdown');
  assert.match(md, /- \[ \] /, 'the questions become a checklist');
});

test('asked to read nothing, the reading room says so', () => {
  const town = run(50);
  const doc = assemble('reading', {}, [], town, 'en');
  assert.equal(doc.sections.length, 1);
  assert.match(doc.sections[0].blocks[0].text, /Upload the PDF/);
});

test('the reading room works in Chinese', () => {
  const town = run(50);
  const doc = assemble('reading', {}, [digestSource('t.txt', TENANCY)], town, 'zh');
  assert.match(doc.title, /阅读/);
  const asks = doc.sections.find((s) => s.key === 'asks').blocks.find((b) => b.type === 'checklist');
  assert.ok(/[一-龥]/.test(asks.items[0]), 'the questions are in Chinese');
});
