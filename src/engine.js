// Simulation engine for Gradient Town.
// Deterministic: same seed -> same town history.

import { RESOURCES, SKILLS, GUILDS, BUILDINGS, CITIZEN_NAMES, COURSES, HONOURS } from './data.js';
import { DECREE_BY_KEY } from './decrees.js';

const POPULATION = 66;
const COHORT_COUNT = 6;
const COHORT_GAP = 4;          // days between cohorts starting their finals push
const PASS_MARK = 0.62;        // mastery needed to sit finals
const SUPPORT_FLOOR = 0.72;    // nobody is left performing below this
const COMMONS_CAP = 1200;      // anything above this is spent back on the commons
const START_STOCK = { energy: 260, food: 300, materials: 220, data: 180, compute: 150, credits: 360, knowledge: 340, care: 420 };
// Daily draw per citizen: the town actually spends what it makes.
const UPKEEP = { food: 0.22, energy: 0.16, materials: 0.12, data: 0.10, compute: 0.05, credits: 0.30, knowledge: 0.26, care: 0.42 };

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const round2 = (v) => Math.round(v * 100) / 100;

function honoursFor(score) {
  return HONOURS.find((h) => score >= h.min) || HONOURS[HONOURS.length - 1];
}

export function performanceBand(p) {
  if (p >= 0.95) return { label: 'Exemplary', color: '#6fe3d4' };
  if (p >= 0.86) return { label: 'Excellent', color: '#8fd694' };
  if (p >= 0.78) return { label: 'Strong', color: '#f6c453' };
  return { label: 'Solid', color: '#ffc98f' };
}

function buildPosts() {
  const posts = [];
  for (const b of BUILDINGS) {
    for (const p of b.posts) {
      for (let i = 0; i < p.seats; i++) {
        posts.push({
          id: `${b.id}:${p.title}:${i}`,
          buildingId: b.id,
          title: p.title,
          skill: p.skill,
          chartered: false,
          holder: null,
        });
      }
    }
  }
  return posts;
}

function buildCitizens(rand) {
  const citizens = [];
  let n = 0;
  GUILDS.forEach((guild, gi) => {
    CITIZEN_NAMES[guild.id].forEach((name, i) => {
      const aptitudes = {};
      for (const s of SKILLS) aptitudes[s] = round2(0.28 + rand() * 0.26);
      aptitudes[guild.skill] = round2(0.80 + rand() * 0.18);
      // two secondary strengths so placement has real choices
      const others = SKILLS.filter((s) => s !== guild.skill);
      for (let k = 0; k < 2; k++) {
        const s = others[Math.floor(rand() * others.length)];
        aptitudes[s] = round2(clamp(aptitudes[s] + 0.22 + rand() * 0.18, 0, 0.95));
      }
      citizens.push({
        id: `a${String(n).padStart(2, '0')}`,
        index: n,
        name,
        guild: guild.id,
        guildIndex: gi,
        aptitudes,
        stage: 'student',            // student -> graduate -> employed
        cohort: n % COHORT_COUNT,
        mastery: round2(0.10 + rand() * 0.16),
        courses: Object.fromEntries(COURSES.map((c) => [c.id, 0])),
        gpa: 0,
        honours: null,
        graduatedOn: null,
        hiredOn: null,
        post: null,
        role: null,
        location: 'academy',
        level: 1,
        xp: 0,
        performance: 0,
        streak: 0,
        mentor: null,
        mentored: 0,
        wellbeing: round2(0.72 + rand() * 0.2),
        highlights: [],
      });
      n++;
    });
  });
  return citizens;
}

export function createTown(seed = 66) {
  const rand = mulberry32(seed);
  const town = {
    day: 0,
    rand,
    citizens: buildCitizens(rand),
    posts: buildPosts(),
    resources: { ...START_STOCK },
    flows: Object.fromEntries(RESOURCES.map((r) => [r.id, 0])),
    log: [],
    decrees: [],
    ledger: { graduates: 0, hires: 0, promotions: 0, mentorships: 0, chartered: 0, projects: 0, decrees: 0 },
    history: [],
  };
  say(town, 'town', `\u{1F3D9} Gradient Town opens with ${POPULATION} citizens enrolled at Gradient Academy.`);
  return town;
}

// Write a line into the town record from outside the simulation.
export function note(town, kind, text) { say(town, kind, text); }

function say(town, kind, text) {
  town.log.unshift({ day: town.day, kind, text });
  if (town.log.length > 240) town.log.length = 240;
}

const buildingById = Object.fromEntries(BUILDINGS.map((b) => [b.id, b]));
export const BUILDING_BY_ID = buildingById;

// ------------------------------------------------------------- decrees

// What the standing decrees add up to on any given day.
export function activeModifiers(town) {
  const m = { study: 1, perfAdd: 0, wellAdd: 0, mulDefault: 1, mul: {} };
  for (const d of town.decrees) {
    const e = d.effects || {};
    if (e.study) m.study *= e.study;
    if (e.perfAdd) m.perfAdd += e.perfAdd;
    if (e.wellAdd) m.wellAdd += e.wellAdd;
    if (e.mulDefault) m.mulDefault *= e.mulDefault;
    for (const [r, v] of Object.entries(e.mul || {})) m.mul[r] = (m.mul[r] || 1) * v;
  }
  return m;
}

const outputScale = (mods, resource) => (mods.mul[resource] ?? 1) * mods.mulDefault;

function expireDecrees(town) {
  const live = [];
  for (const d of town.decrees) {
    if (d.until > town.day) live.push(d);
    else if (!d.instant) say(town, 'decree', `${d.emoji} ${d.name} has run its course.`);
  }
  town.decrees = live;
}

// Issue an order to the town. Returns { ok, message } — the console shows the message.
export function issueDecree(town, key) {
  const spec = DECREE_BY_KEY[key];
  if (!spec) return { ok: false, message: 'No such decree.' };

  for (const [r, amount] of Object.entries(spec.cost)) {
    if (town.resources[r] < amount) {
      const res = RESOURCES.find((x) => x.id === r);
      return { ok: false, message: `Not enough ${res ? res.name.toLowerCase() : r} — ${spec.name} needs ${amount}, the town has ${Math.floor(town.resources[r])}.` };
    }
  }
  for (const [r, amount] of Object.entries(spec.cost)) town.resources[r] = round2(town.resources[r] - amount);

  const replaced = town.decrees.find((d) => d.slot === spec.slot);
  town.decrees = town.decrees.filter((d) => d.slot !== spec.slot);
  town.decrees.push({
    key: spec.key, slot: spec.slot, name: spec.name, emoji: spec.emoji,
    issued: town.day, until: town.day + spec.days, effects: spec.effects, instant: spec.instant,
  });
  town.ledger.decrees++;

  let extra = '';
  if (spec.once === 'mentorAll') extra = mentorEveryone(town);
  if (spec.once === 'charterPosts') extra = charterAndReassign(town, 3);

  const verb = replaced && replaced.key === spec.key ? 'renewed' : replaced ? `replaces ${replaced.name}` : 'issued';
  const span = spec.instant ? 'takes effect at once' : `${spec.days} days`;
  say(town, 'decree', `${spec.emoji} Decree ${verb}: ${spec.name} — ${span}.${extra ? ' ' + extra : ''}`);
  return { ok: true, message: `${spec.name} — ${span}${extra ? '. ' + extra : ''}` };
}

function mentorEveryone(town) {
  let paired = 0;
  for (const c of town.citizens) {
    if (c.stage === 'employed' && !c.mentor && pairMentor(town, c, 'by decree')) paired++;
  }
  return `${paired} new pairing${paired === 1 ? '' : 's'}.`;
}

// New posts, then a town-wide reshuffle so everyone sits in their best available work.
function charterAndReassign(town, n) {
  const short = [...GUILDS].sort((a, b) => staffOf(town, a.id) - staffOf(town, b.id)).slice(0, n);
  for (const guild of short) {
    const home = BUILDINGS.filter((b) => b.guild === guild.id);
    const b = home[Math.floor(town.rand() * home.length)];
    town.posts.push({
      id: `${b.id}:chartered:${town.posts.length}`,
      buildingId: b.id,
      title: `${guild.domain.split(' ')[0]} Specialist`,
      skill: guild.skill,
      chartered: true,
      holder: null,
    });
    town.ledger.chartered++;
  }

  const employed = town.citizens.filter((c) => c.stage === 'employed');
  if (!employed.length) return `${n} posts chartered.`;
  const meanFit = (list) => list.reduce((a, c) => a + c.aptitudes[c.post.skill], 0) / list.length;
  const before = meanFit(employed);
  const moved = reassignImprovements(town);
  const after = meanFit(employed);
  return `${n} posts chartered, ${moved} moved to work that suits them better — average fit ${Math.round(before * 100)}% \u2192 ${Math.round(after * 100)}%.`;
}

// Move a citizen only when an open post is clearly a better use of them.
function reassignImprovements(town, threshold = 0.05) {
  let moved = 0;
  for (let round = 0; round < 3; round++) {
    let changed = 0;
    for (const c of town.citizens) {
      if (c.stage !== 'employed') continue;
      const current = c.aptitudes[c.post.skill];
      let best = null;
      for (const p of town.posts) {
        if (p.holder) continue;
        const gain = c.aptitudes[p.skill] - current;
        if (gain >= threshold && (!best || gain > best.gain)) best = { post: p, gain };
      }
      if (!best) continue;
      const old = c.post;
      old.holder = null;
      seat(town, c, best.post);
      c.highlights.push(`Moved to ${buildingById[best.post.buildingId].name} on day ${town.day} for a better fit`);
      changed++;
    }
    moved += changed;
    if (!changed) break;
  }
  return moved;
}

// Seat a citizen in a post without the fanfare of a first hiring.
function seat(town, c, post) {
  post.holder = c.id;
  c.post = post;
  c.role = post.title;
  c.location = post.buildingId;
}

const staffOf = (town, guildId) =>
  town.citizens.filter((c) => c.stage === 'employed' && buildingById[c.post.buildingId].guild === guildId).length;

// ---------------------------------------------------------------- phases

function studyPhase(town, mods) {
  for (const c of town.citizens) {
    if (c.stage !== 'student') continue;
    if (town.day < c.cohort * COHORT_GAP) continue;      // staggered intake
    c.location = 'academy';
    const teaching = 1 + facultyStrength(town) * 0.35;
    const focus = 0.055 + town.rand() * 0.05;
    const gain = focus * teaching * (0.85 + c.wellbeing * 0.3) * mods.study;
    c.mastery = round2(clamp(c.mastery + gain, 0, 1));
    // spread progress across the five courses
    const course = COURSES[Math.min(COURSES.length - 1, Math.floor(c.mastery * COURSES.length))];
    c.courses[course.id] = round2(clamp(c.courses[course.id] + gain * 2.2, 0, 1));
    if (c.mastery >= PASS_MARK) sitFinals(town, c);
  }
}

function facultyStrength(town) {
  const faculty = town.citizens.filter((c) => c.stage === 'employed' && buildingOf(c) === 'academy');
  if (!faculty.length) return 0.4;
  return faculty.reduce((a, c) => a + c.performance, 0) / faculty.length;
}

function buildingOf(c) {
  return c.post ? c.post.buildingId : null;
}

function sitFinals(town, c) {
  const effort = c.mastery;
  const support = 0.06 + facultyStrength(town) * 0.06;   // the academy teaches until it lands
  const score = clamp(effort + support + town.rand() * 0.12, 0.7, 1);
  const h = honoursFor(score);
  for (const k of Object.keys(c.courses)) c.courses[k] = round2(clamp(Math.max(c.courses[k], 0.7 + town.rand() * 0.3), 0, 1));
  c.stage = 'graduate';
  c.gpa = round2(score);
  c.honours = h;
  c.graduatedOn = town.day;
  c.location = 'commencement';
  town.ledger.graduates++;
  c.highlights.push(`Graduated day ${town.day} with ${h.label} (${c.gpa.toFixed(2)})`);
  say(town, 'graduation', `${h.emoji} ${c.name} passed finals with ${h.label} — GPA ${c.gpa.toFixed(2)}.`);
}

function fitScore(c, post) {
  const guildBonus = buildingById[post.buildingId].guild === c.guild ? 0.12 : 0;
  return clamp(c.aptitudes[post.skill] + guildBonus + c.gpa * 0.1, 0, 1.2);
}

function placementPhase(town) {
  // Yesterday's graduates are placed today: commencement first, then the offer.
  const graduates = town.citizens.filter((c) => c.stage === 'graduate' && c.graduatedOn < town.day);
  if (!graduates.length) return;
  // Best-fit first: strongest match in the town gets seated first, then re-evaluate.
  graduates.sort((a, b) => b.gpa - a.gpa);
  for (const c of graduates) {
    c.location = 'placement';
    let open = town.posts.filter((p) => !p.holder);
    let post;
    if (!open.length) {
      post = charterPost(town, c);
    } else {
      open.sort((x, y) => fitScore(c, y) - fitScore(c, x));
      post = open[0];
      if (fitScore(c, post) < 0.55) post = charterPost(town, c);   // no bad matches, ever
    }
    hire(town, c, post);
  }
}

function charterPost(town, c) {
  // The town would rather invent a role than leave anyone unplaced.
  const home = BUILDINGS.filter((b) => b.guild === c.guild);
  const b = home[Math.floor(town.rand() * home.length)] || BUILDINGS[0];
  const guild = GUILDS.find((g) => g.id === c.guild);
  const post = {
    id: `${b.id}:chartered:${town.posts.length}`,
    buildingId: b.id,
    title: `${guild.domain.split(' ')[0]} Specialist`,
    skill: guild.skill,
    chartered: true,
    holder: null,
  };
  town.posts.push(post);
  town.ledger.chartered++;
  say(town, 'town', `\u{1F4DC} Council charters a new post at ${b.name} so ${c.name} starts on time.`);
  return post;
}

function hire(town, c, post) {
  post.holder = c.id;
  c.post = post;
  c.role = post.title;
  c.stage = 'employed';
  c.hiredOn = town.day;
  c.location = post.buildingId;
  c.performance = round2(clamp(0.72 + fitScore(c, post) * 0.2, 0.7, 0.95));
  town.ledger.hires++;
  const b = buildingById[post.buildingId];
  c.highlights.push(`Hired day ${town.day} as ${post.title} at ${b.name}`);
  say(town, 'hire', `\u{1F4BC} ${c.name} hired as ${post.title} at ${b.name} (fit ${(fitScore(c, post) * 100) | 0}%).`);
  pairMentor(town, c, 'starting out');
}

function workPhase(town, mods) {
  const staffed = {};
  for (const c of town.citizens) {
    if (c.stage !== 'employed') continue;
    (staffed[c.post.buildingId] ||= []).push(c);
  }
  const flows = Object.fromEntries(RESOURCES.map((r) => [r.id, 0]));
  const careIndex = clamp(town.resources.care / (town.citizens.length * 4), 0.2, 1);

  for (const [bid, crew] of Object.entries(staffed)) {
    const b = buildingById[bid];
    for (const c of crew) {
      const fit = fitScore(c, c.post);
      const mentorBoost = c.mentor ? 0.06 : 0;
      const noise = (town.rand() - 0.4) * 0.06;
      let perf = 0.52 + fit * 0.28 + Math.min(c.level, 6) * 0.012 + (c.wellbeing - 0.75) * 0.12 + careIndex * 0.04 + mentorBoost + noise + mods.perfAdd;
      perf = clamp(perf, 0.4, 1);
      if (perf < SUPPORT_FLOOR) perf = supportAgent(town, c, perf);
      c.performance = round2(perf);

      // scale inputs down (never negative stock) rather than failing outright
      let throttle = 1;
      for (const [r, amt] of Object.entries(b.inputs || {})) {
        const need = amt * perf;
        if (need > 0) throttle = Math.min(throttle, clamp(town.resources[r] / Math.max(need, 0.001), 0, 1));
      }
      throttle = clamp(throttle, 0.35, 1);
      for (const [r, amt] of Object.entries(b.inputs || {})) {
        const used = amt * perf * throttle;
        town.resources[r] = Math.max(0, town.resources[r] - used);
        flows[r] -= used;
      }
      for (const [r, amt] of Object.entries(b.outputs || {})) {
        const made = amt * perf * throttle * outputScale(mods, r);
        town.resources[r] += made;
        flows[r] += made;
      }

      c.xp = round2(c.xp + perf);
      const wbTarget = clamp(0.6 + careIndex * 0.35 + mods.wellAdd, 0.5, 0.98);
      c.wellbeing = round2(clamp(c.wellbeing + (wbTarget - c.wellbeing) * 0.08, 0.5, 0.98));
      if (perf >= 0.96) {
        c.streak++;
        if (c.streak === 5) {
          c.streak = 0;
          town.ledger.projects++;
          const line = `${b.emoji} ${c.name} shipped a standout piece of work at ${b.name}.`;
          c.highlights.push(`Standout result on day ${town.day} at ${b.name}`);
          say(town, 'result', line);
        }
      } else c.streak = Math.max(0, c.streak - 1);

      const nextLevel = c.level * 15;
      if (c.xp >= nextLevel && c.level < 8) {
        c.level++;
        town.ledger.promotions++;
        c.highlights.push(`Promoted to level ${c.level} on day ${town.day}`);
        say(town, 'promotion', `\u{1F53A} ${c.name} promoted to level ${c.level} — now ${seniority(c.level)} at ${b.name}.`);
      }
    }
  }
  town.flows = Object.fromEntries(Object.entries(flows).map(([k, v]) => [k, round2(v)]));
}

export function seniority(level) {
  if (level >= 7) return 'Guild Master';
  if (level >= 5) return 'Senior Practitioner';
  if (level >= 3) return 'Practitioner';
  return 'Associate';
}

// Every new hire gets a senior alongside them for their first fortnight.
function pairMentor(town, c, reason) {
  if (c.mentor) return false;
  const pool = town.citizens.filter(
    (m) => m.stage === 'employed' && m.id !== c.id && m.level >= 2 && m.mentored < 3 && m.performance >= 0.8,
  );
  if (!pool.length) return false;
  pool.sort((a, b) => (b.guild === c.guild) - (a.guild === c.guild) || b.performance - a.performance);
  const m = pool[0];
  m.mentored++;
  c.mentor = m.id;
  c.mentorUntil = town.day + 14;
  town.ledger.mentorships++;
  say(town, 'support', `\u{1F91D} ${m.name} is mentoring ${c.name} (${reason}).`);
  return true;
}

function releaseMentors(town) {
  for (const c of town.citizens) {
    if (c.mentor && c.mentorUntil && town.day > c.mentorUntil) {
      const m = town.citizens.find((x) => x.id === c.mentor);
      if (m) m.mentored = Math.max(0, m.mentored - 1);
      c.mentor = null;
      c.mentorUntil = null;
    }
  }
}

function supportAgent(town, c, perf) {
  pairMentor(town, c, 'a tough week');
  c.wellbeing = round2(clamp(c.wellbeing + 0.06, 0, 0.98));
  return Math.max(perf, SUPPORT_FLOOR + town.rand() * 0.05);
}

// Once a week the two citizens having the hardest run are paired with a senior.
function skillsExchange(town) {
  const pool = town.citizens
    .filter((c) => c.stage === 'employed' && !c.mentor)
    .sort((a, b) => a.performance - b.performance)
    .slice(0, 2);
  for (const c of pool) pairMentor(town, c, 'skills exchange');
}

function upkeepPhase(town) {
  const people = town.citizens.length;
  for (const [r, per] of Object.entries(UPKEEP)) {
    town.resources[r] = Math.max(0, town.resources[r] - people * per);
  }
  // A store that outgrows what the town can use is spent back on the commons.
  const shared = [];
  for (const r of RESOURCES) {
    if (town.resources[r.id] > COMMONS_CAP) {
      town.resources[r.id] = COMMONS_CAP;
      shared.push(r.name.toLowerCase());
    }
  }
  if (shared.length && town.day % 30 === 0) {
    say(town, 'town', `\u{1F381} Surplus ${shared.join(' and ')} distributed back across the districts.`);
  }
  for (const r of RESOURCES) town.resources[r.id] = round2(Math.min(town.resources[r.id], 9999));
}

// ---------------------------------------------------------------- public API

export function tick(town) {
  town.day++;
  expireDecrees(town);
  releaseMentors(town);
  const mods = activeModifiers(town);
  studyPhase(town, mods);
  placementPhase(town);
  workPhase(town, mods);
  upkeepPhase(town);
  if (town.day % 7 === 0) skillsExchange(town);
  const s = stats(town);
  town.history.push({ day: town.day, employed: s.employed, avg: s.avgPerformance, knowledge: town.resources.knowledge });
  if (town.history.length > 400) town.history.shift();
  if (s.employed === POPULATION && !town.fullEmploymentDay) {
    town.fullEmploymentDay = town.day;
    say(town, 'town', `\u{1F389} Day ${town.day}: all ${POPULATION} citizens have graduated and hold work they are good at.`);
  }
  return town;
}

export function stats(town) {
  const students = town.citizens.filter((c) => c.stage === 'student').length;
  const graduates = town.citizens.filter((c) => c.stage === 'graduate').length;
  const employedList = town.citizens.filter((c) => c.stage === 'employed');
  const avgPerformance = employedList.length
    ? round2(employedList.reduce((a, c) => a + c.performance, 0) / employedList.length)
    : 0;
  const avgGpa = town.ledger.graduates
    ? round2(town.citizens.filter((c) => c.gpa).reduce((a, c) => a + c.gpa, 0) / town.citizens.filter((c) => c.gpa).length)
    : 0;
  const wellbeing = round2(town.citizens.reduce((a, c) => a + c.wellbeing, 0) / town.citizens.length);
  return {
    population: town.citizens.length,
    students,
    graduates,
    employed: employedList.length,
    avgPerformance,
    avgGpa,
    wellbeing,
    openPosts: town.posts.filter((p) => !p.holder).length,
    // Running totals live under `totals` so they can't shadow the live stage counts.
    totals: { ...town.ledger },
    decrees: town.decrees.map((d) => ({ ...d, daysLeft: Math.max(0, d.until - town.day) })),
  };
}

export { POPULATION, BUILDINGS, GUILDS, RESOURCES, COURSES };
