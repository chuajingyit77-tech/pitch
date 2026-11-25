#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Self-tests for tools/wos.py. Run: python3 tools/test_wos.py
Each test builds a throw-away git repo with a local bare 'origin', so nothing touches the real repo or the network.
"""
import hashlib
import json
import os
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
TODAY = "2026-12-01"


def sh(cwd, *args, env=None, stdin=None):
    e = dict(os.environ)
    e.update(env or {})
    p = subprocess.run(list(args), cwd=cwd, text=True, capture_output=True, env=e, input=stdin)
    return p.returncode, p.stdout + p.stderr


class Repo:
    def __init__(self, visibility="public"):
        self.tmp = Path(tempfile.mkdtemp(prefix="wos-test-"))
        self.root = self.tmp / "work"
        self.root.mkdir()
        (self.root / "tools").mkdir()
        (self.root / "config").mkdir()
        for f in ("wos.py", "dashboard.template.html"):
            shutil.copy(HERE / f, self.root / "tools" / f)
        (self.root / "config" / "wos.json").write_text("{}", encoding="utf-8")
        (self.root / ".gitignore").write_text(".wos/\n视图/\n", encoding="utf-8")
        sh(self.tmp, "git", "init", "-q", "--bare", "origin.git")
        sh(self.root, "git", "init", "-q", "-b", "main")
        sh(self.root, "git", "config", "user.email", "test@example.invalid")
        sh(self.root, "git", "config", "user.name", "test")
        sh(self.root, "git", "remote", "add", "origin", str(self.tmp / "origin.git"))
        sh(self.root, "git", "add", "-A")
        sh(self.root, "git", "commit", "-q", "-m", "init")
        sh(self.root, "git", "push", "-q", "-u", "origin", "main")
        sh(self.root, "git", "checkout", "-q", "-b", "claude/test-session")
        self.env = {"WOS_TODAY": TODAY, "WOS_VISIBILITY": visibility}

    def wos(self, *args, stdin=None):
        return sh(self.root, sys.executable, "tools/wos.py", *args, env=self.env, stdin=stdin)

    def write(self, rel, text):
        p = self.root / rel
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(text, encoding="utf-8")

    def committed(self):
        return sh(self.root, "git", "-c", "core.quotepath=false", "ls-tree", "-r", "--name-only", "HEAD")[1].split("\n")

    def close(self):
        shutil.rmtree(self.tmp, ignore_errors=True)


def project(name, sens="内部", stage="制作", extra="", body=""):
    return ("---\nname: \"%s\"\ntype: 其他\nsubtype: 提案\nfor_whom: 具体客户\nstage: %s\npriority: P1\n"
            "sens: %s\ncreated: 2026-11-20\ntouched: 2026-11-30\n%s---\n\n## 进展\n\n## 承诺\n%s\n## 期限\n\n## 决定\n"
            % (name, stage, sens, extra, body))


class WosTests(unittest.TestCase):
    def setUp(self):
        self.r = None

    def tearDown(self):
        if self.r:
            self.r.close()

    def test_card_format_is_tolerant_and_strict_where_it_matters(self):
        self.r = Repo()
        # full-width colon, inline list, unquoted Chinese: tolerated
        self.r.write("项目/a/卡片.md", "---\nname：示例项目\naliases: [银行那个, \"另一个叫法\"]\ntype: 系统\nstage: 摸底\n"
                                      "sens: 内部\ncreated: 2026-11-20\n---\n")
        # unknown enum value and bad date: reported in plain Chinese
        self.r.write("项目/b/卡片.md", "---\nname: \"坏卡片\"\ntype: 系统\nstage: 进行中\nsens: 内部\ncreated: 上周\n---\n")
        rc, out = self.r.wos("check")
        self.assertEqual(rc, 1)
        self.assertNotIn("项目/a/卡片.md", out)
        self.assertIn("项目/b/卡片.md", out)
        self.assertIn("进行中", out)
        self.assertIn("不是 年-月-日", out)

    def test_nudges_cover_the_owner_rules(self):
        self.r = Repo()
        w = self.r.write
        w("项目/p1/卡片.md", project("答应过期", body="- [ ] 2026-11-28 我答应 发报价单\n- [x] 2026-11-20 我答应 已经做完的事\n",
                                  extra="next: \"跟进\"\nnext_due: 2026-12-10\npayer: \"对方公司\"\nbudget_source: \"年度预算\"\n"
                                        "next_paid_step: \"试点首期款\"\ngate_date: 2027-01-15\n"))
        w("项目/p2/卡片.md", project("没有下一步"))
        w("项目/p3/卡片.md", project("硬期限", extra="next: \"交标书\"\nnext_due: 2026-12-02\n").replace(
            "## 期限\n", "## 期限\n- [ ] 2026-12-03 投标截止\n"))
        w("项目/p4/卡片.md", project("历史项目", stage="待确认"))
        w("项目/p5/卡片.md", project("搁置到期", stage="搁置", extra="revisit: 2026-11-30\n"))
        w("项目/p6/卡片.md", project("止损", extra="next: \"x\"\nnext_due: 2026-12-20\nkill_rule: \"月底没有书面范围就停\"\nkill_date: 2026-11-30\n"))
        w("关系/人/r1.md", "---\nname: \"林经理\"\nkind: 潜在客户\ncadence_days: 14\nlast_contact: 2026-11-01\nsens: 内部\ncreated: 2026-11-01\n---\n")
        rc, out = self.r.wos("nudges", "--json")
        self.assertEqual(rc, 0, out)
        ns = json.loads(out)
        got = {(n["sev"], n["name"]): n["text"] for n in ns}
        self.assertIn("答应的事过期 3 天", got[("急", "答应过期")])
        self.assertNotIn("已经做完的事", json.dumps(ns, ensure_ascii=False))
        self.assertTrue(any(n["name"] == "没有下一步" and "没有下一步" in n["text"] for n in ns))
        self.assertTrue(any(n["name"] == "没有下一步" and "无付款路径" in n["text"] for n in ns))
        self.assertFalse(any(n["name"] == "答应过期" and "无付款路径" in n["text"] for n in ns))
        self.assertIn("期限还剩 2 天", got[("急", "硬期限")])
        self.assertFalse(any(n["name"] == "历史项目" for n in ns))
        self.assertTrue(any(n["sev"] == "提醒" and n["name"] == "搁置到期" for n in ns))
        self.assertTrue(any(n["sev"] == "急" and n["name"] == "止损" for n in ns))
        self.assertTrue(any(n["name"] == "林经理" and "30 天没联系" in n["text"] for n in ns))
        self.assertTrue(any("历史项目等你确认" in n["text"] for n in ns))
        self.assertEqual([n["sev"] for n in ns], sorted((n["sev"] for n in ns), key=["急", "注意", "提醒"].index))

    def test_backup_in_public_repo_holds_back_private_files(self):
        self.r = Repo("public")
        self.r.write("项目/open/卡片.md", project("公开项目", sens="公开", extra="next: \"x\"\nnext_due: 2026-12-20\n"))
        self.r.write("项目/open/底稿.md", "# 底稿\n")
        self.r.write("项目/secret/卡片.md", project("客户项目", sens="内部", extra="next: \"x\"\nnext_due: 2026-12-20\n"))
        self.r.write("项目/secret/内部/作战手册.md", "> 内部用，不外发\n")
        self.r.write("关系/人/lin.md", "---\nname: \"林经理\"\nkind: 客户\nsens: 内部\ncreated: 2026-11-01\n---\n")
        self.r.write("碎碎念/2026-12/a.md", "---\ntitle: \"x\"\nsens: 内部\n---\n\n原话\n")
        self.r.write("想法停车场.md", "# 想法\n- 一个想法\n")
        self.r.write("CLAUDE.md", "# rules\n")
        rc, out = self.r.wos("backup")
        self.assertEqual(rc, 0, out)
        files = self.r.committed()
        self.assertIn("CLAUDE.md", files)
        self.assertIn("项目/open/卡片.md", files)
        self.assertIn("项目/open/底稿.md", files)
        for f in ("项目/secret/卡片.md", "项目/secret/内部/作战手册.md", "关系/人/lin.md", "碎碎念/2026-12/a.md", "想法停车场.md"):
            self.assertNotIn(f, files, "private file leaked into a public repo: " + f)
        self.assertIn("没有备份的私密文件 5 个", out)
        self.assertIn("还没进 main", out)
        self.assertFalse(any(f.startswith("视图/") or f.startswith(".wos/") for f in files))
        # the push really reached origin
        rc, remote = sh(self.r.root, "git", "ls-remote", "origin", "refs/heads/claude/test-session")
        rc, head = sh(self.r.root, "git", "rev-parse", "HEAD")
        self.assertEqual(remote.split()[0], head.strip())

    def test_backup_in_private_repo_commits_everything_then_reports_clean(self):
        self.r = Repo("private")
        self.r.write("项目/secret/卡片.md", project("客户项目", extra="next: \"x\"\nnext_due: 2026-12-20\n"))
        self.r.write("关系/人/lin.md", "---\nname: \"林经理\"\nkind: 客户\nsens: 机密\ncreated: 2026-11-01\n---\n")
        rc, out = self.r.wos("backup")
        self.assertEqual(rc, 0, out)
        files = self.r.committed()
        self.assertIn("项目/secret/卡片.md", files)
        self.assertIn("关系/人/lin.md", files)
        self.assertNotIn("没有备份的私密文件", out)
        rc, out = self.r.wos("backup")
        self.assertEqual(rc, 0, out)
        self.assertIn("没有新改动", out)

    def test_unknown_visibility_is_treated_as_public(self):
        self.r = Repo("unknown")
        self.r.write("关系/人/lin.md", "---\nname: \"林经理\"\nkind: 客户\nsens: 内部\ncreated: 2026-11-01\n---\n")
        rc, out = self.r.wos("backup")
        self.assertEqual(rc, 0, out)
        self.assertNotIn("关系/人/lin.md", self.r.committed())

    def test_broken_card_never_blocks_a_backup(self):
        self.r = Repo("private")
        self.r.write("项目/bad/卡片.md", "---\nname: \"坏卡片\"\nstage: 乱写\n")  # no closing ---
        rc, out = self.r.wos("backup")
        self.assertEqual(rc, 0, out)
        self.assertIn("项目/bad/卡片.md", self.r.committed())
        self.assertIn("格式有问题", out)

    def test_ramble_is_saved_byte_for_byte(self):
        self.r = Repo()
        said = "这个 project 啊，我跟你讲…  先做 pilot，RM 多少还没定！\n第二段：他说 next week 给答复。"
        rc, out = self.r.wos("hook-prompt", stdin=json.dumps({"prompt": said}))
        self.assertEqual((rc, out), (0, ""))
        rc, out = self.r.wos("ramble", "save", "--pick", "1", "--title", "银行 pilot")
        self.assertEqual(rc, 0, out)
        text = (self.r.root / out.strip()).read_text(encoding="utf-8")
        self.assertTrue(text.endswith(said + "\n"))
        self.assertIn("sha256: " + hashlib.sha256(said.encode("utf-8")).hexdigest(), text)
        self.assertIn("sens: 内部", text)

    def test_hooks_never_fail_or_block(self):
        self.r = Repo()
        self.assertEqual(self.r.wos("hook-prompt", stdin="not json at all")[0], 0)
        self.r.write("项目/bad/卡片.md", "garbage without front matter")
        rc, out = self.r.wos("hook-start")
        self.assertEqual(rc, 0)
        self.assertIn("开工状态", out)
        self.assertLess(len(out), 2600)

    def test_new_card_roundtrips_and_dashboard_builds(self):
        self.r = Repo()
        rc, out = self.r.wos("new", "project", "--name", "示例: 带冒号 \"引号\" 的名字", "--type", "其他", "--subtype", "提案")
        self.assertEqual(rc, 0, out)
        rc, out2 = self.r.wos("check")
        self.assertEqual(rc, 0, out2)
        rc, out3 = self.r.wos("build")
        self.assertEqual(rc, 0, out3)
        page = (self.r.root / "视图" / "看板.html").read_text(encoding="utf-8")
        self.assertNotIn("/*WOS_DATA*/null", page)
        self.assertIn("示例: 带冒号", page)
        self.assertNotIn("<html", page.lower())
        tracker = (self.r.root / "视图" / "跟进表.md").read_text(encoding="utf-8")
        self.assertIn("没有下一步", tracker)


if __name__ == "__main__":
    unittest.main(verbosity=1)
