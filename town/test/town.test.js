// Tests for the submission and review system.
// Run: node --test   (or: node --test town/test/town.test.js)

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';

import { AGENTS, AGENT_BY_ID, GUILD_ROLES, DOC_TYPES, agentsForGuild, agentsForDocType } from '../core/agents.data.js';
import { RULES, RULE_IDS, runRule, makeContext } from '../core/rules.js';
import { extractText, readZipEntries } from '../core/extract.js';
import { classify, normaliseType, guessTypeFromText, slug, parseManifestCsv } from '../core/classify.js';
import { review, reportMarkdown, systemPrompt, userPrompt } from '../core/review.js';
import { createLocalDrive, fileKey } from '../core/drive.js';
import { runInbox } from '../core/pipeline.js';
import { createModel, resolveModelConfig, extractJson, PRESETS } from '../core/llm.js';
import { loadConfig } from '../core/config.js';

const FIXTURES = resolve(import.meta.dirname, '..', '..', 'test-fixtures');

// ---------------------------------------------------------------- the roster

test('66 agents, six per guild, ids unique', () => {
  assert.equal(AGENTS.length, 66);
  assert.equal(new Set(AGENTS.map(a => a.id)).size, 66);
  for (const guild of Object.keys(GUILD_ROLES)) {
    assert.equal(agentsForGuild(guild).length, 6, `${guild} should have six`);
  }
  assert.equal(Object.keys(GUILD_ROLES).length, 11);
});

test('every agent has a complete, usable SOP', () => {
  for (const a of AGENTS) {
    assert.ok(a.name && a.title && a.duty, `${a.id} missing a name/title/duty`);
    assert.ok(GUILD_ROLES[a.guild], `${a.id} has unknown guild ${a.guild}`);
    assert.ok(['rule', 'llm', 'hybrid'].includes(a.engine), `${a.id} bad engine`);
    assert.ok(a.applies.length, `${a.id} applies to nothing`);
    for (const t of a.applies) {
      assert.ok(DOC_TYPES.some(d => d.id === t), `${a.id} applies to unknown type ${t}`);
    }
    assert.ok(a.ask.length > 8, `${a.id} has no question`);
    assert.ok(a.criteria.length >= 3, `${a.id} needs at least three steps, has ${a.criteria.length}`);
    assert.ok(a.verdicts.pass && a.verdicts.flag && a.verdicts.fail, `${a.id} missing a verdict definition`);
    assert.ok(a.out.length >= 1, `${a.id} must say what it does not do`);
    if (a.engine !== 'llm') {
      assert.ok(RULE_IDS.includes(a.ruleId), `${a.id} points at missing rule ${a.ruleId}`);
    }
  }
});

test('each rule is claimed by at least one agent, and no rule is orphaned', () => {
  const used = new Set(AGENTS.filter(a => a.ruleId).map(a => a.ruleId));
  for (const id of RULE_IDS) assert.ok(used.has(id), `rule ${id} is never used`);
});

test('no document type is left without reviewers', () => {
  for (const t of DOC_TYPES) {
    assert.ok(agentsForDocType(t.id).length >= 5, `${t.id} only has ${agentsForDocType(t.id).length} reviewers`);
  }
});

test('two agents never share both a rule and a document type', () => {
  // Shared rules produced duplicate findings in an earlier version.
  const seen = new Map();
  for (const a of AGENTS.filter(x => x.ruleId)) {
    for (const t of a.applies) {
      const key = `${a.ruleId}|${t}`;
      assert.ok(!seen.has(key), `${a.id} and ${seen.get(key)} both run ${a.ruleId} on ${t}`);
      seen.set(key, a.id);
    }
  }
});

// ----------------------------------------------------------------- the rules

test('every rule returns a well-formed result, even on nothing', () => {
  for (const id of RULE_IDS) {
    for (const text of ['', '   ', 'hello world']) {
      const r = runRule(id, makeContext({ text, type: 'proposal' }));
      assert.ok(['pass', 'flag', 'fail', 'skip'].includes(r.verdict), `${id} bad verdict ${r.verdict}`);
      assert.ok(['low', 'medium', 'high'].includes(r.severity), `${id} bad severity`);
      assert.equal(typeof r.finding, 'string');
      assert.ok(r.finding.length > 0, `${id} gave an empty finding`);
    }
  }
});

test('a broken rule name degrades to skip, it does not throw', () => {
  const r = runRule('no_such_rule', makeContext({ text: 'x' }));
  assert.equal(r.verdict, 'skip');
});

test('price: finds money written with a Chinese magnitude', () => {
  const r = RULES.price_stated(makeContext({ text: '第一阶段预算为 450 万令吉，含 SST。报价有效期 30 天。', type: 'proposal' }));
  assert.equal(r.verdict, 'pass');
});

test('price: a proposal with no money at all fails', () => {
  const r = RULES.price_stated(makeContext({ text: '我们会尽力做好这个项目。', type: 'proposal' }));
  assert.equal(r.verdict, 'fail');
  assert.equal(r.severity, 'high');
});

test('price: a signed contract is not asked for a quotation expiry', () => {
  const contract = makeContext({ text: '月租 RM 3,200，不含税。', type: 'contract' });
  const proposal = makeContext({ text: '月租 RM 3,200，不含税。', type: 'proposal' });
  assert.ok(!RULES.price_stated(contract).finding.includes('有效期'));
  assert.ok(RULES.price_stated(proposal).finding.includes('有效期'));
});

test('arithmetic: catches a total that does not add up', () => {
  const text = ['设计费 RM 10,000', '印刷费 RM 5,000', '安装费 RM 2,000', '总计 RM 20,000'].join('\n');
  const r = RULES.arithmetic(makeContext({ text, type: 'proposal' }));
  assert.equal(r.verdict, 'fail');
  assert.match(r.finding, /17000|17,000/);
});

test('arithmetic: passes a total that does add up', () => {
  const text = ['设计费 RM 10,000', '印刷费 RM 5,000', '总计 RM 15,000'].join('\n');
  assert.equal(RULES.arithmetic(makeContext({ text, type: 'proposal' })).verdict, 'pass');
});

test('arithmetic: says skip rather than pass when there is nothing to add', () => {
  assert.equal(RULES.arithmetic(makeContext({ text: '价格面议。', type: 'proposal' })).verdict, 'skip');
});

test('units: mixed currencies is a hard fail', () => {
  const r = RULES.units_consistent(makeContext({ text: '设计费 RM 10,000，海外部分 USD 3,000。', type: 'proposal' }));
  assert.equal(r.verdict, 'fail');
  assert.deepEqual(new Set(r.data.currencies), new Set(['RM', 'USD']));
});

test('auto-renewal: a short notice window is a hard fail and the window is reported', () => {
  const text = '本合同到期后自动续约一年，除非任何一方在到期前 7 天书面通知对方不再续约。';
  const r = RULES.auto_renewal(makeContext({ text, type: 'contract' }));
  assert.equal(r.verdict, 'fail');
  assert.equal(r.data.noticeDays, 7);
});

test('auto-renewal: no renewal clause at all is not reported as auto-renewal', () => {
  const r = RULES.auto_renewal(makeContext({ text: '本合同为期一年。', type: 'contract' }));
  assert.notEqual(r.verdict, 'fail');
  assert.ok(!r.finding.includes('自动续约，通知期'));
});

test('liability: unlimited wording is caught and quoted', () => {
  const text = '承租人应赔偿出租人一切损失，不受限制。';
  const r = RULES.liability_cap(makeContext({ text, type: 'contract' }));
  assert.equal(r.verdict, 'fail');
  assert.ok(r.evidence.length > 0, 'a hard finding must carry its evidence');
});

test('open-ended deliverables are a fail, not a note', () => {
  const text = '服务内容：品牌设计、包装设计等相关工作，修改至满意。';
  const r = RULES.deliverables_listed(makeContext({ text, type: 'proposal' }));
  assert.equal(r.verdict, 'fail');
  assert.ok(r.data.openEnded.length >= 1);
});

test('figures: a year is not a statistic', () => {
  const r = RULES.figures_sourced(makeContext({ text: '本提案由 Acme 于 2026 年 3 月编制。', type: 'proposal' }));
  assert.equal(r.verdict, 'skip', '一个日期不该被当成需要出处的数据');
});

test('figures: an unsourced claim is flagged, a sourced one is not', () => {
  const bare = RULES.figures_sourced(makeContext({ text: '市场规模增长 45%，客单价提升 30%，复购率提高 20%。', type: 'report' }));
  assert.ok(bare.verdict === 'fail' || bare.verdict === 'flag');
  const cited = RULES.figures_sourced(makeContext({ text: '根据 Nielsen 2026 年零售报告，市场规模增长 45%。', type: 'report' }));
  assert.equal(cited.verdict, 'pass');
});

test('freshness: old data fails, recent data passes', () => {
  const year = new Date().getFullYear();
  const stale = RULES.data_freshness(makeContext({ text: `根据 ${year - 8} 年的市场调查，份额为 12%。另有 ${year - 9} 年数据显示规模为 30 亿。`, type: 'report' }));
  assert.equal(stale.verdict, 'fail');
  const fresh = RULES.data_freshness(makeContext({ text: `根据 ${year} 年的市场调查，份额为 12%。`, type: 'report' }));
  assert.equal(fresh.verdict, 'pass');
});

test('structure: a wall of text with no headings fails', () => {
  const r = RULES.has_structure(makeContext({ text: '句子。'.repeat(500), type: 'report' }));
  assert.equal(r.verdict, 'fail');
});

// -------------------------------------------------------------- reading files

test('reads a plain text file', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'town-'));
  const p = join(dir, 'note.md');
  await writeFile(p, '# 标题\n内容。', 'utf8');
  const r = await extractText(p);
  assert.equal(r.ok, true);
  assert.match(r.text, /标题/);
  await rm(dir, { recursive: true, force: true });
});

test('reads a real PDF, both languages', async () => {
  const en = await extractText(join(FIXTURES, 'tenancy.pdf'));
  assert.equal(en.ok, true);
  assert.match(en.text, /TENANCY AGREEMENT/);
  const zh = await extractText(join(FIXTURES, 'sample-zh.pdf'));
  assert.equal(zh.ok, true);
  assert.match(zh.text, /咖啡/);
});

test('reads a .docx, which artifact storage could never accept', async () => {
  const r = await extractText(join(FIXTURES, 'sample.docx'));
  assert.equal(r.ok, true);
  assert.match(r.text, /RM 45,000/);
  assert.match(r.text, /交付物/);
});

test('zip reader survives a file that is not a zip', async () => {
  await assert.rejects(() => readZipEntries(new Uint8Array([1, 2, 3, 4])), /not a zip/);
});

test('an image comes back as bytes for the model, not as an excuse', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'town-'));
  const png = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex');
  const p = join(dir, 'shot.png');
  await writeFile(p, png);
  const r = await extractText(p);
  assert.equal(r.visual, true);
  assert.equal(r.image.mediaType, 'image/png');
  assert.equal(Buffer.from(r.image.base64, 'base64').length, png.length);
  await rm(dir, { recursive: true, force: true });
});

test('a design source file says what to do instead of failing silently', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'town-'));
  const p = join(dir, 'brand.psd');
  await writeFile(p, 'not really a psd');
  const r = await extractText(p);
  assert.equal(r.ok, false);
  assert.match(r.reason, /导出|PDF|PNG/);
  await rm(dir, { recursive: true, force: true });
});

// ------------------------------------------------------------- classification

test('type aliases map to the right document type', () => {
  assert.equal(normaliseType('报价'), 'proposal');
  assert.equal(normaliseType('Agreement'), 'contract');
  assert.equal(normaliseType('设计'), 'design');
  assert.equal(normaliseType('会议记录'), 'report');
  assert.equal(normaliseType('完全不认识的东西'), null);
});

test('guesses a contract from its own wording', () => {
  assert.equal(guessTypeFromText('本协议由甲方与乙方签订，双方同意以下条款。'), 'contract');
  assert.equal(guessTypeFromText('我们建议分三期进行，总价如下，scope of work 见附件。'), 'proposal');
  assert.equal(guessTypeFromText(''), 'other');
});

test('a filename cannot escape the library', () => {
  assert.ok(!slug('../../etc/passwd').includes('/'));
  assert.ok(!slug('..\\..\\windows').includes('\\'));
  assert.equal(slug('   '), '未命名');
  assert.ok(!slug('a\u0000b').includes('\u0000'));
});

test('the filename convention supplies project, type, author and note', async () => {
  const file = { path: '/nowhere/门店扩张__设计__Fresco__招牌稿.png', name: '门店扩张__设计__Fresco__招牌稿.png', ext: '.png', segments: [], mtimeMs: Date.UTC(2026, 10, 6) };
  const meta = await classify(file, { text: '' });
  assert.equal(meta.project, '门店扩张');
  assert.equal(meta.type, 'design');
  assert.equal(meta.author, 'Fresco');
  assert.equal(meta.note, '招牌稿');
  assert.equal(meta.filename, '2026-11-06_Fresco_招牌稿.png');
});

test('folder placement beats the filename', async () => {
  const file = { path: '/x/办公室租约/合同/whatever.pdf', name: 'whatever.pdf', ext: '.pdf', segments: ['办公室租约', '合同'], mtimeMs: Date.UTC(2026, 10, 6) };
  const meta = await classify(file, { text: '' });
  assert.equal(meta.project, '办公室租约');
  assert.equal(meta.type, 'contract');
});

test('a sidecar beats everything, and guesses are declared', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'town-'));
  await writeFile(join(dir, 'x.pdf'), 'x');
  await writeFile(join(dir, 'x.pdf.town.json'), JSON.stringify({ project: '真项目', type: '合同', author: '真人', note: '真说明' }), 'utf8');
  const file = { path: join(dir, 'x.pdf'), name: 'x.pdf', ext: '.pdf', segments: [], mtimeMs: Date.UTC(2026, 10, 6) };
  const meta = await classify(file, { text: '' });
  assert.equal(meta.project, '真项目');
  assert.equal(meta.type, 'contract');
  assert.equal(meta.author, '真人');
  assert.equal(meta.guessed.length, 0, 'nothing was guessed, so nothing should be declared');
  await rm(dir, { recursive: true, force: true });
});

test('a guess is always reported as a guess', async () => {
  const file = { path: '/x/mystery.pdf', name: 'mystery.pdf', ext: '.pdf', segments: [], mtimeMs: Date.UTC(2026, 10, 6) };
  const meta = await classify(file, { text: '' });
  assert.ok(meta.guessed.length >= 2);
  assert.equal(meta.project, '未归类');
  assert.equal(meta.author, '未署名');
});

test('a Google Form responses CSV is read, whatever the questions are called', () => {
  const csv = ['提交人姓名,项目名称,作品类型,一句话说明,上传文件',
    '张三,门店扩张,提案,第一版,https://drive.google.com/file/d/abc/view?x=1',
    '李四,办公室租约,合同,续约件,plan.pdf'].join('\n');
  const m = parseManifestCsv(csv);
  assert.equal(m.get('view')?.author, '张三');
  assert.equal(m.get('plan.pdf')?.project, '办公室租约');
  assert.equal(m.get('plan.pdf')?.type, '合同');
});

test('a quoted CSV field containing commas survives', () => {
  const csv = '上传文件,说明\na.pdf,"先看第一页, 再看附件"';
  assert.equal(parseManifestCsv(csv).get('a.pdf').note, '先看第一页, 再看附件');
});

// -------------------------------------------------------------- the model gap

test('presets resolve to real endpoints and the env always wins', () => {
  for (const name of Object.keys(PRESETS)) {
    const c = resolveModelConfig({ preset: name }, {});
    assert.ok(c.provider, `${name} has no provider`);
    assert.ok(c.model, `${name} has no default model`);
  }
  const c = resolveModelConfig({ preset: 'deepseek' }, { TOWN_MODEL: 'my-model', TOWN_API_KEY: 'k' });
  assert.equal(c.model, 'my-model');
  assert.equal(c.apiKey, 'k');
  assert.throws(() => resolveModelConfig({ preset: 'nope' }, {}), /Unknown preset/);
});

test('JSON is recovered from fences, from prose, and from nesting', () => {
  assert.deepEqual(extractJson('```json\n{"a":1}\n```'), { a: 1 });
  assert.deepEqual(extractJson('Sure! Here it is: {"a":1} hope that helps'), { a: 1 });
  assert.deepEqual(extractJson('{"a":{"b":[1,2]},"c":"}"}'), { a: { b: [1, 2] }, c: '}' });
  assert.equal(extractJson('no json here'), null);
  assert.equal(extractJson(undefined), null);
});

test('the echo provider proves the pipeline without a network', async () => {
  const model = createModel({ provider: 'echo' }, {});
  const res = await model.ask({ system: 's', prompt: '### 要查的事\n价钱写了吗\n' });
  assert.equal(res.ok, true);
  assert.equal(res.json.verdict, 'flag');
});

test('a model that answers with prose instead of JSON is reported, not guessed at', async () => {
  const model = {
    describe: () => 'broken',
    ask: async () => ({ ok: false, text: 'I think it looks fine', json: null, error: 'Model reply was not JSON' }),
  };
  const r = await review({ name: 'x.md', type: 'proposal', text: 'x'.repeat(200) }, model, { only: ['halo'] });
  const entry = r.entries.find(e => e.agent === 'halo');
  assert.equal(entry.verdict, 'error');
  assert.match(entry.finding, /not JSON/);
});

test('a quote the model invented is removed, and the removal is recorded', async () => {
  const model = {
    describe: () => 'fibber',
    ask: async () => ({ ok: true, json: { verdict: 'fail', finding: '有夸大', evidence: '这句话原文里根本没有', severity: 'high', ask: '改掉' } }),
  };
  const r = await review({ name: 'x.md', type: 'proposal', text: '真实的原文内容。'.repeat(20) }, model, { only: ['halo'] });
  const entry = r.entries.find(e => e.agent === 'halo');
  assert.equal(entry.evidence, '');
  assert.match(entry.evidenceNote, /找不到/);
});

test('a quote the model really copied is kept, whitespace differences allowed', async () => {
  const text = '我们保证三个月内业绩翻倍。';
  const model = {
    describe: () => 'honest',
    ask: async () => ({ ok: true, json: { verdict: 'fail', finding: '承诺了结果', evidence: '我们保证三个月内业绩翻倍。', severity: 'high', ask: '改成尽力' } }),
  };
  const r = await review({ name: 'x.md', type: 'proposal', text: text.repeat(10) }, model, { only: ['halo'] });
  assert.equal(r.entries.find(e => e.agent === 'halo').evidence, text);
});

// ---------------------------------------------------------------- the review

test('with no model, the rule layer still delivers findings', async () => {
  const text = await readFile(join(FIXTURES, 'tenancy.pdf')).then(b => extractText(join(FIXTURES, 'tenancy.pdf'))).then(r => r.text);
  const r = await review({ name: 'tenancy.pdf', type: 'contract', text }, null);
  assert.ok(r.tally.fail >= 2, 'a one-sided tenancy agreement should fail more than one check');
  assert.equal(r.status, 'needs-work');
  // A rule that found nothing to judge says so in its own words; only the
  // checks that needed a model should blame the missing model.
  for (const e of r.entries.filter(e => e.verdict === 'skip' && e.engine === 'llm')) {
    assert.match(e.finding, /没有接模型/);
  }
  for (const e of r.entries.filter(e => e.verdict === 'skip' && e.engine !== 'llm')) {
    assert.ok(e.finding.length > 4 && !e.finding.includes('没有接模型'));
  }
});

test('only and skip narrow the roster', async () => {
  const doc = { name: 'x.md', type: 'proposal', text: 'x'.repeat(200) };
  const one = await review(doc, null, { only: ['ledger'] });
  assert.ok(one.entries.every(e => e.guild === 'ledger'));
  const without = await review(doc, null, { skip: ['ledger'] });
  assert.ok(without.entries.every(e => e.guild !== 'ledger'));
});

test('a hybrid pays for a model only when the rule could not settle it', async () => {
  let asked = 0;
  const model = {
    describe: () => 'counter',
    ask: async () => { asked++; return { ok: true, json: { verdict: 'pass', finding: 'ok', evidence: '', severity: 'low', ask: '' } }; },
  };
  // units_consistent returns a hard fail on mixed currency -> no model needed.
  await review({ name: 'x.md', type: 'proposal', text: '设计费 RM 10,000，海外 USD 3,000。'.repeat(10) }, model, { only: ['vernier'] });
  assert.equal(asked, 0, 'a decided rule should not pay for a model');
});

test('the report names what it could not do', async () => {
  const r = await review({ name: 'scan.pdf', type: 'proposal', text: '', readError: '这份 PDF 是扫描件' }, null);
  const md = reportMarkdown(r);
  assert.match(md, /没跑成的/);
  assert.match(md, /未接模型/);
});

test('prompts carry the job, the steps and the boundary', () => {
  const agent = AGENT_BY_ID.get('lex');
  const sys = systemPrompt(agent);
  assert.match(sys, /只输出 JSON/);
  assert.match(sys, /Nerva/, 'the boundary must name who owns the neighbouring job');
  const user = userPrompt(agent, { name: 'a.pdf', type: 'contract', text: '内容' });
  for (const c of agent.criteria) assert.ok(user.includes(c), 'every step must reach the model');
  assert.match(user, /### 要查的事/);
});

test('a picture is described as a picture, not as an empty file', () => {
  const user = userPrompt(AGENT_BY_ID.get('fresco'), { name: 'a.png', type: 'design', text: '', image: { mediaType: 'image/png', base64: 'AA' } });
  assert.match(user, /图片档/);
  assert.ok(!user.includes('读不出文字内容'));
});

// ------------------------------------------------------------- end to end

test('the whole pipeline: files in, sorted library plus reports out', async () => {
  const root = await mkdtemp(join(tmpdir(), 'town-e2e-'));
  const inbox = join(root, 'inbox');
  const library = join(root, 'library');
  await mkdir(join(inbox, '办公室租约', '合同'), { recursive: true });
  await writeFile(join(inbox, '门店扩张__提案__张三__第一版.md'),
    '# 门店扩张提案\n我们建议分三期进行。设计费 RM 10,000\n印刷费 RM 5,000\n总计 RM 20,000\n', 'utf8');
  const { copyFile } = await import('node:fs/promises');
  await copyFile(join(FIXTURES, 'tenancy.pdf'), join(inbox, '办公室租约', '合同', 'tenancy.pdf'));

  const drive = createLocalDrive({ inbox, library });
  const first = await runInbox({ drive, model: null });
  assert.equal(first.done.length, 2);
  assert.equal(first.failed.length, 0);

  const files = [];
  const walk = async d => {
    for (const e of await readdir(d, { withFileTypes: true })) {
      const p = join(d, e.name);
      if (e.isDirectory()) await walk(p); else files.push(p.slice(library.length + 1));
    }
  };
  await walk(library);

  assert.ok(files.some(f => f === ['门店扩张', '提案', '2026'].join(sep) + sep || f.startsWith(['门店扩张', '提案'].join(sep))), '提案 should be filed under its project and type');
  assert.ok(files.some(f => f.includes('合同') && f.endsWith('.pdf')));
  assert.ok(files.some(f => f.includes('_评审') && f.endsWith('.md')), 'reports must be written back');
  assert.ok(files.includes('清单.csv'));

  const csv = await readFile(join(library, '清单.csv'), 'utf8');
  assert.ok(csv.startsWith('﻿'), 'the index needs a BOM so Excel reads Chinese');
  assert.match(csv, /门店扩张/);
  assert.match(csv, /要改|留意|通过/);

  const report = files.find(f => f.includes('_评审') && f.includes('第一版'));
  const body = await readFile(join(library, report), 'utf8');
  assert.match(body, /加总对不上/, 'the arithmetic error must reach the report');
  assert.match(body, /自动判断的部分/, 'guesses must be declared at the top of the report');

  // The original is still where the colleague left it.
  assert.ok((await readdir(inbox)).length > 0, 'copy by default: never move the only copy');

  // Second run does nothing: already seen.
  const second = await runInbox({ drive, model: null });
  assert.equal(second.done.length, 0);
  assert.equal(second.skipped, 2);

  // --force re-reviews.
  const third = await runInbox({ drive, model: null, force: true });
  assert.equal(third.done.length, 2);

  await rm(root, { recursive: true, force: true });
});

test('one bad file does not stop the batch', async () => {
  const root = await mkdtemp(join(tmpdir(), 'town-bad-'));
  const inbox = join(root, 'inbox'), library = join(root, 'library');
  await mkdir(inbox, { recursive: true });
  await writeFile(join(inbox, 'fine.md'), '# ok\n内容足够长。'.repeat(10), 'utf8');
  await writeFile(join(inbox, 'broken.pdf'), 'this is not a pdf at all');
  const drive = createLocalDrive({ inbox, library });
  const r = await runInbox({ drive, model: null });
  assert.equal(r.done.length, 2, 'an unreadable file is still filed and reported on');
  const bad = r.done.find(d => d.file.name === 'broken.pdf');
  assert.equal(bad.doc.ok, false);
  assert.ok(bad.report.rel, 'even an unreadable file gets a report saying why');
  await rm(root, { recursive: true, force: true });
});

test('a submission cannot write outside the library', async () => {
  const root = await mkdtemp(join(tmpdir(), 'town-esc-'));
  const inbox = join(root, 'inbox'), library = join(root, 'library');
  await mkdir(inbox, { recursive: true });
  await writeFile(join(inbox, '..__..__etc__passwd.md'), 'x'.repeat(100), 'utf8');
  const drive = createLocalDrive({ inbox, library });
  const r = await runInbox({ drive, model: null });
  for (const d of r.done) {
    assert.ok(resolve(d.filed.path).startsWith(resolve(library)), `escaped to ${d.filed.path}`);
    assert.ok(resolve(d.report.path).startsWith(resolve(library)), `report escaped to ${d.report.path}`);
  }
  await rm(root, { recursive: true, force: true });
});

test('state keys change when a file is edited, so an edit gets re-reviewed', () => {
  const a = fileKey('a/b.pdf', 100, 1000);
  assert.equal(a, fileKey('a/b.pdf', 100, 1000));
  assert.notEqual(a, fileKey('a/b.pdf', 101, 1000));
  assert.notEqual(a, fileKey('a/b.pdf', 100, 2000));
});

// ------------------------------------------------------------------- config

test('config loads, strips comments, and lets the environment win', async () => {
  const cfg = await loadConfig(undefined, { TOWN_INBOX: '/tmp/in', TOWN_LIBRARY: '/tmp/lib' });
  assert.equal(cfg.drive.inbox, '/tmp/in');
  assert.equal(cfg.drive.library, '/tmp/lib');
  assert.ok(!('_comment' in cfg.drive));
  assert.ok(!('_comment' in cfg.model));
});

test('a missing config file is not fatal', async () => {
  const cfg = await loadConfig('/nowhere/at/all.json', {});
  assert.ok(cfg.drive.inbox.endsWith(join('town', '_demo', 'inbox')));
});
