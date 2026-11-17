---
name: verify
description: 在说“做完了”或提交之前验证改动：跑检查、把程序实际运行一遍、整理证据、给提交盖章。改完代码、准备提交、或者被问“验证过了吗”时用。
---

# 验证改动

目标是拿出证据，证明改动真的能用。测试通过只是证据的一部分：测试可以全过，而功能照样是坏的。

## 1. 先跑便宜的检查

在仓库根目录运行：

```bash
node verification/verify.mjs
```

它会跑这次改动涉及区域的检查，列出没有自动检查的文件，并列出这次改动触发的可靠性清单。有检查失败就先修好原因，再跑。

- 每项检查单独一条命令。不要接 `| tail`、`|| true`，那样看到的是后一条命令的结果。
- 同一项检查修了 3 轮还不过：停下来，不再改，把试过什么、失败输出、需要主人决定什么交给他。
- 不许为了通过去改测试或 `verification/` 里的规则。

## 2. 把改动实际跑一遍

像测试人员那样用一遍改到的功能。只跑测试不算做完这一步。

### agent-hub

演示模式用模拟模型，不需要任何 key，数据写到临时目录，不会碰真实数据：

```bash
cd agent-hub
[ -d node_modules ] || npm ci --no-audit --no-fund
PORT=4399 AGENT_HUB_DATA="$(mktemp -d)" npm run demo > /tmp/agent-hub-demo.log 2>&1 &
sleep 2
curl -s http://localhost:4399/api/state                # 服务起来了吗，四个 agent 都在吗
curl -s -N -X POST http://localhost:4399/api/chat -H 'content-type: application/json' \
  -d '{"agent":"pitch","text":"演示"}'                  # 走一遍 pitch 流程，输出是一行一个事件
curl -s http://localhost:4399/api/verification         # 这次任务盖了什么章
```

用完关掉：`pkill -f "server.js --demo"`。

- 每个 agent 在演示模式下有一段固定流程：pitch 记录事实并生成一份 pitch；sales 保存一条线索并起草邮件；assistant 写一个文件；coding 运行 `ls`。
- coding 要先有工作目录，给它一个临时目录就行：
  `curl -s -X POST http://localhost:4399/api/config -H 'content-type: application/json' -d '{"codingWorkspace":"/tmp"}'`
- coding 的命令需要批准：事件流里会出现一条 `"type":"approval"`，带一个 `id`。另开一条命令批准它：
  `curl -s -X POST http://localhost:4399/api/approve -H 'content-type: application/json' -d '{"id":"<那个 id>","allow":true}'`
- 改了界面（`public/`）：用浏览器工具打开 `http://localhost:4399`，把改到的地方点一遍，截图自己看，并确认控制台没有报错。看数据的测试发现不了显示错误。
- 要验证的行为不在固定流程里（比如连续失败三轮、改测试时的确认）：写一个临时脚本，用 `setMockScript([...])` 给模拟模型排好每一步，再 `import` `server.js`。写法参照 `agent-hub/test/verify.test.js` 里的 `run()`；临时脚本放在仓库外面，不提交。

### 静态页面（如 idle-world）

没有自动检查。在浏览器里打开页面，确认能加载、控制台没有报错、改动的地方表现正确，并截图。

### 其它区域

`verify.mjs` 报“没有自动检查”的文件：找到它实际运行的方式，运行一遍。以后还会反复改的区域，在 `verification/recipes.json` 里给它加一条配方。那是规则文件，要单独提交，并经主人同意。

## 3. 过一遍可靠性清单

`verify.mjs` 列出的每一条，各给一句结论：没问题，还是有问题、怎么处理了。结论写进交付说明。

## 4. 盖章

改完最后一处之后，再跑一次 `node verification/verify.mjs`：结果只对文件当时的状态有效。然后把它打印的 `Verified:` 那一行放在提交信息的最后；第 2 步里实际运行看到的结果，接在同一行后面。

确实没法验证时，运行 `node verification/verify.mjs --skip "原因"`，提交信息里写 `Verified: none (原因)`。如实写“没验证”可以接受，把没验证的说成做完了不可以。

## 交付说明的样子

```
改了什么：……
检查：agent-hub npm test ✓（全部通过）
实际运行：演示模式走了 pitch 流程，生成的 pitch 能打开，没来源的数字被标成“待确认”
可靠性清单：R5 没问题（没来源的数字仍被标出）；R7 没问题（旧会话能打开）
没验证的：用真实模型跑的效果，因为这里没有 key
```
