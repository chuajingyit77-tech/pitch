# 给所有 AI 助手（Codex、Grok、Kimi、Claude Code……）

这个仓库是老板的个人工作系统。你和别的 AI 共用同一套规则、同一个工具、同一批卡片，所以老板能在一个地方看见所有 AI 做的事。

## 开工前（必须）

1. 完整读一遍 `CLAUDE.md`——那是唯一的规则来源，对你同样适用。
2. 读 `水准/我的水准.md`——成品要达到的标准。
3. 要做哪类事，就读对应的做法（都是普通的 Markdown，谁都能读）：
   - 处理老板的一大段话：`.claude/skills/ramble/SKILL.md`
   - 做资料：`.claude/skills/make-docs/SKILL.md` 和 `水准/资料骨架.md`
   - 备份和同步：`.claude/skills/backup/SKILL.md`
   - 跟进表、提示、建议：`.claude/skills/track/SKILL.md`
   - 关系：`.claude/skills/people/SKILL.md`
   - 接任务书、交回成果：`.claude/skills/handoff/SKILL.md`
4. 运行 `python3 tools/wos.py hook-start`，看今天的状态和提示。（Claude Code 会自动运行，你要手动。）

## 你和 Claude 唯一的不同：署名

每次用工具记东西，都带上你自己的名字，这样老板知道是谁做的：

```
python3 tools/wos.py log "项目名" 进展 "做了什么" --by Codex
python3 tools/wos.py set "项目名" stage=推进 --by Codex
```

也可以在开工时设一次环境变量：`export WOS_AI=Codex`。

## 工具（只用这一个，不要手改卡片）

```
python3 tools/wos.py new project --name "……"      新建卡片（org、person 同理）
python3 tools/wos.py set "卡片" 键=值 ……            改表头，带校验
python3 tools/wos.py log "卡片" 节名 "一行文字"      记一行（进展 承诺 期限 决定 派工 备注 往来）
python3 tools/wos.py done "卡片" "那一行里的几个字"   勾掉一件事
python3 tools/wos.py check                          检查所有卡片
python3 tools/wos.py doccheck "项目名"               检查资料：内外有别、数字有出处
python3 tools/wos.py build                          重新生成跟进表和看板
python3 tools/wos.py backup                         提交并推送当前分支（会过隐私闸门）
python3 tools/wos.py sync                           看 GitHub 上所有分支：并进来，或登记成项目
python3 tools/wos.py doctor                         系统体检
```

## 接到任务书时

任务书在 `项目/<项目>/内部/交接_<你的名字>_<日期>.md`。照它做，交付时把最后的「回执」原样填好，成果放进任务书指定的位置，然后：

```
python3 tools/wos.py done "项目名" "任务里的几个字" --note "一句话结果"
python3 tools/wos.py log "项目名" 进展 "交回了什么，还缺什么" --by 你的名字
python3 tools/wos.py backup
```

## 四条不能破的

1. 回复老板一律用简体中文，结论先说，少用术语。
2. 不编造数字，不把推断写成事实；内部内容不进对外资料；没有老板点头，任何东西不发出去。
3. 仓库公开时，客户、关系、财务这类私密资料不提交。`backup` 会自己把关，不要绕过它。
4. 不改 `水准/我的水准.md`、不改检查规则来让自己过关。要改，单独提出来，等老板同意。
