// The acceptance line: what an agent has to show before its work counts as done.
//
// One ledger per run records the files the agent changed and the checks it ran. From that the run gets a
// stamp (verified / failed / escalated / none / stale) that the user sees next to the answer, and three rules apply:
//   1. Evidence, not claims: only a check whose exit code can be trusted counts.
//   2. Three failed rounds of the same kind of check stop the run and bring in the user.
//   3. The checks are out of the change's reach: existing tests and rule files cannot be edited on a blanket approval.
// The gate that refuses an unverified finish has three modes (off / observe / enforce) and starts in observe,
// so what it would have blocked can be reviewed before it blocks anything.
// The practices follow "How the Claude Code team thinks about verification" (Anthropic, 2026-11-16).
import fs from 'node:fs';
import { dataPath } from './store.js';

export const MODES = ['off', 'observe', 'enforce'];
export const DEFAULT_MODE = 'observe';
/** Failed rounds of one kind of check before the run stops and the user is brought in. */
export const MAX_ROUNDS = 3;
/** In enforce mode, how many times one run can be sent back before it is let through unverified. */
export const MAX_BLOCKS = 2;

// ---------- reading shell commands ----------

/** Split a shell command into simple commands and the operator that follows each, ignoring operators inside quotes. */
export function splitCommand(command) {
  const parts = [];
  let cur = '';
  let quote = null;
  const s = String(command || '');
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (quote) {
      cur += c;
      if (c === '\\' && quote === '"' && i + 1 < s.length) cur += s[++i];
      else if (c === quote) quote = null;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') {
      quote = c;
      cur += c;
    } else if (c === '\\' && i + 1 < s.length) {
      cur += c + s[++i];
    } else if (c === '&' && s[i + 1] === '&') {
      parts.push({ text: cur, op: '&&' });
      cur = '';
      i++;
    } else if (c === '|' && s[i + 1] === '|') {
      parts.push({ text: cur, op: '||' });
      cur = '';
      i++;
    } else if ((c === '>' && s[i + 1] === '&') || (c === '&' && s[i + 1] === '>')) {
      cur += c + s[++i]; // a redirection such as 2>&1 or &>file, not the background operator
    } else if (c === '|' || c === ';' || c === '\n' || c === '&') {
      parts.push({ text: cur, op: c === '\n' ? ';' : c });
      cur = '';
    } else cur += c;
  }
  parts.push({ text: cur, op: null });
  const out = parts.map((p) => ({ text: p.text.trim(), op: p.op }));
  // Drop the empty piece after a trailing operator: "cmd &" keeps its "&", while "cmd;" simply ends.
  while (out.length > 1 && !out.at(-1).text && out.at(-1).op === null) {
    out.pop();
    if (out.at(-1).op === ';') out.at(-1).op = null;
  }
  return out.filter((p) => p.text);
}

/** Files a command writes through ">" or ">>", read outside quotes. */
export function redirectTargets(command) {
  const s = String(command || '');
  const out = [];
  let quote = null;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (quote) {
      if (c === '\\' && quote === '"') i++;
      else if (c === quote) quote = null;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') quote = c;
    else if (c === '\\') i++;
    else if (c === '>') {
      let j = i + 1;
      if (s[j] === '>') j++;
      if (s[j] === '&') continue; // 2>&1 duplicates a descriptor, it does not write a file
      while (s[j] === ' ' || s[j] === '\t') j++;
      let target = '';
      const q = s[j] === '"' || s[j] === "'" ? s[j++] : null;
      while (j < s.length && (q ? s[j] !== q : !/[\s;|&<>()]/.test(s[j]))) target += s[j++];
      if (target) out.push(target);
      i = j;
    }
  }
  return out;
}

// Prefixes that wrap a command without changing what it is.
const WRAPPERS = /^(?:[({]\s*|[A-Za-z_][A-Za-z0-9_]*=\S*\s+|(?:time|nice|env|command|exec)\s+|timeout\s+(?:-\S+\s+)*\S+\s+|(?:npx|bunx|pnpx)\s+(?:--?\S+\s+)*|(?:pnpm|yarn)\s+(?:exec|dlx)\s+|(?:uv|poetry|pipenv|bundle)\s+(?:run|exec)\s+)+/;
const PM = '(?:npm|pnpm|yarn|bun)\\s+(?:run\\s+|run-script\\s+)?';
const END = '(?:[:.\\-][\\w:.\\-]*)?(?=\\s|$)';
// [kind, pattern]. The kind is what counts for the stamp and the three-round rule: one failing test run
// followed by a passing one is a passing test check, whichever exact command was used.
const CHECKS = [
  ['test', new RegExp(`^${PM}(?:t(?=\\s|$)|(?:test|tests|spec|e2e)${END})`)],
  ['lint', new RegExp(`^${PM}(?:lint|format:check|fmt:check)${END}`)],
  ['types', new RegExp(`^${PM}(?:typecheck|type-check|types|tsc)${END}`)],
  ['build', new RegExp(`^${PM}build${END}`)],
  ['verify', new RegExp(`^${PM}(?:verify|check)${END}`)],
  ['verify', /^(?:(?:node|bun|deno|python3?|py|bash|sh|zsh)\s+(?:-\S+\s+)*)?(?:\.{0,2}\/)?(?:[\w.-]+\/)*verify[\w.-]*\.(?:m?js|ts|py|sh)(?=\s|$)/],
  ['test', /^(?:node|bun|deno)\s+(?:\S+\s+)*(?:--test\b|test(?=[\s.]|$))/],
  ['test', /^(?:python3?|py)\s+-m\s+(?:pytest|unittest|tox|nox)\b/],
  ['test', /^(?:pytest|tox|nox|jest|vitest|mocha|ava|tap|phpunit|rspec)(?=\s|$)/],
  ['test', /^(?:playwright\s+test|cypress\s+run)\b/],
  ['lint', /^(?:python3?|py)\s+-m\s+(?:ruff|flake8|pylint)\b/],
  ['lint', /^(?:eslint|biome|oxlint|ruff|flake8|pylint|rubocop|shellcheck)(?=\s|$)/],
  ['lint', /^prettier\s+(?:\S+\s+)*--check\b/],
  ['types', /^(?:python3?|py)\s+-m\s+(?:mypy|pyright)\b/],
  ['types', /^(?:tsc|mypy|pyright)(?=\s|$)/],
  ['test', /^go\s+test\b/],
  ['lint', /^go\s+vet\b/],
  ['build', /^go\s+build\b/],
  ['test', /^cargo\s+(?:test|nextest)\b/],
  ['lint', /^cargo\s+clippy\b/],
  ['types', /^cargo\s+check\b/],
  ['build', /^cargo\s+build\b/],
  ['test', /^(?:mvn|mvnw|\.\/mvnw)\s+(?:\S+\s+)*(?:test|verify)(?=\s|$)/],
  ['test', /^(?:gradle|gradlew|\.\/gradlew)\s+(?:\S+\s+)*(?:test|check)(?=\s|$)/],
  ['build', /^(?:gradle|gradlew|\.\/gradlew)\s+(?:\S+\s+)*build(?=\s|$)/],
  ['test', /^(?:dotnet|swift)\s+test\b/],
  ['build', /^(?:dotnet|swift)\s+build\b/],
  ['test', /^(?:make|just|task)\s+(?:\S+\s+)*(?:test|tests|e2e|ci)(?=\s|$)/],
  ['lint', /^(?:make|just|task)\s+(?:\S+\s+)*lint(?=\s|$)/],
  ['build', /^(?:make|just|task)\s+(?:\S+\s+)*build(?=\s|$)/],
  ['verify', /^(?:make|just|task)\s+(?:\S+\s+)*(?:check|verify)(?=\s|$)/],
];

function stripWrappers(text) {
  let prev;
  let t = text;
  do {
    prev = t;
    t = t.replace(WRAPPERS, '');
  } while (t !== prev);
  return t.replace(/[)}]+\s*$/, '').trim();
}

/**
 * Decide whether a shell command is a check (tests, lint, type check, build, a verify script).
 * `conclusive` is false when the command hides the check's exit code (a pipe, ";" or "||" after it):
 * such a run proves nothing either way and is not counted.
 */
export function classifyCommand(command) {
  const parts = splitCommand(command);
  let last = -1;
  let kind = null;
  parts.forEach((p, i) => {
    const body = stripWrappers(p.text);
    const hit = body && CHECKS.find(([, re]) => re.test(body));
    if (hit) {
      last = i;
      kind = hit[0];
    }
  });
  if (last < 0) return null;
  const tail = parts.slice(last);
  const masked = tail.some((p, k) => (k < tail.length - 1 ? p.op !== '&&' : p.op !== null));
  const label = stripWrappers(parts[last].text)
    .replace(/\s+(?:\d*>>?\s*&?\S+|&>\s*\S+)/g, '')
    .replace(/\s+/g, ' ')
    .slice(0, 70);
  return { kind, label, conclusive: !masked };
}

/** Read the result of a shell check from the bash tool's output. `pass` is null for a run that proves nothing. */
export function commandCheck(command, output) {
  const check = classifyCommand(command);
  if (!check) return null;
  if (!check.conclusive) return { kind: check.kind, label: check.label, pass: null };
  const code = /\[exit code (-?\d+|null)\]\s*$/.exec(String(output || ''));
  return { kind: check.kind, label: check.label, pass: Boolean(code) && code[1] === '0' };
}

// ---------- the checks are out of the change's reach ----------

const RULE_PATH = /(^|\/)(verification|\.claude|\.github\/workflows)(\/|$)|(^|\/)(REVIEW|AGENTS|CLAUDE)\.md$/i;
const TEST_PATH = /(^|\/)(tests?|__tests__|e2e|evals?)(\/|$)|(^|\/)(conftest\.py|[^/]+\.(test|spec)\.[cm]?[jt]sx?|test_[^/]+\.py|[^/]+_test\.(py|go|rb))$/i;
const clean = (p) => String(p || '').replace(/\\/g, '/').replace(/^\.\//, '');

/** Files that hold the review and verification rules. Writing one always asks, whether it exists yet or not. */
export function isRulePath(p) {
  return RULE_PATH.test(clean(p));
}

/** Tests and rule files: the things a change is judged by. */
export function isProtectedPath(p) {
  const rel = clean(p);
  return Boolean(rel) && (RULE_PATH.test(rel) || TEST_PATH.test(rel));
}

const MUTATING = /(^|[\s;&|(])(rm|rmdir|mv|cp|tee|truncate|patch|dd|ln|chmod|touch)\s|\b(sed|perl|ruby)\s+(-\S+\s+)*-[a-hj-zA-Z]*i|\bgit\s+(checkout|restore|rm|mv|apply|am|revert|reset|stash|merge|rebase|cherry-pick|clean)\b/;

const words = (command) => String(command || '').split(/[\s"'`;|&<>()=]+/).filter(Boolean);

/** Best-effort: does this shell command change a test or a rule file? Such commands are never auto-approved. */
export function mutatesProtected(command) {
  if (redirectTargets(command).some(isProtectedPath)) return true;
  return MUTATING.test(String(command || '')) && words(command).some(isProtectedPath);
}

const SCRATCH = /^(\/tmp\/|\/var\/tmp\/|\/dev\/|\$\{?TMPDIR)/;

/**
 * Best-effort: does this shell command change files in the workspace? Used to notice edits made after the
 * last passing check. Cleaning up under /tmp is not an edit.
 */
export function looksLikeEdit(command) {
  const cmd = String(command || '');
  if (redirectTargets(cmd).some((t) => !SCRATCH.test(t))) return true;
  if (!MUTATING.test(cmd)) return false;
  const paths = words(cmd).filter((w) => /[/.]/.test(w) && !w.startsWith('-'));
  return !(paths.length && paths.every((w) => SCRATCH.test(w)));
}

// ---------- the ledger of one run ----------

export function createLedger() {
  return { seq: 0, edits: [], checks: [], streak: new Map(), escalated: null, blocks: 0 };
}

export function noteEdit(ledger, file) {
  ledger.edits.push({ seq: ++ledger.seq, file: String(file) });
}

/**
 * Record a check result. Returns the failed-round count for this kind of check, and `escalate` when it has
 * just reached the limit: from then on the run should stop and hand the decision to the user.
 */
export function noteCheck(ledger, { kind, label, pass }) {
  ledger.checks.push({ seq: ++ledger.seq, kind, label, pass });
  if (pass === null) return { round: 0, escalate: false };
  if (pass) {
    ledger.streak.set(kind, 0);
    return { round: 0, escalate: false };
  }
  const round = (ledger.streak.get(kind) || 0) + 1;
  ledger.streak.set(kind, round);
  if (round >= MAX_ROUNDS && !ledger.escalated) {
    ledger.escalated = { kind, label, rounds: round };
    return { round, escalate: true };
  }
  return { round, escalate: false };
}

/**
 * The stamp for a finished run, or null when the run neither changed files nor ran a conclusive check.
 *   verified   the latest result of every kind of check passed, and the last pass came after the last edit
 *   failed     the latest result of some kind of check is a failure
 *   escalated  one kind of check failed MAX_ROUNDS rounds in a row and the run was stopped for the user
 *   none       files changed but no conclusive check passed
 *   stale      checks passed, then files changed again
 */
export function stampOf(ledger) {
  const latest = new Map();
  for (const c of ledger.checks) if (c.pass !== null) latest.set(c.kind, c);
  const conclusive = [...latest.values()];
  if (!ledger.edits.length && !conclusive.length) return null;
  const failing = conclusive.filter((c) => !c.pass);
  const passing = conclusive.filter((c) => c.pass);
  const lastEdit = ledger.edits.at(-1)?.seq || 0;
  const lastPass = Math.max(0, ...passing.map((c) => c.seq));
  let status;
  if (ledger.escalated) status = 'escalated';
  else if (failing.length) status = 'failed';
  else if (!passing.length) status = 'none';
  else if (lastEdit > lastPass) status = 'stale';
  else status = 'verified';
  return {
    status,
    edits: new Set(ledger.edits.map((e) => e.file)).size,
    checks: conclusive.map((c) => ({ label: c.label, pass: c.pass, rounds: c.pass ? 0 : ledger.streak.get(c.kind) || 1 })),
    inconclusive: ledger.checks.filter((c) => c.pass === null).length,
  };
}

/** Would the gate refuse this finish? Only work that changed files and has no passing check since counts. */
export function wouldBlock(stamp) {
  return Boolean(stamp) && stamp.edits > 0 && (stamp.status === 'none' || stamp.status === 'stale');
}

export function verificationMode(cfg) {
  return MODES.includes(cfg?.verification?.mode) ? cfg.verification.mode : DEFAULT_MODE;
}

/** One line for the agent that delegated the work, so the claim travels together with its evidence. */
export function describeStamp(stamp) {
  if (!stamp) return '';
  const list = stamp.checks.map((c) => `${c.label}: ${c.pass ? 'passed' : 'FAILED'}`).join('; ');
  const say = {
    verified: `verified, checked after the last change (${list})`,
    failed: `NOT verified, a check is failing (${list})`,
    escalated: `NOT verified, stopped after ${MAX_ROUNDS} failed rounds and waiting for the user (${list})`,
    none: `NOT verified, ${stamp.edits} file(s) changed and no check passed`,
    stale: `NOT verified, files changed again after the last passing check (${list})`,
  }[stamp.status];
  return `\n\n[verification stamp: ${say}]`;
}

// ---------- messages to the model ----------

export const TEXT = {
  inconclusive:
    '\n\n[verification] This result does not count as a check: the command hides the exit code (a pipe, ";" or "||" after the check). Run the check again as its own command.',
  escalate: (label, rounds) =>
    `\n\n[verification] "${label}" has now failed ${rounds} rounds in a row. Stop here: do not change or run anything else. Tell the user what you tried, show the failing output, and say what you need from them to continue.`,
  stopped: (label) =>
    `This run stopped after ${MAX_ROUNDS} failed rounds of "${label}". Do not continue; report to the user what you tried, the failing output, and what you need from them.`,
  gate:
    "[verification gate] You changed files in this run, but no check has passed since your last change. Run the project's checks now: follow the verify skill or AGENTS.md if the repository has one, otherwise run the tests that cover your change, each as its own command. If this change really cannot be checked, say exactly why in your answer.",
};

// ---------- the record: every run's stamp, including "none", so unverified work can be found later ----------

const LOG = 'verification.jsonl';

/** Append one run to the record. The file is trimmed to its newest `keep` lines once it passes `maxBytes`. */
export function logRun(entry, { maxBytes = 1_000_000, keep = 2000 } = {}) {
  try {
    const file = dataPath(LOG);
    fs.appendFileSync(file, `${JSON.stringify({ at: new Date().toISOString(), ...entry })}\n`);
    if (fs.statSync(file).size > maxBytes) {
      const lines = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean);
      fs.writeFileSync(file, `${lines.slice(-keep).join('\n')}\n`);
    }
  } catch {
    // The record is best-effort; a full disk must not break the run.
  }
}

export function readLog(limit = 200) {
  let lines;
  try {
    lines = fs.readFileSync(dataPath(LOG), 'utf8').split('\n').filter(Boolean);
  } catch {
    return [];
  }
  const out = [];
  for (const line of lines.slice(-limit)) {
    try {
      out.push(JSON.parse(line));
    } catch {
      // skip a line cut off by a crash
    }
  }
  return out.reverse();
}

export function summarize(entries) {
  const sum = { total: entries.length, verified: 0, failed: 0, escalated: 0, none: 0, stale: 0, wouldBlock: 0, blocked: 0 };
  for (const e of entries) {
    if (e.status in sum && e.status !== 'total') sum[e.status]++;
    if (e.wouldBlock) sum.wouldBlock++;
    if (e.blocks) sum.blocked++;
  }
  return sum;
}
