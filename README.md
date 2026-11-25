# pitch
is to make outstanding and visually and functionable good digital pitch

## LLM 议会 (LLM Council)

把一个难题交给五位立场互斥的 AI 议员：他们各自陈词、互相驳斥、盖印表决，最后由主席敲槌定案。每一席都可以指定不同的 AI（Claude / ChatGPT / Gemini / DeepSeek / Kimi / Grok / 通义 / 智谱 / OpenRouter / 任意 OpenAI 兼容接口），让不同模型在同一场议会里当面交锋。

| 角色 | 视角 |
|---|---|
| ① 反对者 | 先假设计划有漏洞，直接抓出来 |
| ② 第一性原理者 | 不评价方案，追问你到底想解决什么问题 |
| ③ 扩张者 | 不管风险，只想成功了能做到多大 |
| ④ 局外人 | 假装不懂这个领域，抓出你觉得理所当然但别人看不懂的地方 |
| ⑤ 执行者 | 不谈方向，只谈执行层面 |
| 🏛️ 主席 | 综合共识与分歧，给出裁决、评分与行动令 |

### 三种用法

**1. 网页版（推荐，可加到 iPad 主屏幕长期使用）**

`docs/` 目录是一个纯静态网页，用 GitHub Pages 托管即可：

1. 仓库 → **Settings → Pages** → Source 选 *Deploy from a branch*，Branch 选 `main`（或当前分支），文件夹选 **`/docs`**，保存。
2. 一两分钟后页面地址为 `https://<你的用户名>.github.io/pitch/`。
3. iPad 上用 Safari 打开 → 分享 → **添加到主屏幕**。它会以全屏 App 的形式运行。
4. 点右上角的 **印** 打开「印房」，贴上各家的 API 钥匙（只存在你设备的浏览器里，不上传），给五席和主席任命模型。没有钥匙时是演示模式，可先看效果。

钥匙申请入口在印房里每一家的名字下方。Gemini 有免费额度，OpenRouter 有免费模型（一把钥匙可以调用几乎所有模型），智谱 `glm-4.7-flash` 免费。

> 部分服务商（DeepSeek、通义、智谱、Kimi）可能不允许浏览器直接调用（CORS）。印房里每家都有「试印」按钮会告诉你通不通；不通的可以改走 OpenRouter，或在该行填一个自己的代理地址。

**2. claude.ai 内嵌版（无需钥匙）**

同一个页面发布为 claude.ai Artifact 时，议员直接由你登录的 Claude 账号扮演，用的是订阅额度。

**3. Claude Code 技能版**

```
/llm-council 我想做一个面向小企业的 AI 路演生成工具，月费 $29，值得做吗？
```

技能在 `.claude/skills/llm-council/`，六个议员代理在 `.claude/agents/council-*.md`。复制到 `~/.claude/` 下即可全局使用。

### 开发

```
node council/build.mjs      # 由 council/index.html（Artifact 形态的源文件）生成 docs/index.html 及图标、manifest
```

`council/index.html` 是唯一的源文件；`docs/` 下的文件由构建生成，不要手改。
