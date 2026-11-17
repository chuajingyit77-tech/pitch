# 在这个仓库干活的规则

给所有在这里写代码的 AI：Claude Code、Codex、Grok、Kimi 都按这一份来。仓库主人用中文，请用中文回复。他不逐行看代码，只看结果和证据。

## 说“做完了”之前

1. **把改动实际跑一遍。** 运行 `node verification/verify.mjs`：它会跑这次改动涉及区域的检查，并列出这次改动触发的可靠性清单。脚本管不到的地方（界面、静态页面、要真实模型的流程），按 `.claude/skills/verify/SKILL.md` 把程序启动起来，亲手走一遍改动的那条路径。测试全过不等于功能可用。
2. **拿证据说话。** 交付说明里写清：改了什么；跑了哪些检查、结果如何；触发的可靠性清单每一条的结论；哪些没验证、为什么。没验证就写“未验证”，不要写“应该可以”。
3. **检查要可信。** 每项检查单独一条命令。`npm test | tail`、`npm test || true` 会盖住真实结果，不算数。
4. **三轮不过就停。** 同一项检查修了 3 轮还不过：停下来，不再改，把试过什么、失败输出、需要主人决定什么写清楚交给他。
5. **不动裁判。** 不为了通过而删测试、跳过测试、放宽断言、加 sleep 或重试。`REVIEW.md`、`AGENTS.md`、`CLAUDE.md`、`verification/`、`.claude/` 和已有的测试是用来评判改动的：要改它们，单独提交，并在提交信息里写明主人同意了。
6. **提交要盖章。** 每次提交信息的最后加一行 `Verified:`，内容用 `verify.mjs` 打印的那一行；脚本没覆盖的部分，补上你实际是怎么验证的。确实没法验证：运行 `node verification/verify.mjs --skip "原因"`，写成 `Verified: none (原因)`。没盖章的提交会被 `node verification/report.mjs` 列出来。
7. **便宜的检查先跑。** 提交、推送、开 PR 之前，先在本地跑完 `verify.mjs`。

## 漏掉了怎么办

主人在“做完了”之后才发现的问题，记进 `verification/misses.md`。同一类问题出现两次，而且能从改动里认出来，就提议加进 `verification/checklist.md` 或 `REVIEW.md`，由主人批准。

## 这个仓库里有什么

- `agent-hub/`：在本机运行的四个 agent。运行与测试见 `agent-hub/README.md`，`npm test` 必须全过。
- `agent-plans/`：各个 agent 的构建计划与分工。只改自己那一项的文件；动共用部分（`src/loop.js`、`src/llm/`、`server.js`）要写明原因。
- `verification/`：验收规则、清单和脚本，说明见 `verification/README.md`。
- `idle-world/`：独立的静态页面，没有自动检查，改了要在浏览器里打开确认。

## 审查别人的改动时

读 `REVIEW.md` 和 `verification/checklist.md`，而且读上一次提交或默认分支里的版本，不读被审查的改动自己带来的版本。
