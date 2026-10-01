# pitch
is to make outstanding and visually and functionable good digital pitch

## LLM 议会 (LLM Council)

一个 Claude Code 技能：输入问题后召唤 5 个子代理从不同角度并行分析，再由主席统一汇报。

| 角色 | 视角 |
|---|---|
| ① 反对者 Contrarian | 先假设计划有漏洞，直接抓出问题 |
| ② 第一性原理者 First Principles | 不评价方案，追问你到底想解决什么问题 |
| ③ 扩张者 Expansionist | 不管风险，只想成功了能做多大 |
| ④ 局外人 Outsider | 假装不懂这个领域，抓出你觉得理所当然但别人看不懂的地方 |
| ⑤ 执行者 Executor | 不谈方向，只谈执行层面 |
| 🏛️ 主席 Chairman | 汇总共识与分歧，给出裁决和行动计划 |

### 使用方法
在这个仓库里打开 Claude Code，然后：

```
/llm-council 我想做一个面向小企业的 AI 路演 PDF 生成工具，月费 $29，值得做吗？
```

或者直接在消息里写触发词：`LLM council：<你的问题>`。

### 安装到其他项目 / 全局
把下面两个目录复制过去即可：

```
.claude/skills/llm-council/   → <项目>/.claude/skills/  或  ~/.claude/skills/
.claude/agents/council-*.md   → <项目>/.claude/agents/  或  ~/.claude/agents/
```

放进 `~/.claude/` 就在所有项目里都能用。
