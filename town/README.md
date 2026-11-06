# 小镇 · 公司作品提交与评审系统

同事把作品交进来，系统自动分类、改名、归档、读过一遍、写出评审报告，全部落在你的硬盘上。

跑在你自己的机器或服务器上，**不绑任何一家 AI**。换模型改一个环境变量，系统本身不动。

```bash
node town/bin/town.js doctor      # 先看这个：配置、模型、文件夹对不对
node town/bin/town.js run         # 处理收件夹里所有新文件
```

---

## 它解决的四件事

| 你要的 | 这里怎么做 |
| --- | --- |
| 同事上传作品 | Google 表单（或直接丢进收件夹）。什么格式都收 |
| 自动分类 | 按 项目 / 类型 / 提交人 / 日期 四维归档，文件名自动规范化 |
| 自动落到硬盘 | 文件夹就在 Google Drive 桌面版同步目录里 — Google 替你同步 |
| AI 读过并点评 | 66 位检查员，每位只查一件事，结果写成一份报告放回同一个项目夹 |

第三条是关键：**这个系统不自己发明同步机制**。你装上 Google 云端硬盘桌面版，共享硬盘就变成电脑上一个普通文件夹；系统读写那个文件夹，Google 负责把它同步到每个人的机器上。所以「有人交一份就自动到我硬盘」不需要写任何代码。

---

## 装起来

需要 Node 18 以上（建议 22）。没有任何依赖包要装。

```bash
git clone <这个仓库>
cd pitch
node town/bin/town.js doctor
```

### 指向你的 Google Drive

编辑 `town/config/town.config.json`，或用环境变量（环境变量永远优先）：

你们共享硬盘已经用 00–11 编号（01 是品牌与营销，所以档案库不要放 01），建议新开一个 `12_作品提交与评审`：

```bash
# macOS
export TOWN_INBOX="$HOME/Library/CloudStorage/GoogleDrive-exec@prospekcerah.com/My Drive/作品提交表单 (File responses)"
export TOWN_LIBRARY="$HOME/Library/CloudStorage/GoogleDrive-exec@prospekcerah.com/Shared drives/Prospek Cerah Technology/12_作品提交与评审/档案库"

# Windows
set TOWN_INBOX=G:\My Drive\作品提交表单 (File responses)
set TOWN_LIBRARY=G:\Shared drives\Prospek Cerah Technology\12_作品提交与评审\档案库
```

收件夹在 **My Drive** 而不是共享硬盘，是 Google 表单的限制：表单的上传文件只能存进表单拥有者的 My Drive，搬进共享硬盘会让上传失效。Drive 桌面版两边都会同步，系统照样读得到。

### 接上 Google 表单（同事只需要公司 Google 账号）

表单的「文件上传」题要求填写人登录 Google — 你们是 Workspace，同事本来就有公司账号，不用另外注册任何东西。

1. 在 Drive 里建一个表单：**项目**（下拉）、**类型**（下拉）、**一句话说明**（短答）、**上传文件**（文件上传）
2. 表单的「文件上传」会自动在 Drive 建一个回应夹 — 把 `TOWN_INBOX` 指向它
3. 把回应表格导出 CSV，用 `--manifest` 传进来，系统就能读到项目、类型、提交人：

```bash
node town/bin/town.js run --manifest "~/Downloads/表单回应.csv"
```

没有 manifest 也能跑 — 系统会从文件夹位置和文件名判断，并在报告开头写明**哪些是它猜的**。

---

## 换模型

这是整套设计的重点。**换模型只影响判断深度，不影响查什么、查几项。**

```bash
# Claude
TOWN_PRESET=claude   TOWN_API_KEY=sk-ant-...   node town/bin/town.js run

# DeepSeek（便宜很多）
TOWN_PRESET=deepseek TOWN_API_KEY=sk-...       node town/bin/town.js run

# 通义千问
TOWN_PRESET=qwen     TOWN_API_KEY=sk-...       node town/bin/town.js run

# 自己机器上跑，一分钱不花
TOWN_PRESET=ollama   TOWN_MODEL=qwen2.5:14b    node town/bin/town.js run

# 什么都不设 = 只跑规则层，免费，仍然查 14 条规则
node town/bin/town.js run
```

还支持 `moonshot` `groq` `together` `openrouter` `local`（任何 OpenAI 兼容的端点，含 vLLM、LM Studio）。要加新的，只改 `town/core/llm.js` 里的 `PRESETS` 一行。

### 为什么换便宜模型不会垮

三层设计，便宜模型只影响最上面一层：

| 层 | 谁在做 | 换模型的影响 | 花钱 |
| --- | --- | --- | --- |
| 规则层 | 14 条写死的检查（金额、加总、日期、单位、责任上限、自动续约、保密、管辖、交付物、付款、结构、法人、数据时效、数字出处） | **零影响**，结果每次一样 | 免费 |
| 规则+模型 | 规则先定位，定不了才问模型 | 规则能定的时候完全不花钱 | 很少 |
| 模型层 | 50 位检查员，每位一个窄任务 | 判断深度会降，但查的项目一项不少 | 按量 |

便宜模型最常见的失败是跑题和编内容。这套系统在三处上了锁：

1. **每位检查员只有一个任务**，提示词里写明「不做别人的事」
2. **输出必须是固定的 JSON**，格式不对就重试，重试还不对就老实报 `error`，不会假装有结论
3. **引用必须原文照抄** — 系统拿它回原文比对，对不上就把引号删掉。所以报告里的每一句引用都可信

---

## 66 位检查员

每位只做一件事。SOP 一人一份，全部可读、可改：

- 名册：[`town/agents/README.md`](agents/README.md)
- 单人 SOP：`town/agents/<公会>/<名字>.md`，例如 [`keystone/lex.md`](agents/keystone/lex.md)

每份 SOP 写明：职责、什么时候轮到他、怎么查（分步）、pass/flag/fail 的判定标准、不做什么、输出格式，以及**完整的提示词**。所以你可以把任何一位的提示词复制出来，贴到任何一个 AI 里手动跑。

| 公会 | 管什么 |
| --- | --- |
| 证据与事实 Lumen | 说法站不站得住 |
| 表达与叙事 Chorus | 读的人看不看得懂 |
| 钱与价值 Ledger | 钱完不完整、算不算得过 |
| 交付与可执行 Forge | 说要做的事具不具体 |
| 风险与承诺 Mender | 有没有答应做不到的事 |
| 治理与合法性 Keystone | 谁签的、谁批的、照哪条规矩 |
| 数据与逻辑 Lattice | 推理有没有断、数字有没有打架 |
| 流程与可行性 Wayfinder | 从今天到做完这条路通不通 |
| 动力与优先级 Aether | 值不值得现在做 |
| 可持续与长期 Verdant | 做完之后还撑不撑得住 |
| 读者与传达 Hearth | 接手的人能不能照着动 |

改 SOP 的办法：改 `town/core/agents.data.js`，然后 `node town/bin/town.js sops` 重新生成。**不要直接改 `town/agents/` 里的文件** — 它们是生成出来的，下次会被覆盖。

---

## 看得懂的文件格式

| 格式 | 读得出文字 | 说明 |
| --- | --- | --- |
| `.pdf` | 是 | 含中文 CID 字体；扫描件会老实说「这是图片版，要先 OCR」 |
| `.docx` `.pptx` `.xlsx` | 是 | 内建 ZIP + XML 解析，不需要装任何包 |
| `.txt` `.md` `.csv` | 是 | |
| `.png` `.jpg` `.svg` 等 | 图本身送给模型看 | 会看图的模型才跑设计类检查 |
| `.ai` `.psd` `.fig` | 否 | 会归档，报告里写明「请另交一份导出的 PDF/PNG」 |
| `.mp4` | 否 | 这一版不处理影片 |

---

## 命令

```
node town/bin/town.js doctor                   配置、模型、文件夹、每种类型会叫到几位
node town/bin/town.js agents [公会] [--json]   列出检查员
node town/bin/town.js review <文件> [选项]     评审一份文件，报告印在屏幕上
node town/bin/town.js run [选项]               处理整个收件夹
node town/bin/town.js sops                     重新生成 SOP
```

`review` 的选项：`--type` `--project` `--author` `--note` `--only lumen,ledger` `--skip chorus` `--out <目录>` `--json`

`run` 的选项：`--force`（已处理的重跑） `--limit N` `--move`（搬走而不是复制） `--manifest <csv>`

---

## 系统的三条硬规矩

写在代码里，不是写在注释里：

1. **永不搬走别人作品的唯一副本。** 默认复制，要搬必须明确加 `--move`
2. **永不评审空字符串。** 读不出内容就在报告里说为什么读不出，不假装读过
3. **一个文件出错不影响整批。** 批处理会把失败的那个记下来，继续跑完

还有一条：**猜的东西一定标明是猜的**。项目、类型、提交人只要是系统推断的，报告开头就会列出来，让你一眼看出哪里该补资料。

---

## 下一步

- [系统运作 SOP](sop/00-system.md) — 一份作品从交进来到评完，每一步谁做什么
- [66 位检查员名册](agents/README.md)
- 要让评审真的好用，给我两三份你们真实的提案或设计稿，我用它们调提示词 — 比我自己编的假文件有用得多
