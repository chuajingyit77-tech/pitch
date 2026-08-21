import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTown, tick, stats, BUILDING_BY_ID } from './src/engine.js';
import { BUILDINGS, GUILDS, RESOURCES, CITIZEN_NAMES } from './src/data.js';

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
