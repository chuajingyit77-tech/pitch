import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTown, tick, stats, issueDecree, activeModifiers, BUILDING_BY_ID } from './src/engine.js';
import { BUILDINGS, GUILDS, RESOURCES, CITIZEN_NAMES } from './src/data.js';
import { parseDecree, DECREE_BY_KEY, DECREES } from './src/decrees.js';
import {
  digestSource, buildProposal, proposalToMarkdown, slugify, isAccepted, fileTooLarge,
} from './src/workshop.js';

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

test('only text files are accepted, and not oversized ones', () => {
  assert.equal(isAccepted('notes.md'), true);
  assert.equal(isAccepted('data.CSV'), true);
  assert.equal(isAccepted('deck.pdf'), false);
  assert.equal(isAccepted('report.docx'), false);
  assert.equal(fileTooLarge(600 * 1024), true);
  assert.equal(fileTooLarge(10 * 1024), false);
});

test('the guilds assemble a full proposal, each section signed by a different citizen', () => {
  const town = run(50);
  const doc = buildProposal({
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
  const doc = buildProposal({
    title: 'Retail expansion', client: 'Acme Coffee', goal: 'open 12 stores',
    points: ['Site selection framework'], budget: 'RM 4.5m', timeline: 'by Q4',
  }, [digestSource('brief.txt', BRIEF_FILE)], town, 'en');
  const md = proposalToMarkdown(doc);

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
  const zh = buildProposal(brief, [], town, 'zh');
  const en = buildProposal(brief, [], town, 'en');
  assert.equal(zh.sections[0].heading, '概述');
  assert.equal(en.sections[0].heading, 'Overview');
  assert.match(proposalToMarkdown(zh), /开 12 家店/);
  assert.equal(zh.sections.length, en.sections.length);
});

test('an almost-empty brief still produces a usable draft', () => {
  const town = run(50);
  const doc = buildProposal({ points: [] }, [], town, 'en');
  assert.equal(doc.sections.length, 8);
  assert.ok(doc.title.length > 0);
  const md = proposalToMarkdown(doc);
  assert.ok(md.length > 400, 'there is still a real document');
});

test('filenames are made safe for saving', () => {
  assert.equal(slugify('Retail expansion proposal'), 'retail-expansion-proposal');
  assert.equal(slugify('  ../../etc/passwd  '), 'etc-passwd');
  assert.equal(slugify(''), 'proposal');
  assert.ok(slugify('x'.repeat(200)).length <= 48);
});
