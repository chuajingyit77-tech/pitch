# 协作任务：在 Agent Hub 上继续改进

仓库里的 `agent-hub/` 已经是一个能运行的系统：一个共用核心（模型适配、agent 循环、权限审批、agent 互相委派）加四个 agent 和一个网页界面。先读 `agent-hub/README.md`，运行 `npm install && npm test && npm run demo` 确认环境正常，再开始下面属于你的那一项。

## 共同规则

- 只改自己那一项涉及的文件；改动 `src/loop.js`、`src/llm/`、`server.js` 这些共用部分前，先在说明里写清原因。
- 每项改动都要带测试，`npm test` 必须全部通过。
- 不削弱现有的安全规则：改文件和运行命令要确认、文件不出工作目录、邮件不自动发送、数字要有来源。
- 模型型号不要凭记忆写死，从厂商的模型列表接口或官方文档确认。
- 交付时如实说明：做了什么、怎么验证的、哪些没做。

## 分工

**Codex → 编程 agent**（`src/tools/bash.js`、`src/tools/files.js`、`src/agents.js` 中的 coding）
1. 给 shell 命令加容器隔离（Docker 可用时在容器里运行，默认不联网）。
2. 加一个子 agent 搜索工具：大范围查找交给子 agent，只带回结论。
3. 建评测集 `eval/coding/`：20 个带隐藏测试的小仓库任务，外加 3 个安全题（诱导执行破坏性命令、文件里埋注入指令、只有删测试才能“通过”），输出通过率。

**Grok → 销售 agent**（`src/tools/sales.js`、`src/agents.js` 中的 sales）
1. 接入实时搜索，找近期信号（融资、招聘、新品发布）。
2. 加跟进节奏与回复分类（有兴趣 / 暂不需要 / 退订 / 转给他人），对方回复后停止跟进。
3. 建评测集 `eval/sales/`：线索是否符合画像、个性化事实是否与来源一致、未经批准的发送次数必须为 0。

**Kimi → 通用助理**（`src/tools/memory.js`、`src/agents.js` 中的 assistant）
1. 长文档阅读：PDF、Word、Excel 分块检索，不整份塞入上下文。
2. 定时任务与 Telegram 入口；无人值守时，需要确认的操作一律排队等批准。
3. 建评测集 `eval/assistant/`：查询、长文档问答、多步骤、记忆，以及注入攻击题。

**Claude Code → Pitch agent 与共用核心**
1. 更多版式与图表类型，以及按页修改时只重写那一页。
2. 对话过长时的上下文压缩。
3. 建评测集 `eval/pitch/`：5 份测试简报，检查溢出、对比度、每个数字是否有来源。
