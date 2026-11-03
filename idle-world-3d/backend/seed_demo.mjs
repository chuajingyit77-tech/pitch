#!/usr/bin/env node
// Writes backend/002_demo_seed.sql: the guardians and the demo lessons of lessons/index.js, for a new backend.
// node backend/seed_demo.mjs
// Guardians are brought up to date each time; a lesson already there (by its slug) is left as the admin page has it.
import { GUARDIANS, LESSONS } from '../lessons/index.js';
import { writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';

const here = path.dirname(fileURLToPath(import.meta.url));
const q = s => s == null ? 'null' : `'${String(s).replace(/'/g, "''")}'`;
const j = v => v == null ? 'null' : `$j$${JSON.stringify(v)}$j$::jsonb`;
const out = [
  '-- 栖境 · demo content for a new learning backend (made by backend/seed_demo.mjs from lessons/index.js; do not edit)',
  'begin;',
];
GUARDIANS.forEach((g, gi) => {
  const { id, world, name, title, portrait, lessons, ...lines } = g;
  out.push(`insert into qj.guardians (id, world, name, title, portrait, lines, sort) values (${q(id)}, ${q(world)}, ${q(name)}, ${q(title)}, ${q(portrait)}, ${j(lines)}, ${gi * 10})
  on conflict (id) do update set world = excluded.world, name = excluded.name, title = excluded.title, portrait = excluded.portrait,
    lines = excluded.lines, sort = excluded.sort, updated_at = now();`);
  lessons.forEach((slug, li) => {
    const l = LESSONS[slug];
    out.push(`insert into qj.lessons (slug, guardian_id, status, title, keys, about, minutes, demo, badge, reward, steps, outro, sort, published_at)
  values (${q(slug)}, ${q(id)}, 'published', ${q(l.title)}, ${q(l.keys || '')}, ${q(l.about || '')}, ${l.minutes || 3}, ${!!l.demo}, ${q(l.badge)},
    ${j(l.reward)}, ${j(l.steps)}, ${q(l.outro || '')}, ${gi * 100 + li * 10}, now())
  on conflict (slug) do nothing;`);
  });
});
out.push('commit;', '');
writeFileSync(path.join(here, '002_demo_seed.sql'), out.join('\n'));
console.log('backend/002_demo_seed.sql:', GUARDIANS.length, 'guardians,', GUARDIANS.reduce((n, g) => n + g.lessons.length, 0), 'lessons');
