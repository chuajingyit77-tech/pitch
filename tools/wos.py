#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""wos — the work system's single command-line tool (Python standard library only).

Commands: check | build | nudges | privacy | backup | sync | new | ramble | doctor
          hook-start | hook-prompt   (called by .claude/settings.json hooks)
All text printed for the owner is Simplified Chinese. Keys in cards are ASCII, values Chinese.
"""
import argparse
import datetime as dt
import hashlib
import json
import os
import re
import subprocess
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
STATE = ROOT / ".wos"
INBOX = STATE / "inbox"
VIEWS = ROOT / "视图"
CONFIG_FILE = ROOT / "config" / "wos.json"
TEMPLATE = ROOT / "tools" / "dashboard.template.html"
PRIVATE_ROOTS = ["项目", "关系", "碎碎念", "想法停车场.md", "建议记录.md", "水准/反馈记录.md"]

DEFAULT_CONFIG = {
    "tz_offset_hours": 8,
    "dashboard_url": "",
    "allow_private_in_public_repo": False,
    "visibility_override": "",
    "auto_merge_to_main": False,
    "legacy_branches": [],
    "stale_days": 14,
    "stale_days_maintenance": 90,
    "max_hook_nudges": 8,
}

ACTIVE = ["摸底", "制作", "推进", "落地"]
STAGES = ["待确认", "摸底", "制作", "推进", "落地", "维护", "完成", "搁置", "终止"]
STAGE_LABEL = {
    "产品": {"制作": "开发", "推进": "验证", "落地": "上线", "维护": "运营"},
    "系统": {"制作": "搭建", "推进": "试用", "落地": "在用", "维护": "维护"},
    "其他": {"制作": "备资料", "推进": "已送出·等回应", "落地": "已签·交付"},
}
ENUMS = {
    "type": ["产品", "系统", "其他"],
    "for_whom": ["自用", "具体客户", "市场"],
    "stage": STAGES,
    "priority": ["P1", "P2", "P3"],
    "evidence": ["V", "S", "C", "M"],
    "sens": ["公开", "内部", "机密"],
    "origin": ["碎碎念", "历史导入"],
    "kind": ["客户", "潜在客户", "原厂技术方", "合作伙伴", "机构大学", "政府", "供应商",
             "团队", "投资人", "个人", "自家"],
    "pipeline": ["新线索", "已联系", "会面中", "已报价", "谈判中", "合作中", "沉睡"],
    "tier": ["A", "B", "C"],
}
PROJECT_KEYS = ["name", "aliases", "summary", "type", "subtype", "for_whom", "stage", "stage_since",
                "priority", "goal", "done_def", "next", "next_due", "next_owner", "next_test",
                "orgs", "people", "payer", "budget_source", "next_paid_step", "gate_what",
                "gate_date", "evidence", "kill_rule", "kill_date", "revisit", "lang", "sens",
                "origin", "branch", "period", "created", "touched"]
RELATION_KEYS = ["name", "aliases", "kind", "org", "role", "pipeline", "tier", "cadence_days",
                 "last_contact", "next_contact", "projects", "sens", "created", "touched"]
LIST_KEYS = {"aliases", "orgs", "people", "lang", "projects"}
DATE_KEYS = {"stage_since", "next_due", "gate_date", "kill_date", "revisit", "created", "touched",
             "last_contact", "next_contact"}
REQUIRED = {"project": ["name", "type", "stage", "sens", "created"],
            "org": ["name", "kind", "sens", "created"],
            "person": ["name", "kind", "sens", "created"]}
UNSET = ("", "待确认")
SEV_RANK = {"急": 0, "注意": 1, "提醒": 2}
WEEKDAY = "一二三四五六日"


# ---------- basics ----------

def load_config():
    cfg = dict(DEFAULT_CONFIG)
    try:
        cfg.update(json.loads(CONFIG_FILE.read_text(encoding="utf-8")))
    except (OSError, ValueError):
        pass
    return cfg


def save_config(cfg):
    CONFIG_FILE.parent.mkdir(parents=True, exist_ok=True)
    CONFIG_FILE.write_text(json.dumps(cfg, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def today(cfg=None):
    env = os.environ.get("WOS_TODAY")
    if env:
        return dt.date.fromisoformat(env)
    cfg = cfg or load_config()
    now = dt.datetime.now(dt.timezone.utc) + dt.timedelta(hours=cfg["tz_offset_hours"])
    return now.date()


def now_local(cfg=None):
    cfg = cfg or load_config()
    return dt.datetime.now(dt.timezone.utc) + dt.timedelta(hours=cfg["tz_offset_hours"])


def git(*args, timeout=60, check=False):
    try:
        p = subprocess.run(["git", "-c", "core.quotepath=false", *args], cwd=ROOT, text=True,
                           capture_output=True, timeout=timeout)
    except (subprocess.TimeoutExpired, OSError) as e:
        if check:
            raise
        return 124, "", str(e)
    if check and p.returncode != 0:
        raise RuntimeError(p.stderr.strip())
    return p.returncode, p.stdout, p.stderr


def parse_date(v):
    try:
        return dt.date.fromisoformat(v)
    except (TypeError, ValueError):
        return None


# ---------- card format ----------

KEY_RE = re.compile(r"^([a-z][a-z0-9_]*)\s*[:：]\s*(.*)$")
ITEM_RE = re.compile(r"^\s*-\s+(.*)$")
ENTRY_RE = re.compile(r"^- \[( |x|X)\]\s+(\d{4}-\d{2}-\d{2}|待确认)\s+(.*)$")


def _scalar(v):
    v = v.strip()
    if v.startswith('"'):
        return json.loads(v)
    if len(v) > 1 and v.startswith("'") and v.endswith("'"):
        return v[1:-1].replace("''", "'")
    return v


def parse_card(path):
    """Return (front_matter dict, body str, list of error strings)."""
    errs = []
    try:
        text = Path(path).read_text(encoding="utf-8").lstrip("﻿")
    except (OSError, UnicodeDecodeError) as e:
        return {}, "", ["读不了这个文件：%s" % e]
    lines = text.replace("\r\n", "\n").split("\n")
    if not lines or lines[0].strip() != "---":
        return {}, text, ["开头缺少 --- （卡片的表头）"]
    end = next((i for i in range(1, len(lines)) if lines[i].strip() == "---"), None)
    if end is None:
        return {}, text, ["表头没有用 --- 收尾"]
    fm, cur = {}, None
    for raw in lines[1:end]:
        if not raw.strip():
            continue
        m = ITEM_RE.match(raw)
        if m and cur is not None and isinstance(fm.get(cur), list):
            try:
                fm[cur].append(_scalar(m.group(1)))
            except ValueError:
                errs.append("这一行的引号不对：%s" % raw.strip())
            continue
        m = KEY_RE.match(raw)
        if not m:
            errs.append("看不懂这一行：%s" % raw.strip())
            continue
        k, v = m.group(1), m.group(2).strip()
        if k in fm:
            errs.append("字段重复：%s" % k)
            continue
        try:
            if v == "":
                fm[k] = [] if k in LIST_KEYS else ""
            elif v == "[]":
                fm[k] = []
            elif v.startswith("[") and v.endswith("]"):
                fm[k] = [_scalar(x) for x in v[1:-1].split(",") if x.strip()]
            else:
                fm[k] = _scalar(v)
        except ValueError:
            errs.append("这一行的引号不对：%s" % raw.strip())
            fm[k] = ""
        cur = k
    return fm, "\n".join(lines[end + 1:]), errs


def parse_entries(body, section):
    """Open/closed dated lines under '## <section>': list of (done, date_or_None, text)."""
    out, inside = [], False
    for line in body.split("\n"):
        if line.startswith("## "):
            inside = line[3:].strip() == section
            continue
        if inside:
            m = ENTRY_RE.match(line.strip())
            if m:
                out.append((m.group(1) != " ", parse_date(m.group(2)), m.group(3).strip()))
    return out


def fm_value(v):
    if isinstance(v, list):
        return v
    return v


def dump_card(keys, fm, body):
    out = ["---"]
    for k in keys:
        v = fm.get(k, [] if k in LIST_KEYS else "")
        if k in LIST_KEYS:
            if v:
                out.append("%s:" % k)
                out.extend("  - %s" % json.dumps(str(x), ensure_ascii=False) for x in v)
            else:
                out.append("%s: []" % k)
        elif v == "":
            out.append("%s:" % k)
        elif k in DATE_KEYS or k in ENUMS or re.fullmatch(r"[A-Za-z0-9_\-]+", str(v)):
            out.append("%s: %s" % (k, v))
        else:
            out.append("%s: %s" % (k, json.dumps(str(v), ensure_ascii=False)))
    out.append("---")
    return "\n".join(out) + "\n" + body


class Card:
    def __init__(self, kind, path):
        self.kind, self.path = kind, Path(path)
        self.fm, self.body, self.errors = parse_card(path)
        self.warnings = []
        self.rel = self.path.relative_to(ROOT).as_posix()
        self.slug = self.path.parent.name if kind == "project" else self.path.stem
        self.name = self.fm.get("name") or self.slug
        self._validate()

    def get(self, k, default=""):
        v = self.fm.get(k, default)
        return default if (not isinstance(v, list) and v in UNSET) else v

    def date(self, k):
        return parse_date(self.fm.get(k, ""))

    def _validate(self):
        if self.errors and not self.fm:
            return
        keys = PROJECT_KEYS if self.kind == "project" else RELATION_KEYS
        for k in self.fm:
            if k not in keys and not k.startswith("x_"):
                self.warnings.append("不认识的字段「%s」（会被忽略）" % k)
        for k in REQUIRED[self.kind]:
            if self.fm.get(k, "") == "":
                self.errors.append("缺少必填字段「%s」" % k)
        for k, allowed in ENUMS.items():
            v = self.fm.get(k, "")
            if k in self.fm and not isinstance(v, list) and v not in UNSET and v not in allowed:
                self.errors.append("「%s: %s」不在允许的写法里：%s" % (k, v, " / ".join(allowed)))
        for k in DATE_KEYS:
            v = self.fm.get(k, "")
            if k in self.fm and v not in UNSET and parse_date(v) is None:
                self.errors.append("「%s: %s」不是 年-月-日 的日期" % (k, v))
        cd = self.fm.get("cadence_days", "")
        if cd not in UNSET and not str(cd).isdigit():
            self.errors.append("「cadence_days: %s」要写成天数（整数）" % cd)


def load_cards():
    cards = []
    for p in sorted((ROOT / "项目").glob("*/卡片.md")):
        cards.append(Card("project", p))
    for sub, kind in (("机构", "org"), ("人", "person")):
        for p in sorted((ROOT / "关系" / sub).glob("*.md")):
            if p.name != "README.md":
                cards.append(Card(kind, p))
    return cards


# ---------- rules: nudges and health ----------

def _days(d, t):
    return (d - t).days


def compute_nudges(cards, t, cfg, vis=None, blocked=0):
    """Deterministic. Returns list of dicts sorted by severity then date."""
    out = []

    def add(sev, card, text, date=None):
        out.append({"sev": sev, "card": card.rel if card else "", "name": card.name if card else "系统",
                    "kind": card.kind if card else "system", "text": text,
                    "date": date.isoformat() if date else ""})

    pending_history, p1 = 0, 0
    for c in cards:
        if c.errors:
            add("注意", c, "这张卡片格式有问题，暂时不参与跟进：%s" % c.errors[0])
            continue
        stage = c.fm.get("stage", "") if c.kind == "project" else ""
        if c.kind == "project" and stage == "待确认":
            pending_history += 1
            continue
        if c.kind == "project" and stage in ("完成", "终止"):
            continue
        active = c.kind == "project" and stage in ACTIVE
        # commitments (both card kinds)
        for done, d, text in parse_entries(c.body, "承诺"):
            if done or d is None:
                continue
            n = _days(d, t)
            mine = text.startswith("我答应")
            if mine and n < 0:
                add("急", c, "答应的事过期 %d 天：%s" % (-n, text), d)
            elif mine and n == 0:
                add("急", c, "答应的事今天到期：%s" % text, d)
            elif mine and n <= 2:
                add("注意", c, "答应的事还剩 %d 天：%s" % (n, text), d)
            elif not mine and n < 0:
                add("注意", c, "对方欠的事过期 %d 天：%s" % (-n, text), d)
        # hard deadlines
        for done, d, text in parse_entries(c.body, "期限"):
            if done or d is None:
                continue
            n = _days(d, t)
            if n < 0:
                add("急", c, "期限已过 %d 天：%s" % (-n, text), d)
            elif n <= 3:
                add("急", c, "期限还剩 %d 天：%s" % (n, text), d)
            elif n <= 14:
                add("注意", c, "期限还剩 %d 天：%s" % (n, text), d)
        if c.kind != "project":
            nc, lc = c.date("next_contact"), c.date("last_contact")
            cad = c.fm.get("cadence_days", "")
            if nc and nc <= t:
                add("提醒", c, "该联系了（约好的联系日 %s）" % nc.isoformat(), nc)
            elif lc and str(cad).isdigit() and _days(t, lc) > int(cad):
                add("提醒", c, "%d 天没联系了（你定的节奏是 %s 天一次）" % (_days(t, lc), cad), lc)
            continue
        # project-only rules
        if stage == "搁置":
            rv = c.date("revisit")
            if rv and rv <= t:
                add("提醒", c, "搁置的项目到了回看日（%s）：继续、再放，还是终止？" % rv.isoformat(), rv)
            continue
        kd = c.date("kill_date")
        if c.get("kill_rule") and kd and kd <= t:
            add("急", c, "止损线到检查日了：%s" % c.get("kill_rule"), kd)
        if active:
            if c.fm.get("priority") == "P1":
                p1 += 1
            nd = c.date("next_due")
            if not c.get("next"):
                add("注意", c, "没有下一步。进行中的项目必须有一个明确的下一步和日期")
            elif nd is None:
                add("注意", c, "下一步没有日期：%s" % c.get("next"))
            else:
                n = _days(nd, t)
                if n < 0:
                    add("注意", c, "下一步过期 %d 天：%s" % (-n, c.get("next")), nd)
                elif n == 0:
                    add("注意", c, "下一步今天到期：%s" % c.get("next"), nd)
                elif n <= 2:
                    add("提醒", c, "下一步还剩 %d 天：%s" % (n, c.get("next")), nd)
            gd = c.date("gate_date")
            if gd:
                n = _days(gd, t)
                if n < 0:
                    add("注意", c, "Gate 已过 %d 天：%s" % (-n, c.get("gate_what") or "（没写是什么）"), gd)
                elif n <= 7:
                    add("注意", c, "Gate 还剩 %d 天：%s" % (n, c.get("gate_what") or "（没写是什么）"), gd)
            if paypath_missing(c):
                add("注意", c, "无付款路径：还缺 %s" % "、".join(paypath_missing(c)))
        limit = cfg["stale_days"] if active else cfg["stale_days_maintenance"]
        td = c.date("touched") or c.date("created")
        if td and _days(t, td) > limit and (active or stage == "维护"):
            add("提醒", c, "%d 天没动静" % _days(t, td), td)
    if p1 > 3:
        add("提醒", None, "有 %d 个进行中的项目都标了 P1。超过 3 个就等于没有优先级" % p1)
    if pending_history:
        add("提醒", None, "有 %d 个历史项目等你确认状态。说「历史项目过一遍」，我一个个问你" % pending_history)
    if vis and vis != "private" and blocked:
        add("注意", None, "仓库是公开的，有 %d 个私密文件没有备份。把仓库改成私有后说「备份」即可" % blocked)
    out.sort(key=lambda n: (SEV_RANK[n["sev"]], n["date"] or "9999", n["name"]))
    return out


def paypath_missing(c):
    if c.get("for_whom") != "具体客户" or c.fm.get("stage") not in ("制作", "推进", "落地"):
        return []
    labels = [("payer", "谁付款"), ("budget_source", "预算来源"),
              ("next_paid_step", "下一个收钱动作"), ("gate_date", "Gate 日期")]
    return [lab for k, lab in labels if not c.get(k)]


def health_of(card, nudges):
    sevs = {n["sev"] for n in nudges if n["card"] == card.rel}
    return "急" if "急" in sevs else ("注意" if "注意" in sevs else "正常")


def stage_label(c):
    s = c.fm.get("stage", "")
    return STAGE_LABEL.get(c.fm.get("type", ""), {}).get(s, s)


# ---------- privacy gate ----------

def repo_slug():
    rc, out, _ = git("remote", "get-url", "origin", timeout=10)
    m = re.search(r"([A-Za-z0-9_.\-]+)/([A-Za-z0-9_.\-]+?)(?:\.git)?/?\s*$", out.strip()) if rc == 0 else None
    return "%s/%s" % (m.group(1), m.group(2)) if m else ""


def visibility(cfg=None, use_cache=True, timeout=6):
    """'private' | 'public' | 'unknown'. Unknown must be treated as public by every caller."""
    cfg = cfg or load_config()
    env = os.environ.get("WOS_VISIBILITY")
    if env in ("private", "public", "unknown"):
        return env
    if cfg.get("visibility_override") == "private":
        return "private"
    cache = STATE / "visibility.json"
    if use_cache:
        try:
            c = json.loads(cache.read_text(encoding="utf-8"))
            if time.time() - c["ts"] < 600 and c["state"] in ("private", "public"):
                return c["state"]
        except (OSError, ValueError, KeyError):
            pass
    slug, state = repo_slug(), "unknown"
    if slug:
        try:
            req = urllib.request.Request("https://api.github.com/repos/" + slug, headers={"User-Agent": "wos"})
            with urllib.request.urlopen(req, timeout=timeout) as r:
                priv = json.load(r).get("private")
                state = "private" if priv is True else ("public" if priv is False else "unknown")
        except (urllib.error.URLError, OSError, ValueError):
            state = "unknown"
    try:
        STATE.mkdir(exist_ok=True)
        cache.write_text(json.dumps({"ts": time.time(), "state": state}), encoding="utf-8")
    except OSError:
        pass
    return state


def is_public_file(rel, proj_sens):
    """rel: posix path under a private root. True if it may be committed while the repo is public."""
    parts = rel.split("/")
    if parts[-1] == "README.md" or parts[-1] == ".gitkeep":
        return True
    if parts[0] == "项目" and len(parts) >= 3:
        return proj_sens.get(parts[1]) == "公开"
    if parts[0] in ("关系", "碎碎念") and rel.endswith(".md"):
        fm, _, _ = parse_card(ROOT / rel)
        return fm.get("sens") == "公开"
    return False


def private_files():
    """All files under private roots split into (public_ok, private_only)."""
    proj_sens = {}
    for p in (ROOT / "项目").glob("*/卡片.md"):
        fm, _, _ = parse_card(p)
        proj_sens[p.parent.name] = fm.get("sens", "")
    ok, priv = [], []
    for root in PRIVATE_ROOTS:
        base = ROOT / root
        files = [base] if base.is_file() else [f for f in base.rglob("*") if f.is_file()] if base.is_dir() else []
        for f in files:
            rel = f.relative_to(ROOT).as_posix()
            (ok if is_public_file(rel, proj_sens) else priv).append(rel)
    return sorted(ok), sorted(priv)


def private_pending():
    """Private-only files that are new or changed since the last commit (what a closed gate holds back)."""
    roots = [r for r in PRIVATE_ROOTS if (ROOT / r).exists()]
    if not roots:
        return []
    rc, out, _ = git("status", "--porcelain", "-z", "--untracked-files=all", "--", *roots)
    if rc != 0:
        return private_files()[1]
    changed, skip = set(), False
    for tok in out.split("\0"):
        if skip:
            skip = False
            continue
        if len(tok) < 4:
            continue
        if tok[0] in "RC":
            skip = True
        if tok[1] != " " or tok[0] == "?":
            changed.add(tok[3:])
    priv = set(private_files()[1])
    return sorted(f for f in changed if f in priv)


def vis_text(vis):
    return {"private": "私有", "public": "公开", "unknown": "未能确认（按公开处理）"}[vis]


# ---------- views ----------

def project_row(c, nudges, t):
    nd = c.date("next_due")
    return {
        "slug": c.slug, "path": c.rel, "name": c.name, "summary": c.get("summary"),
        "type": c.get("type", "待确认"), "subtype": c.get("subtype"), "for_whom": c.get("for_whom"),
        "stage": c.fm.get("stage", ""), "stage_label": stage_label(c), "priority": c.get("priority", "P2"),
        "health": health_of(c, nudges), "goal": c.get("goal"), "done_def": c.get("done_def"),
        "next": c.get("next"), "next_due": nd.isoformat() if nd else "", "next_test": c.get("next_test"),
        "next_days": _days(nd, t) if nd else None, "next_owner": c.get("next_owner", "我"),
        "payer": c.get("payer"), "next_paid_step": c.get("next_paid_step"),
        "gate_what": c.get("gate_what"), "gate_date": c.get("gate_date"), "evidence": c.get("evidence"),
        "kill_rule": c.get("kill_rule"), "paypath_missing": paypath_missing(c),
        "origin": c.get("origin"), "branch": c.get("branch"), "period": c.get("period"),
        "sens": c.get("sens"), "touched": c.get("touched") or c.get("created"),
        "reasons": [n["text"] for n in nudges if n["card"] == c.rel][:3],
        "open_commitments": sum(1 for d, _, _ in parse_entries(c.body, "承诺") if not d),
    }


def sort_key(r):
    return ({"急": 0, "注意": 1, "正常": 2}[r["health"]], r["priority"], r["next_due"] or "9999", r["name"])


def build_data(cards, cfg, vis, blocked):
    t = today(cfg)
    nudges = compute_nudges(cards, t, cfg, vis, blocked)
    good = [c for c in cards if not c.errors]
    projs = [project_row(c, nudges, t) for c in good if c.kind == "project"]
    rels = []
    for c in good:
        if c.kind == "project":
            continue
        rels.append({"path": c.rel, "name": c.name, "form": "机构" if c.kind == "org" else "人",
                     "kind": c.get("kind"), "org": c.get("org"), "role": c.get("role"),
                     "pipeline": c.get("pipeline"), "tier": c.get("tier"),
                     "last_contact": c.get("last_contact"), "next_contact": c.get("next_contact"),
                     "health": health_of(c, nudges),
                     "reasons": [n["text"] for n in nudges if n["card"] == c.rel][:2]})
    return {
        "generated_at": now_local(cfg).strftime("%Y-%m-%d %H:%M"), "today": t.isoformat(),
        "weekday": "周" + WEEKDAY[t.weekday()], "visibility": vis, "blocked_private_files": blocked,
        "nudges": nudges,
        "projects": sorted([p for p in projs if p["stage"] != "待确认"], key=sort_key),
        "history": sorted([p for p in projs if p["stage"] == "待确认"], key=lambda r: r["period"], reverse=True),
        "relations": sorted(rels, key=lambda r: ({"急": 0, "注意": 1, "正常": 2}[r["health"]], r["name"])),
        "broken_cards": [{"path": c.rel, "error": c.errors[0]} for c in cards if c.errors],
    }


def render_tracker(d):
    L = ["# 跟进表", "", "> 自动生成，不要手改。数据来自 `项目/` 和 `关系/` 里的卡片。生成于 %s（%s）。" % (
        d["generated_at"], d["weekday"]), ""]
    L += ["## 今日提示", ""]
    L += ["- **[%s]** %s — %s" % (n["sev"], n["name"], n["text"]) for n in d["nudges"]] or ["- 今天没有需要你处理的提示。"]
    act = [p for p in d["projects"] if p["stage"] in ACTIVE]
    rest = [p for p in d["projects"] if p["stage"] not in ACTIVE]
    for title, rows in (("进行中", act), ("维护 / 搁置 / 已结束", rest)):
        L += ["", "## %s（%d）" % (title, len(rows)), ""]
        if not rows:
            L.append("（空）")
            continue
        L += ["| 项目 | 分类 | 阶段 | 优先 | 状态 | 下一步 | 到期 |", "|---|---|---|---|---|---|---|"]
        for p in rows:
            cat = p["type"] + ("·" + p["subtype"] if p["subtype"] else "")
            L.append("| %s | %s | %s | %s | %s | %s | %s |" % (
                p["name"], cat, p["stage_label"], p["priority"], p["health"],
                (p["next"] or "—").replace("|", "／"), p["next_due"] or "—"))
    L += ["", "## 关系跟进（%d）" % len(d["relations"]), ""]
    if d["relations"]:
        L += ["| 名称 | 类别 | 进展 | 上次联系 | 下次联系 | 提示 |", "|---|---|---|---|---|---|"]
        for r in d["relations"]:
            L.append("| %s | %s | %s | %s | %s | %s |" % (r["name"], r["kind"], r["pipeline"] or "—",
                     r["last_contact"] or "—", r["next_contact"] or "—", "；".join(r["reasons"]) or "—"))
    else:
        L.append("（还没有关系卡片）")
    L += ["", "## 历史项目 · 等你确认（%d）" % len(d["history"]), ""]
    L += ["- %s（%s｜%s｜分支 `%s`）" % (p["name"], p["type"], p["period"] or "时间待确认", p["branch"] or "—")
          for p in d["history"]] or ["（没有）"]
    return "\n".join(L) + "\n"


def render_today(d):
    L = ["# 今日 %s %s" % (d["today"], d["weekday"]), ""]
    if d["visibility"] != "private":
        L += ["> 仓库状态：%s。私密资料不会被备份（%d 个文件受影响）。" % (vis_text(d["visibility"]), d["blocked_private_files"]), ""]
    for sev in ("急", "注意", "提醒"):
        rows = [n for n in d["nudges"] if n["sev"] == sev]
        if rows:
            L += ["## %s（%d）" % (sev, len(rows)), ""] + ["- %s — %s" % (n["name"], n["text"]) for n in rows] + [""]
    if not d["nudges"]:
        L.append("今天没有需要你处理的提示。")
    return "\n".join(L) + "\n"


def cmd_build(args):
    cfg = load_config()
    cards = load_cards()
    vis = visibility(cfg)
    blocked = 0 if (vis == "private" or cfg["allow_private_in_public_repo"]) else len(private_pending())
    d = build_data(cards, cfg, vis, blocked)
    VIEWS.mkdir(exist_ok=True)
    (VIEWS / "跟进表.md").write_text(render_tracker(d), encoding="utf-8")
    (VIEWS / "今日.md").write_text(render_today(d), encoding="utf-8")
    page = ""
    if TEMPLATE.exists():
        payload = json.dumps(d, ensure_ascii=False).replace("</", "<\\/")
        page = TEMPLATE.read_text(encoding="utf-8").replace("/*WOS_DATA*/null", payload)
        (VIEWS / "看板.html").write_text(page, encoding="utf-8")
    if not getattr(args, "quiet", False):
        print("已生成：视图/跟进表.md、视图/今日.md%s" % ("、视图/看板.html" if page else "（缺看板模板，没生成看板）"))
        print("项目 %d 个（进行中 %d，历史待确认 %d），关系 %d 个，提示 %d 条，格式有问题的卡片 %d 张。" % (
            len(d["projects"]) + len(d["history"]), sum(1 for p in d["projects"] if p["stage"] in ACTIVE),
            len(d["history"]), len(d["relations"]), len(d["nudges"]), len(d["broken_cards"])))
    return d


# ---------- commands ----------

def cmd_check(args):
    cards = load_cards()
    bad = [c for c in cards if c.errors]
    for c in cards:
        for e in c.errors:
            print("错误  %s：%s" % (c.rel, e))
        for w in c.warnings:
            print("留意  %s：%s" % (c.rel, w))
    print("检查了 %d 张卡片：%d 张有错误。" % (len(cards), len(bad)))
    return 1 if bad else 0


def cmd_nudges(args):
    cfg = load_config()
    cards = load_cards()
    vis = visibility(cfg)
    blocked = 0 if (vis == "private" or cfg["allow_private_in_public_repo"]) else len(private_pending())
    ns = compute_nudges(cards, today(cfg), cfg, vis, blocked)
    if args.json:
        print(json.dumps(ns, ensure_ascii=False, indent=1))
    else:
        for n in ns:
            print("[%s] %s — %s" % (n["sev"], n["name"], n["text"]))
        print("共 %d 条。" % len(ns))
    return 0


def cmd_privacy(args):
    cfg = load_config()
    vis = visibility(cfg, use_cache=not args.fresh)
    ok, priv = private_files()
    print("仓库：%s（%s）" % (repo_slug() or "未知", vis_text(vis)))
    if vis == "private" or cfg["allow_private_in_public_repo"]:
        why = "仓库是私有的" if vis == "private" else "你已明确允许在公开仓库里保存私密资料"
        print("隐私闸门：打开。%s，所有资料都会备份。" % why)
    else:
        print("隐私闸门：关闭。标为「内部」「机密」的资料不会提交到这个仓库。")
        pend = private_pending()
        print("标为公开、可以备份的文件 %d 个；有改动但被拦下的私密文件 %d 个：" % (len(ok), len(pend)))
        for f in pend[:30]:
            print("  - " + f)
    return 0


def push_with_retry(branch):
    err = ""
    for i, wait in enumerate([0, 2, 4, 8, 16]):
        if wait:
            time.sleep(wait)
        rc, _, err = git("push", "-u", "origin", branch, timeout=120)
        if rc == 0:
            return True, ""
    return False, err.strip()


def cmd_backup(args):
    cfg = load_config()
    rc, branch, _ = git("rev-parse", "--abbrev-ref", "HEAD")
    branch = branch.strip()
    if rc != 0 or branch in ("", "HEAD"):
        print("备份失败：现在不在任何分支上。")
        return 3
    vis = visibility(cfg, use_cache=False)
    open_gate = vis == "private" or cfg["allow_private_in_public_repo"]
    bad = [c for c in load_cards() if c.errors]
    try:
        cmd_build(argparse.Namespace(quiet=True))
    except Exception as e:  # views must never block a backup
        print("留意：视图没能重新生成（%s），不影响备份。" % e)
    excl = [":(exclude)%s" % r for r in PRIVATE_ROOTS]
    git("add", "-A", "--", ".", *excl, check=True)
    ok, priv = private_files()
    blocked = []
    if open_gate:
        existing = [r for r in PRIVATE_ROOTS if (ROOT / r).exists()]
        if existing:
            git("add", "-A", "--", *existing, check=True)
    else:
        for f in ok:
            git("add", "--", f, check=True)
        blocked = private_pending()
    rc, staged, _ = git("diff", "--cached", "--name-only")
    files = [f for f in staged.split("\n") if f.strip()]
    committed = False
    if files:
        stamp = now_local(cfg).strftime("%Y-%m-%d %H:%M")
        msg = args.message or "backup: %s (%d files)" % (stamp, len(files))
        trailer = args.trailer or os.environ.get("WOS_COMMIT_TRAILER", "")
        if trailer:
            msg += "\n\n" + trailer.replace("\\n", "\n")
        rc, _, err = git("commit", "-m", msg)
        if rc != 0:
            print("备份失败：提交没成功。%s" % err.strip())
            return 3
        committed = True
    pushed, err = push_with_retry(branch)
    _, head, _ = git("rev-parse", "HEAD")
    head = head.strip()
    remote_ok = False
    if pushed:
        rc, out, _ = git("ls-remote", "origin", "refs/heads/" + branch, timeout=40)
        remote_ok = rc == 0 and out.split("\t")[0].strip() == head
    if not pushed or not remote_ok:
        print("备份没有完成：改动已保存在本机，但没能送到 GitHub。%s" % err)
        print("请马上再说一次「备份」。这个会话结束前不送出去，改动会丢。")
        return 3
    print("备份完成。")
    print("- 分支：%s，提交 %s%s" % (branch, head[:7], "（%d 个文件）" % len(files) if committed else "（没有新改动，已确认远端是最新的）"))
    print("- 仓库：%s" % vis_text(vis))
    if blocked:
        print("- 没有备份的私密文件 %d 个（仓库公开时不提交）：%s%s" % (
            len(blocked), "、".join(blocked[:5]), " 等" if len(blocked) > 5 else ""))
        print("  这些文件只存在于当前会话，会话结束就会消失。把仓库改成私有后再说「备份」。")
    if bad:
        print("- 有 %d 张卡片格式有问题（已照样备份，但不参与跟进）：%s" % (len(bad), "、".join(c.rel for c in bad[:5])))
    rc, _, _ = git("merge-base", "--is-ancestor", "HEAD", "origin/main")
    if rc != 0:
        print("- 这些改动还没进 main。新会话默认从 main 开始，进了 main 才看得到。")
    return 0


def cmd_sync(args):
    cfg = load_config()
    rc, out, err = git("ls-remote", "--heads", "origin", "refs/heads/claude/*", timeout=40)
    if rc != 0:
        print("没能连上 GitHub，暂时查不了其他会话分支。%s" % err.strip())
        return 1
    _, cur, _ = git("rev-parse", "--abbrev-ref", "HEAD")
    cur, legacy, stranded = cur.strip(), set(cfg.get("legacy_branches", [])), []
    for line in out.strip().split("\n"):
        if "\t" not in line:
            continue
        sha, ref = line.split("\t")
        name = ref.replace("refs/heads/", "")
        if name == cur or name in legacy:
            continue
        if git("cat-file", "-e", sha + "^{commit}")[0] != 0:
            if git("fetch", "--quiet", "origin", name, timeout=120)[0] != 0:
                continue
        if git("cat-file", "-e", sha + ":tools/wos.py")[0] != 0:
            continue  # a branch without the system: not ours to merge
        if git("merge-base", "--is-ancestor", sha, "HEAD")[0] == 0:
            continue
        _, cnt, _ = git("rev-list", "--count", "HEAD.." + sha)
        _, names, _ = git("diff", "--name-only", "HEAD..." + sha)
        files = [f for f in names.split("\n") if f.strip()]
        stranded.append((name, sha, cnt.strip(), files))
    if not stranded:
        print("没有发现滞留在其他会话分支上的资料。")
        return 0
    print("发现 %d 个会话分支上有还没并进来的资料：" % len(stranded))
    for name, sha, cnt, files in stranded:
        print("- %s（%s 个提交，%d 个文件）：%s%s" % (name, cnt, len(files), "、".join(files[:6]), " 等" if len(files) > 6 else ""))
        print("  合并命令：git merge --no-edit %s" % sha)
    return 2


def slugify(name):
    s = re.sub(r'[\\/:*?"<>|\s]+', "-", name.strip()).strip("-")
    return s[:24] or "未命名"


PROJECT_BODY = "\n## 进展\n\n## 承诺\n\n## 期限\n\n## 决定\n\n## 备注\n"
RELATION_BODY = "\n## 概况\n\n## 往来\n\n## 承诺\n\n## 期限\n\n## 备注\n"


def cmd_new(args):
    cfg = load_config()
    t = today(cfg).isoformat()
    prefix = today(cfg).strftime("%y%m%d")
    if args.what == "project":
        d = ROOT / "项目" / ("%s-%s" % (prefix, slugify(args.name)))
        path, keys, body = d / "卡片.md", PROJECT_KEYS, PROJECT_BODY
        fm = {"name": args.name, "type": args.type or "待确认", "subtype": args.subtype or "",
              "for_whom": args.for_whom or "待确认", "stage": args.stage or "摸底", "stage_since": t,
              "priority": "P2", "next_owner": "我", "evidence": "M", "sens": args.sens or "内部",
              "origin": "碎碎念", "created": t, "touched": t}
    else:
        sub = "机构" if args.what == "org" else "人"
        path = ROOT / "关系" / sub / ("%s-%s.md" % (prefix, slugify(args.name)))
        keys, body = RELATION_KEYS, RELATION_BODY
        fm = {"name": args.name, "kind": args.kind or "待确认", "org": args.org or "",
              "sens": args.sens or "内部", "created": t, "touched": t}
    if path.exists():
        print("已经有这张卡片了：%s" % path.relative_to(ROOT).as_posix())
        return 1
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(dump_card(keys, fm, body), encoding="utf-8")
    if args.what == "project":
        for sub in ("内部", "对外"):
            (path.parent / sub).mkdir(exist_ok=True)
            (path.parent / sub / ".gitkeep").write_text("", encoding="utf-8")
    print(path.relative_to(ROOT).as_posix())
    return 0


def inbox_items():
    return sorted(INBOX.glob("*.txt"), reverse=True) if INBOX.is_dir() else []


def cmd_ramble(args):
    cfg = load_config()
    items = inbox_items()
    if args.action == "list":
        if not items:
            print("收件箱是空的（这个会话里还没有截到老板的原话）。")
        for i, p in enumerate(items[:15], 1):
            text = p.read_text(encoding="utf-8")
            when = dt.datetime.fromtimestamp(int(p.stem) / 1000, dt.timezone.utc) + dt.timedelta(hours=cfg["tz_offset_hours"])
            print("%d. %s  %d 字  %s" % (i, when.strftime("%m-%d %H:%M"), len(text), text[:40].replace("\n", " ")))
        return 0
    picks = [int(x) for x in args.pick.split(",")] if args.pick else [1]
    chosen = []
    for i in sorted(picks, reverse=True):  # oldest first
        if i < 1 or i > len(items):
            print("收件箱里没有第 %d 条。先运行 ramble list 看看。" % i)
            return 1
        chosen.append(items[i - 1].read_text(encoding="utf-8"))
    body = "\n\n".join(chosen)
    now = now_local(cfg)
    d = ROOT / "碎碎念" / now.strftime("%Y-%m")
    path = d / ("%s-%s.md" % (now.strftime("%y%m%d-%H%M"), slugify(args.title or "碎碎念")))
    if path.exists():
        print("同名文件已经存在：%s" % path.relative_to(ROOT).as_posix())
        return 1
    d.mkdir(parents=True, exist_ok=True)
    head = "---\ntitle: %s\ndate: %s\nsens: %s\nchars: %d\nsha256: %s\n---\n\n" % (
        json.dumps(args.title or "碎碎念", ensure_ascii=False), now.strftime("%Y-%m-%d"),
        args.sens or "内部", len(body), hashlib.sha256(body.encode("utf-8")).hexdigest())
    path.write_text(head + body + "\n", encoding="utf-8")
    print(path.relative_to(ROOT).as_posix())
    return 0


def cmd_hook_prompt(args):
    """UserPromptSubmit hook: keep the owner's words byte-for-byte. Never prints, never fails."""
    try:
        data = json.loads(sys.stdin.read() or "{}")
        text = data.get("prompt") or ""
        if text.strip() and not text.lstrip().startswith("<"):
            INBOX.mkdir(parents=True, exist_ok=True)
            (INBOX / ("%d.txt" % int(time.time() * 1000))).write_text(text, encoding="utf-8")
            for old in inbox_items()[40:]:
                old.unlink()
    except Exception:
        pass
    return 0


def cmd_hook_start(args):
    """SessionStart hook: bounded status text for the model. Never fails."""
    try:
        cfg = load_config()
        t = today(cfg)
        cards = load_cards()
        vis = visibility(cfg, timeout=4)
        open_gate = vis == "private" or cfg["allow_private_in_public_repo"]
        ns = compute_nudges(cards, t, cfg, vis, 0 if open_gate else len(private_pending()))
        L = ["【工作系统 · 开工状态】今天 %s 周%s" % (t.isoformat(), WEEKDAY[t.weekday()])]
        if open_gate:
            L.append("仓库：%s。隐私闸门打开，资料正常备份。" % vis_text(vis))
        else:
            L.append("仓库：%s。隐私闸门关闭：标为「内部」「机密」的资料不能备份到这里。动笔记录客户或关系资料之前，先用一句话提醒老板。" % vis_text(vis))
        if git("merge-base", "--is-ancestor", "HEAD", "origin/main")[0] != 0:
            L.append("当前分支有还没进 main 的改动。")
        n_proj = sum(1 for c in cards if c.kind == "project")
        L.append("卡片：项目 %d，关系 %d。提示 %d 条%s：" % (
            n_proj, len(cards) - n_proj, len(ns), "，先看前 %d 条" % cfg["max_hook_nudges"] if len(ns) > cfg["max_hook_nudges"] else ""))
        L += ["- [%s] %s — %s" % (n["sev"], n["name"], n["text"][:70]) for n in ns[:cfg["max_hook_nudges"]]]
        L.append("做法见 CLAUDE.md。老板开口时先处理他说的事；有「急」的提示，回复末尾用一两行带一句。")
        try:
            cmd_build(argparse.Namespace(quiet=True))
        except Exception:
            pass
        print("\n".join(L)[:2400])
    except Exception as e:
        print("【工作系统】开工检查没跑成（%s）。不影响使用；需要时运行 python3 tools/wos.py doctor。" % type(e).__name__)
    return 0


def cmd_doctor(args):
    cfg = load_config()
    results = []

    def chk(name, ok, detail=""):
        results.append(ok)
        print("%s  %s%s" % ("通过  " if ok else "不通过", name, ("：" + detail) if detail else ""))

    chk("Python 版本够用", sys.version_info >= (3, 8), sys.version.split()[0])
    chk("这是一个 git 仓库", git("rev-parse", "--git-dir")[0] == 0)
    try:
        json.loads(CONFIG_FILE.read_text(encoding="utf-8"))
        chk("配置文件读得懂", True)
    except (OSError, ValueError) as e:
        chk("配置文件读得懂", False, str(e))
    chk("看板模板在", TEMPLATE.exists() and "/*WOS_DATA*/null" in TEMPLATE.read_text(encoding="utf-8"))
    try:
        s = json.loads((ROOT / ".claude" / "settings.json").read_text(encoding="utf-8"))
        hooks = json.dumps(s.get("hooks", {}))
        chk("开工提示和原话保存已接好", "hook-start" in hooks and "hook-prompt" in hooks)
    except (OSError, ValueError) as e:
        chk("开工提示和原话保存已接好", False, str(e))
    for f in ("CLAUDE.md", "水准/我的水准.md", "水准/资料骨架.md"):
        chk("有 %s" % f, (ROOT / f).exists())
    for sk in ("ramble", "make-docs", "backup", "track", "people"):
        chk("技能 %s 在" % sk, (ROOT / ".claude" / "skills" / sk / "SKILL.md").exists())
    cards = load_cards()
    bad = [c for c in cards if c.errors]
    chk("卡片都读得懂（共 %d 张）" % len(cards), not bad, "；".join("%s %s" % (c.rel, c.errors[0]) for c in bad[:3]))
    vis = visibility(cfg, use_cache=False)
    chk("能确认仓库是公开还是私有", vis != "unknown", vis_text(vis))
    chk("能连上 GitHub", git("ls-remote", "--heads", "origin", "refs/heads/main", timeout=40)[0] == 0)
    try:
        cmd_build(argparse.Namespace(quiet=True))
        chk("跟进表和看板能生成", (VIEWS / "跟进表.md").exists())
    except Exception as e:
        chk("跟进表和看板能生成", False, str(e))
    ok = all(results)
    print("\n体检结果：%s（%d 项里 %d 项通过）。仓库现在是%s。" % ("全部通过" if ok else "有问题，见上面「不通过」的行",
          len(results), sum(results), vis_text(vis)))
    return 0 if ok else 1


def main(argv=None):
    ap = argparse.ArgumentParser(prog="wos", description="工作系统命令行")
    sub = ap.add_subparsers(dest="cmd", required=True)
    sub.add_parser("check")
    b = sub.add_parser("build"); b.add_argument("--quiet", action="store_true")
    n = sub.add_parser("nudges"); n.add_argument("--json", action="store_true")
    p = sub.add_parser("privacy"); p.add_argument("--fresh", action="store_true")
    k = sub.add_parser("backup"); k.add_argument("-m", "--message", default=""); k.add_argument("--trailer", default="")
    sub.add_parser("sync")
    nw = sub.add_parser("new")
    nw.add_argument("what", choices=["project", "org", "person"]); nw.add_argument("--name", required=True)
    for a in ("--type", "--subtype", "--for-whom", "--stage", "--sens", "--kind", "--org"):
        nw.add_argument(a, default="")
    r = sub.add_parser("ramble")
    r.add_argument("action", choices=["list", "save"]); r.add_argument("--pick", default="")
    r.add_argument("--title", default=""); r.add_argument("--sens", default="")
    sub.add_parser("doctor"); sub.add_parser("hook-start"); sub.add_parser("hook-prompt")
    args = ap.parse_args(argv)
    fn = globals()["cmd_" + args.cmd.replace("-", "_")]
    rc = fn(args)
    return rc if isinstance(rc, int) else 0


if __name__ == "__main__":
    sys.exit(main())
