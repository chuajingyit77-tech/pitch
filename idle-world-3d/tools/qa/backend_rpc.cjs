#!/usr/bin/env node
// Every call of the learning backend, through the local stand-in (fakebase.cjs), the way the app and the admin page
// make them: admin accounts and sessions, screens and their setup codes, staff and PIN locks, lesson records, the
// learning archive and its wrong-answer list, reports, drafting, publishing and versions, and what the API role
// cannot do. Ends PASS or lists what failed.
// node idle-world-3d/tools/qa/backend_rpc.cjs     (needs the local PostgreSQL: fakebase.cjs --init)
const fakebase = require('./fakebase.cjs');

let failed = 0, checks = 0;
const ok = (cond, what, got) => { checks++; if (!cond) { failed++; console.log('  FAIL', what, got === undefined ? '' : JSON.stringify(got).slice(0, 300)); } };

(async () => {
  fakebase.init();
  const fb = await fakebase.start();
  const call = async (fn, body) => {
    const r = await fetch(`${fb.url}/rest/v1/rpc/${fn}`, { method: 'POST', headers: { apikey: 'sb_publishable_test', 'content-type': 'application/json' }, body: JSON.stringify(body) });
    const j = await r.json();
    return r.status === 200 ? j : Object.assign({ status: r.status }, j);
  };
  try {
    // ---- the first admin account, from an invite made in SQL
    const [{ c: invite }] = await fb.sql(`select qj.new_invite('test') c`);
    ok(/^[2-9A-HJKMNP-Z]{4}-[2-9A-HJKMNP-Z]{4}$/.test(invite), 'invite code shape', invite);
    ok((await call('admin_claim', { invite_code: 'ZZZZ-ZZZZ', login_name: 'owner', password: 'secret-pass-1', display_name: '老板' })).error === 'code', 'claim: wrong code');
    ok((await call('admin_claim', { invite_code: invite, login_name: 'owner', password: 'short', display_name: '老板' })).error === 'password', 'claim: short password');
    ok((await call('admin_claim', { invite_code: invite, login_name: 'o', password: 'secret-pass-1', display_name: '老板' })).error === 'login', 'claim: bad login');
    const claim = await call('admin_claim', { invite_code: ' ' + invite.toLowerCase().replace('-', ' ') + ' ', login_name: ' Owner ', password: 'secret-pass-1', display_name: '老板' });
    ok(claim.ok && claim.session && claim.admin.login === 'owner' && claim.admin.name === '老板', 'claim: ok (code typed loosely)', claim);
    ok((await call('admin_claim', { invite_code: invite, login_name: 'owner2', password: 'secret-pass-1', display_name: 'x' })).error === 'code', 'claim: code used once');
    const adm = claim.session;
    ok((await call('admin_login', { login_name: 'owner', password: 'nope-nope' })).error === 'login', 'admin login: wrong password');
    const login2 = await call('admin_login', { login_name: 'OWNER', password: 'secret-pass-1' });
    ok(login2.ok && login2.session && login2.session !== adm, 'admin login: ok', login2);
    let st = await call('admin_state', { token: adm });
    ok(st.ok && st.lessons.length === 2 && st.guardians.length === 1 && st.employees.length === 0 && st.admins.length === 1, 'admin state: demo content', st);
    ok(st.lessons.every(l => l.status === 'published' && l.demo && l.problems.length === 0), 'demo lessons published, no problems', st.lessons);
    ok((await call('admin_logout', { token: login2.session })).ok, 'admin logout');
    ok((await call('admin_state', { token: login2.session })).error === 'auth', 'admin state after logout: auth');
    ok((await call('admin_state', { token: 'x'.repeat(48) })).error === 'auth', 'admin state with a made-up token: auth');
    ok((await call('admin_password', { token: adm, old_password: 'wrong-wrong', new_password: 'another-pass-2' })).error === 'old', 'password change: old wrong');
    ok((await call('admin_password', { token: adm, old_password: 'secret-pass-1', new_password: 'another-pass-2' })).ok, 'password change');
    ok((await call('admin_login', { login_name: 'owner', password: 'another-pass-2' })).ok, 'admin login with the new password');
    const inv2 = await call('admin_new_invite', { token: adm, note: '店长' });
    ok(inv2.ok && /^[2-9A-Z]{4}-[2-9A-Z]{4}$/.test(inv2.code), 'new invite from the admin page', inv2);

    // ---- a screen
    const dv = await call('admin_device', { token: adm, device_label: '前台 iPad' });
    ok(dv.ok && dv.id && /^[2-9A-Z]{4}-[2-9A-Z]{4}$/.test(dv.code), 'new device with setup code', dv);
    ok((await call('kiosk_register', { setup_code: 'AAAA-AAAA' })).error === 'code', 'register: wrong code');
    const reg = await call('kiosk_register', { setup_code: dv.code.toLowerCase(), device_label: '大厅' });
    ok(reg.ok && reg.token && reg.token.length === 48 && reg.device.label === '大厅', 'register: ok', reg);
    ok((await call('kiosk_register', { setup_code: dv.code })).error === 'code', 'register: code used once');
    const dev = reg.token;
    let boot = await call('kiosk_bootstrap', { device_token: dev });
    ok(boot.ok && boot.lessons.length === 2 && boot.guardians[0].id === 'heron' && boot.guardians[0].lines.hello.length === 4 && boot.staff.length === 0, 'bootstrap', boot);
    ok(boot.lessons[0].slug === 'complaint' && boot.lessons[0].steps.length === 10 && boot.lessons[0].version === 1, 'bootstrap lesson content', boot.lessons[0]);
    ok((await call('kiosk_bootstrap', { device_token: 'f'.repeat(48) })).error === 'device', 'bootstrap: unknown device');

    // ---- staff
    ok((await call('admin_save_employee', { token: adm, employee: { name: '小明', dept: '客服' } })).error === 'pin', 'new employee needs a PIN');
    ok((await call('admin_save_employee', { token: adm, employee: { name: '小明', dept: '客服', pin: '12a4' } })).error === 'pin', 'PIN is 4 digits');
    ok((await call('admin_save_employee', { token: adm, employee: { name: '  ', pin: '1234' } })).error === 'name', 'name needed');
    const e1 = await call('admin_save_employee', { token: adm, employee: { name: '小明', dept: '客服', role: '专员', pin: '1234' } });
    ok(e1.ok && e1.id, 'employee added', e1);
    ok((await call('admin_save_employee', { token: adm, employee: { name: '小明', dept: '客服', pin: '9999' } })).error === 'taken', 'same name in a department: taken');
    const e2 = await call('admin_save_employee', { token: adm, employee: { name: '小红', dept: '销售', pin: '5678' } });
    ok(e2.ok, 'second employee');
    boot = await call('kiosk_bootstrap', { device_token: dev });
    ok(boot.staff.length === 2 && boot.staff.every(s => !('pin_hash' in s)), 'staff on the screen, names only', boot.staff);

    // ---- sign in, wrong PINs, the lock
    let li = await call('kiosk_login', { device_token: dev, employee: e1.id, pin: '0000' });
    ok(li.error === 'pin' && li.left === 4, 'wrong PIN: 4 left', li);
    for (let i = 0; i < 3; i++) li = await call('kiosk_login', { device_token: dev, employee: e1.id, pin: '0000' });
    ok(li.error === 'pin' && li.left === 1, 'wrong PIN: 1 left', li);
    li = await call('kiosk_login', { device_token: dev, employee: e1.id, pin: '0000' });
    ok(li.error === 'locked' && li.wait === 900, 'fifth wrong PIN locks', li);
    li = await call('kiosk_login', { device_token: dev, employee: e1.id, pin: '1234' });
    ok(li.error === 'locked' && li.wait > 890, 'locked even with the right PIN', li);
    st = await call('admin_state', { token: adm });
    ok(st.employees.find(e => e.id === e1.id).locked === true && st.employees.find(e => e.id === e2.id).locked === false, 'admin sees the lock', st.employees);
    ok((await call('admin_unlock', { token: adm, employee: e1.id })).ok, 'unlock');
    li = await call('kiosk_login', { device_token: dev, employee: e1.id, pin: '1234' });
    ok(li.ok && li.session && li.archive.employee.name === '小明' && Object.keys(li.archive.progress).length === 0, 'sign in', li);
    ok((await call('kiosk_login', { device_token: 'e'.repeat(48), employee: e1.id, pin: '1234' })).error === 'device', 'sign in needs a registered screen');
    const sess = li.session;
    const shared = await fb.sql(`select round(extract(epoch from s.expires_at - now()) / 3600) hours from qj.sessions s where s.token_hash = qj.h($1)`, [sess]);
    ok(shared.length === 1 && +shared[0].hours === 12, 'shared screen: signed in for 12 hours', shared);
    ok((await call('kiosk_archive', { device_token: dev, session_token: sess })).ok, 'archive');

    // ---- a lesson played through: one slip, then right; a second question right first time; done with 2 stars
    const L = boot.lessons.find(l => l.slug === 'complaint');
    const t0 = Date.now() - 120000; // (events are sent after they happen; the server takes no time from the future)
    const at = s => new Date(t0 + s * 1000).toISOString();
    let rec = await call('kiosk_record', { device_token: dev, session_token: sess, events: [
      { type: 'start', lesson: L.id, version: 1, at: at(0) },
      { type: 'step', lesson: L.id, version: 1, step: 1, at: at(1) },
      { type: 'step', lesson: L.id, version: 1, step: 3, at: at(2) },
      { type: 'answer', lesson: L.id, version: 1, step: 3, choice: 0, correct: false, first: true, at: at(3) },
      { type: 'answer', lesson: L.id, version: 1, step: 3, choice: 1, correct: true, first: false, at: at(4) },
      { type: 'step', lesson: L.id, version: 1, step: 6, at: at(5) },
    ] });
    ok(rec.ok && rec.n === 6, 'record: six events', rec);
    let pg = rec.archive.progress[L.id];
    ok(pg && pg.step === 6 && pg.slips === 1 && !pg.done, 'progress halfway: step 6, one slip', pg);
    rec = await call('kiosk_record', { device_token: dev, session_token: sess, events: [
      { type: 'answer', lesson: L.id, version: 1, step: 6, choice: 2, correct: true, first: true, at: at(6) },
      { type: 'done', lesson: L.id, version: 1, stars: 2, badge: true, at: at(7) },
      { type: 'done', lesson: 'not-a-uuid', version: 1, stars: 3, badge: true },
      { type: 'eat', lesson: L.id },
      { type: 'answer', lesson: L.id, version: 1 },
      { type: 'step', lesson: '00000000-0000-0000-0000-000000000000', step: 2 },
    ] });
    ok(rec.ok && rec.n === 2, 'record: malformed events skipped', rec);
    pg = rec.archive.progress[L.id];
    ok(pg.done && pg.stars === 2 && pg.runs === 1 && pg.doneVersion === 1 && pg.step === 0 && pg.firstDone && pg.seconds === 7, 'done: 2 stars, run 1, 7 seconds', pg);
    ok(JSON.stringify(rec.archive.badges) === '["接待之道"]', 'badge from the lesson', rec.archive.badges);
    ok(rec.archive.misses.length === 1 && rec.archive.misses[0].step === 3 && rec.archive.misses[0].choice === 0 && rec.archive.misses[0].lesson === L.id, 'wrong-answer list: step 3', rec.archive.misses);
    ok((await call('kiosk_record', { device_token: dev, session_token: sess, events: { type: 'start' } })).error === 'events', 'record: events must be a list');
    ok((await call('kiosk_record', { device_token: dev, session_token: 'nope'.repeat(12), events: [] })).error === 'session', 'record: unknown session');
    // a second run: right first time at step 3, 3 stars, a badge not given twice
    rec = await call('kiosk_record', { device_token: dev, session_token: sess, events: [
      { type: 'start', lesson: L.id, version: 1, at: at(20) },
      { type: 'answer', lesson: L.id, version: 1, step: 3, choice: 1, correct: true, first: true, at: at(21) },
      { type: 'answer', lesson: L.id, version: 1, step: 6, choice: 0, correct: false, first: true, at: at(22) },
      { type: 'answer', lesson: L.id, version: 1, step: 6, choice: 2, correct: true, first: false, at: at(23) },
      { type: 'done', lesson: L.id, version: 1, stars: 3, badge: true, at: at(24) },
    ] });
    pg = rec.archive.progress[L.id];
    ok(pg.stars === 3 && pg.runs === 2 && rec.archive.badges.length === 1 && pg.seconds === 11, 'second run: 3 stars, run 2, one badge, 11 seconds in all', pg);
    ok(rec.archive.misses.length === 1 && rec.archive.misses[0].step === 6, 'wrong-answer list follows the latest first answer', rec.archive.misses);
    // the wrong-answer review: answered right, the question leaves the list (and the run's figures stay as they were)
    rec = await call('kiosk_record', { device_token: dev, session_token: sess, events: [
      { type: 'answer', lesson: L.id, version: 1, step: 6, choice: 2, correct: true, first: true, review: true, at: at(30) },
    ] });
    ok(rec.ok && rec.archive.misses.length === 0 && rec.archive.progress[L.id].slips === 0, 'review answered right: off the list', rec.archive);
    // an event from a screen whose clock is far off: kept, within the last 30 days
    rec = await call('kiosk_record', { device_token: dev, session_token: sess, events: [{ type: 'step', lesson: L.id, version: 1, step: 2, at: '1999-01-01T00:00:00Z' }] });
    ok(rec.ok && rec.n === 1, 'event with an odd clock kept');

    // ---- the admin's view of it
    st = await call('admin_state', { token: adm });
    const se = st.employees.find(e => e.id === e1.id), sl = st.lessons.find(l => l.id === L.id);
    ok(se.finished === 1 && se.stars === 3 && se.badges === 1 && se.answered === 4 && se.right === 2 && se.seconds === 11 && se.lastActive, 'admin: employee figures (review answers apart)', se);
    ok(sl.started === 1 && sl.finished === 1 && +sl.avgStars === 3 && +sl.avgSeconds === 6, 'admin: lesson figures', sl);
    ok(st.recent.length === 1 && st.recent[0].employee === '小明' && st.recent[0].stars === 3, 'admin: latest finishes', st.recent);
    const rep = await call('admin_lesson_report', { token: adm, lesson: L.id });
    ok(rep.ok && rep.learners.length === 1 && rep.learners[0].current && rep.questions.length === 2, 'lesson report', rep);
    const q3 = rep.questions.find(q => q.step === 3);
    ok(q3 && q3.answers === 2 && q3.right === 1 && q3.choices['0'] === 1 && q3.choices['1'] === 1, 'lesson report: first answers at step 3', q3);
    const er = await call('admin_employee_report', { token: adm, employee: e1.id });
    ok(er.ok && er.answers.length === 7 && er.answers[0].title === L.title && er.answers[0].review === true, 'employee report', er);
    const q6 = rep.questions.find(q => q.step === 6);
    ok(q6 && q6.answers === 2 && q6.right === 1, 'lesson report: review answers apart', q6);

    // ---- making a lesson: draft, problems, publish, edit (version), archive, delete
    let sv = await call('admin_save_lesson', { token: adm, lesson: { title: '新课', guardian: 'heron' } });
    ok(sv.ok && sv.id && sv.problems.includes('还没有内容'), 'new draft: no content yet', sv);
    const nid = sv.id;
    ok((await call('admin_lesson_status', { token: adm, lesson: nid, status: 'published' })).error === 'problems', 'draft with problems cannot be published');
    sv = await call('admin_save_lesson', { token: adm, lesson: { id: nid, steps: [{ say: '第一句' }, { ask: '题目', options: [{ text: '甲' }, { text: '乙' }] }, { card: { title: '要点', items: [] } }, { say: '' }] } });
    ok(JSON.stringify(sv.problems) === JSON.stringify(['第 2 步：正确答案要正好一个', '第 3 步：要点卡没有内容', '第 4 步：这句话是空的']), 'problems listed in Chinese', sv.problems);
    sv = await call('admin_save_lesson', { token: adm, lesson: { id: nid, keys: '一 · 二', badge: '新徽章', tags: ['客服', ' '], steps: [{ say: '第一句' }, { ask: '题目', options: [{ text: '甲', ok: true, reply: '对' }, { text: '乙', reply: '不对' }] }, { card: { title: '要点', items: [['一', '说明']] } }] } });
    ok(sv.ok && sv.problems.length === 0 && sv.version === 1, 'draft fixed', sv);
    ok((await call('admin_lesson_status', { token: adm, lesson: nid, status: 'published' })).ok, 'publish');
    boot = await call('kiosk_bootstrap', { device_token: dev });
    ok(boot.lessons.length === 3 && boot.lessons.some(l => l.id === nid && l.badge === '新徽章' && JSON.stringify(l.tags) === '["客服"]'), 'published lesson on the screen', boot.lessons.map(l => l.title));
    sv = await call('admin_save_lesson', { token: adm, lesson: { id: nid, steps: [{ say: '' }] } });
    ok(sv.error === 'problems', 'a published lesson is checked before it changes', sv);
    sv = await call('admin_save_lesson', { token: adm, lesson: { id: nid, about: '只改了简介' } });
    ok(sv.ok && sv.version === 1, 'small change keeps the version', sv);
    sv = await call('admin_save_lesson', { token: adm, lesson: { id: L.id, title: '接待投诉的四个字（新）' } });
    ok(sv.ok && sv.version === 2, 'changed content: version 2', sv);
    const arc = await call('kiosk_archive', { device_token: dev, session_token: sess });
    ok(arc.archive.misses.length === 0 && arc.archive.progress[L.id].version === 1, 'old version\'s wrong answers leave the list', arc.archive);
    ok((await call('admin_save_lesson', { token: adm, lesson: { title: 'x', guardian: 'dragon' } })).error === 'guardian', 'unknown guardian');
    ok((await call('admin_lesson_status', { token: adm, lesson: nid, status: 'delete' })).error === 'published', 'a published lesson is not deleted');
    ok((await call('admin_lesson_status', { token: adm, lesson: nid, status: 'archived' })).ok, 'archive');
    boot = await call('kiosk_bootstrap', { device_token: dev });
    ok(boot.lessons.length === 2, 'archived lesson leaves the screen');
    ok((await call('admin_lesson_status', { token: adm, lesson: nid, status: 'delete' })).ok, 'delete');
    ok((await call('admin_lesson_status', { token: adm, lesson: nid, status: 'archived' })).error === 'missing', 'deleted');
    ok((await call('admin_save_guardian', { token: adm, guardian: { id: 'heron', name: '老苍鹭', title: '池边的老师', lines: Object.assign({}, boot.guardians[0].lines, { start: '开始吧。' }) } })).ok, 'guardian lines saved');
    boot = await call('kiosk_bootstrap', { device_token: dev });
    ok(boot.guardians[0].title === '池边的老师' && boot.guardians[0].lines.start === '开始吧。', 'guardian lines on the screen', boot.guardians[0]);

    // ---- the overview figures, and taking someone off the list
    const ov = await call('admin_overview', { token: adm });
    ok(ov.ok && ov.done7 === 1 && ov.learners7 === 1 && ov.answered === 4 && ov.right === 2 && ov.days.length === 1 && ov.days[0].done === 1, 'overview: the last 7 days', ov);
    ok((await call('admin_overview', { token: 'x'.repeat(48) })).error === 'auth', 'overview needs an admin');
    ok((await call('admin_delete_employee', { token: adm, employee: e1.id })).error === 'records', 'someone with a record is not deleted');
    const tmp = await call('admin_save_employee', { token: adm, employee: { name: '写错的名字', pin: '1111' } });
    ok((await call('admin_delete_employee', { token: adm, employee: tmp.id })).ok, 'a name added by mistake is deleted');
    ok((await call('admin_delete_employee', { token: adm, employee: tmp.id })).error === 'missing', 'deleted');

    // ---- a draft made from a document (the drafting job)
    const [{ id: did }] = await fb.sql(`select qj.import_draft($1::jsonb, $2::jsonb) id`, [JSON.stringify({ title: '退货流程', keys: '查 · 收 · 退', steps: [{ say: '退货先查单。' }], tags: ['售后'] }), JSON.stringify({ id: 'drive:abc123', name: '退货SOP.docx', url: 'https://drive.google.com/file/d/abc123', mime: 'application/vnd.google-apps.document', modified: new Date().toISOString() })]);
    st = await call('admin_state', { token: adm });
    const dl = st.lessons.find(l => l.id === did);
    ok(dl && dl.status === 'draft' && dl.source.name === '退货SOP.docx' && st.sources.length === 1 && st.sources[0].lesson === did && st.sources[0].status === 'drafted', 'document draft and its source', { dl, src: st.sources });

    // ---- sign out, offline events after it, people and screens taken off
    ok((await call('kiosk_logout', { device_token: dev, session_token: sess })).ok, 'sign out');
    ok((await call('kiosk_archive', { device_token: dev, session_token: sess })).error === 'session', 'session ended');
    rec = await call('kiosk_record', { device_token: dev, session_token: sess, events: [{ type: 'step', lesson: L.id, version: 2, step: 1 }] });
    ok(rec.ok && rec.n === 1, 'events kept offline still count after sign out', rec);
    const li2 = await call('kiosk_login', { device_token: dev, employee: e2.id, pin: '5678' });
    ok(li2.ok, 'second employee signs in');
    ok((await call('admin_save_employee', { token: adm, employee: { id: e2.id, name: '小红', active: false } })).ok, 'deactivate employee');
    ok((await call('kiosk_archive', { device_token: dev, session_token: li2.session })).error === 'session', 'deactivated: signed out');
    ok((await call('kiosk_login', { device_token: dev, employee: e2.id, pin: '5678' })).error === 'who', 'deactivated: cannot sign in');
    boot = await call('kiosk_bootstrap', { device_token: dev });
    ok(boot.staff.length === 1, 'deactivated: off the list');
    ok((await call('admin_save_employee', { token: adm, employee: { id: e1.id, name: '小明', pin: '4321' } })).ok, 'new PIN');
    ok((await call('kiosk_login', { device_token: dev, employee: e1.id, pin: '4321' })).ok, 'sign in with the new PIN');
    const nc = await call('admin_device', { token: adm, device: dv.id, new_code: true });
    ok(nc.ok && nc.code && nc.code !== dv.code, 'new setup code', nc);
    ok((await call('kiosk_bootstrap', { device_token: dev })).error === 'device', 'old registration stops');
    const reg2 = await call('kiosk_register', { setup_code: nc.code });
    ok(reg2.ok && reg2.device.label === '大厅', 're-registered, label kept', reg2);
    ok((await call('admin_device', { token: adm, device: dv.id, active: false })).ok, 'screen taken off');
    ok((await call('kiosk_bootstrap', { device_token: reg2.token })).error === 'device', 'screen off: refused');
    st = await call('admin_state', { token: adm });
    ok(st.devices.length === 1 && st.devices[0].active === false && st.devices[0].registered, 'admin sees the screen', st.devices);

    // ---- staff phones: a team code for three, signed in for 30 days; the PIN throttle per screen
    const jc = await call('admin_join_code', { token: adm, code_label: '员工手机', uses: 3, days: 7 });
    ok(jc.ok && /^[2-9A-Z]{4}-[2-9A-Z]{4}$/.test(jc.code), 'team code', jc);
    const phones = [];
    for (let i = 0; i < 4; i++) phones.push(await call('kiosk_register', { setup_code: jc.code, device_label: '' }));
    ok(phones.slice(0, 3).every((p, i) => p.ok && p.device.personal && p.device.label === '员工手机 ' + (i + 1)) && phones[3].error === 'code', 'team code: three phones, then no more', phones);
    const pli = await call('kiosk_login', { device_token: phones[0].token, employee: e1.id, pin: '4321' });
    const [{ hours }] = await fb.sql(`select round(extract(epoch from s.expires_at - now()) / 3600) hours from qj.sessions s where s.token_hash = qj.h($1)`, [pli.session]);
    ok(pli.ok && +hours === 720, 'personal phone: signed in for 30 days', hours);
    // a batch sent twice (the answer to the first send was lost) counts once
    const bid = 'b' + Date.now().toString(36) + 'xyzw';
    const evs = [{ type: 'start', lesson: L.id, version: 2, at: at(40) }, { type: 'done', lesson: L.id, version: 2, stars: 1, badge: true, at: at(50) }];
    const b1 = await call('kiosk_record', { device_token: phones[0].token, session_token: pli.session, events: evs, batch: bid });
    ok(b1.ok && b1.n === 2 && b1.archive.progress[L.id].runs === 3 && b1.archive.progress[L.id].doneVersion === 2, 'batch recorded', b1);
    const b2 = await call('kiosk_record', { device_token: phones[0].token, session_token: pli.session, events: evs, batch: bid });
    ok(b2.ok && b2.n === 0 && b2.again === true && b2.archive.progress[L.id].runs === 3, 'the same batch again: not counted twice', b2);
    ok((await call('kiosk_record', { device_token: phones[0].token, session_token: pli.session, events: [], batch: 'short' })).error === 'batch', 'batch id checked');
    ok(b1.archive.answered === 4 && b1.archive.right === 2, 'the record carries the first-answer figures', { answered: b1.archive.answered, right: b1.archive.right });
    // a personal phone in use keeps its session alive
    await fb.sql(`update qj.sessions set expires_at = now() + interval '1 day' where token_hash = qj.h($1)`, [pli.session]);
    ok((await call('kiosk_archive', { device_token: phones[0].token, session_token: pli.session })).ok, 'archive from the phone');
    const [{ days }] = await fb.sql(`select round(extract(epoch from expires_at - now()) / 86400) days from qj.sessions where token_hash = qj.h($1)`, [pli.session]);
    ok(+days === 30, 'personal session in use: 30 days again', days);
    st = await call('admin_state', { token: adm });
    ok(st.joinCodes.length === 1 && st.joinCodes[0].used === 3 && st.joinCodes[0].left === 0 && !st.joinCodes[0].live && st.devices.filter(d => d.personal).length === 3, 'admin sees the team code used up', st.joinCodes);
    const jc2 = await call('admin_join_code', { token: adm, code_label: '新人' });
    ok((await call('admin_join_code', { token: adm, stop: jc2.id })).ok && (await call('kiosk_register', { setup_code: jc2.code })).error === 'code', 'team code stopped');
    // (a name already locked does not count again: eight people, four wrong PINs each)
    const crowd = [];
    for (let i = 0; i < 8; i++) crowd.push((await call('admin_save_employee', { token: adm, employee: { name: '同事' + i, dept: '测试', pin: '2468' } })).id);
    let busy = 0, locks = 0;
    for (let i = 0; i < 32; i++) {
      const r = await call('kiosk_login', { device_token: phones[1].token, employee: crowd[i % 8], pin: '0000' });
      if (r.error === 'busy') busy++; if (r.error === 'locked') locks++;
    }
    ok(busy === 2, 'thirty wrong PINs on one screen: it must wait', { busy, locks });
    ok((await call('kiosk_login', { device_token: phones[2].token, employee: e1.id, pin: '0000' })).error !== 'busy', 'other screens unaffected');

    // ---- the API's limits, as on Supabase
    const nf = await call('kiosk_bootstrap', { device_token: dev, extra: 1 });
    ok(nf.status === 404, 'unknown argument: 404 (PostgREST)', nf);
    ok((await call('kiosk_login', { device_token: dev })).status === 404, 'missing argument: 404');
    for (let i = 0; i < 40; i++) await call('kiosk_register', { setup_code: 'BAD' + i });
    ok((await call('kiosk_register', { setup_code: nc.code })).error === 'busy', 'register throttled after 40 wrong codes');
    const deny = async q => { try { await fb.sql(`begin; set local role anon; ${q}; commit;`); return false; } catch (e) { await fb.sql('rollback'); return /permission denied/.test(e.message); } };
    ok(await deny('select * from qj.employees'), 'anon: no tables');
    ok(await deny(`select qj.h('x')`), 'anon: no helpers');
    ok(await deny(`select qj.new_invite('x')`), 'anon: no invites');
    const exposed = await fb.sql(`select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and has_function_privilege('anon', p.oid, 'execute') order by 1`);
    const API = ['admin_claim', 'admin_delete_employee', 'admin_device', 'admin_employee_report', 'admin_join_code', 'admin_lesson_report', 'admin_lesson_status', 'admin_login',
      'admin_logout', 'admin_new_invite', 'admin_overview', 'admin_password', 'admin_save_employee', 'admin_save_guardian', 'admin_save_lesson', 'admin_state',
      'admin_unlock', 'kiosk_archive', 'kiosk_bootstrap', 'kiosk_login', 'kiosk_logout', 'kiosk_record', 'kiosk_register'];
    ok(JSON.stringify(exposed.map(r => r.proname)) === JSON.stringify(API), 'anon may call only the kiosk_/admin_ functions', exposed.map(r => r.proname));
    const signedIn = await fb.sql(`select count(*)::int n from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname in ('public', 'qj') and has_function_privilege('authenticated', p.oid, 'execute')`);
    ok(signedIn[0].n === 0, 'the role authenticated calls nothing (no Supabase Auth here)', signedIn);
    const definer = await fb.sql(`select p.proname, p.prosecdef, p.proconfig from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname in ('public', 'qj')`);
    ok(definer.every(r => r.proconfig && r.proconfig.includes('search_path=""')), 'every function has an empty search path', definer.filter(r => !(r.proconfig || []).includes('search_path=""')));
    const rls = await fb.sql(`select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'qj' and c.relkind = 'r' and not c.relrowsecurity`);
    ok(rls.length === 0, 'row level security on every table', rls);
    const secrets = await fb.sql(`select count(*)::int n from qj.employees where pin_hash ~ '^[0-9]{4}$'`);
    ok(secrets[0].n === 0, 'PINs only as hashes');
  } catch (e) {
    failed++; console.log('  ERROR', e.stack);
  } finally {
    await fb.stop();
  }
  console.log(failed ? `FAIL: ${failed} of ${checks} checks` : `PASS: ${checks} checks`);
  process.exit(failed ? 1 : 0);
})();
