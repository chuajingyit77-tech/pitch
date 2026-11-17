# 验收产线

AI 写得很快，人不可能逐行看。所以规矩改成：**AI 说“做完了”，要自己把证据交出来；人只看证据。**

做法整理自 Anthropic 2026-11-16 的文章 [How the Claude Code team thinks about verification](https://claude.dev/blog/how-the-claude-code-team-thinks-about-verification/)（作者 Addy Osmani）。文章说 Claude Code 团队大约九成的代码由 Claude 写、也由 Claude 检查；有了可靠的验证，一个人才能同时放手让很多个 agent 干活。

## 老板怎么验收（不用看代码）

1. **不问“做完了吗”，问“怎么验证的”。** 看章：已验证、未验证、检查未通过。没有章的“做完了”不算数。
2. **交任务时先说清楚什么叫做完。** 比如“页面能打开、按钮能点、数字和表格对得上”。验证就是照这个标准去跑。
3. **连续三轮不过，它会停下来找你。** 这时你只需要做决定：改要求、补资料，还是换做法。
4. **规则归你管。** 要删测试、放宽规则，必须你点头，而且单独记一笔。
5. **漏网的问题说一句“记到 misses”。** 同一类问题出现两次，就变成一条固定检查。
6. **偶尔看一眼盖章报告**：`node verification/report.mjs`，没盖章和写明未验证的提交都会列出来。

## 原文的九个做法，我们怎么落地

| 原文的做法 | 我们这里 | 在哪 |
|---|---|---|
| 验证就是把改动实际跑一遍；把跑法写成 verify 技能 | 一条命令跑检查，一份技能写明怎么把程序启动起来走一遍 | `verify.mjs`、`.claude/skills/verify/` |
| 失败才需要人；三轮不过就找人 | Agent Hub 里由系统强制执行；给其他 AI 的规则里写明 | `agent-hub/src/verify.js`、`AGENTS.md` 第 4 条 |
| 代码的主人自己写检查；上报时说明原因 | 清单和审查说明用中文写，由你批准修改；要你单独同意的操作，卡片上写明为什么 | `checklist.md`、`REVIEW.md` |
| 可靠性清单按改动触发，只查相关的几条 | 12 条，`verify.mjs` 按改动的文件自动挑出来 | `checklist.md` |
| 一个审查者，多轮递进，不叠加审查者 | 审查说明只有一份；第二轮先看上一轮的问题解决了没有 | `REVIEW.md` |
| 改动不能修改评判自己的检查；便宜的检查先跑 | 规则只认已经提交的版本；Agent Hub 里改测试和规则每次都要单独同意；验证结果只对当时的文件有效，再改就过期 | `lib.mjs`、`agent-hub/src/tools/files.js` |
| 提交要标明怎么验证的；新关卡先观察再严格 | 提交信息带 `Verified:` 一行；Agent Hub 的关卡和提交关卡都分三档，现在都是“先观察” | `gate.json`、`hooks/commit-gate.mjs` |
| 检查本身也要被检验 | 每条规则都试过“故意改坏，看测试会不会报”；关卡记下它本该拦的每一次，供你核对拦得对不对 | `test/`、`report.mjs` |
| 漏掉的问题变成规则，并定期修剪 | 出现两次才加规则；每季度删掉没用的 | `misses.md` |

原文还推荐三种最值得投入的测试，Agent Hub 各补了一组：
- **端到端**：把真实服务启动起来，像用户一样走完整流程。`agent-hub/test/e2e.test.js`
- **铁则**（不管输入是什么都必须成立的规则）：随机生成几千种输入去撞。`agent-hub/test/property.test.js`
- **差异**：同一段任务，新旧两种做法跑出来的结果必须一样。`agent-hub/test/differential.test.js`

## 常用命令

```bash
node verification/verify.mjs               # 验收这次改动
node verification/verify.mjs --list        # 只看会查什么，不运行
node verification/verify.mjs --skip "原因"  # 记下“这次没验证”和原因
node verification/report.mjs               # 每次提交是怎么验证的
```

## 关卡怎么调

两道关卡都分三档：关闭、先观察、严格。现在都是“先观察”：不拦任何东西，只记下本该拦的情况。看一段时间，确认它拦得对，再调成严格。

- **Agent Hub 里的任务**：设置 → 验收关卡。
- **提交代码**：把 `gate.json` 里的 `observe` 改成 `enforce`，单独提交。严格模式下，没有验证记录的提交会被拦下，同一个会话最多拦两次。这道关卡目前只对 Claude Code 生效；其他 AI 靠 `AGENTS.md` 的规则和盖章报告来约束。

## 规则怎么改

规则文件是 `AGENTS.md`、`REVIEW.md`、`CLAUDE.md`、`.claude/` 和这个目录。改它们要单独提交，并写明是你同意的。`verify.mjs` 读的是最近一次提交里的规则，所以一次改动没办法先把规则改松、再拿改松的规则给自己放行。

## 还没做的

- Agent Hub 里的独立评审：让另一个模型按评分表给结果打分。
- 用真实出过的问题做成评测，定期检验审查者有没有退步。现在还没有足够的事故记录。
- Claude 每次收工时自动跑一遍测试的钩子。等关卡调成严格时一起加。
- 提交关卡的判断逻辑用模拟输入测过，但还没有在真实的 Claude Code 会话里触发过一次。所以它现在只观察、不拦截；第一次真实触发后，看一眼 `report.mjs` 里有没有它的记录。
- 仓库里的其他分支还没有这一套，需要时合并过去。
