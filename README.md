# pitch

三丰智能装备集团（深交所 300276）× 我方马来西亚公司 —— 市场进入与合作提案。

两份可分享的在线 Pitch，以及支撑它们的研究底稿。

## PDF（拿去开会用的版本）

| 文件 | 内容 |
|---|---|
| `dist/Sanfeng-Malaysia-Partnership-Proposal.pdf` | 给合作方（三丰）看的合作提案 + 附录（01 能力地图、02 市场研判） |
| `dist/Smart-Factory-Malaysia-Customer.pdf` | 对外客户方案（中英双语）。网页版的交互计算器在 PDF 里换成了四个典型项目的静态 ROI 算例 |

页面为 1024×768（4:3），iPad 横屏全屏阅读正好一页一屏；文件名用英文，避免部分设备对中文文件名的兼容问题。

两份 PDF 都是**给合作方看的对外版**：只保留市场进入、行业、方案与合作路径。去掉的内容：双方公司资料与联系方式、三丰财务数据、内部讨论议程、我方口径的三年损益与启动资金、首次会议话术、附录 03（谈判策略）与 04（财务模型）、客户方案里的"我们是谁"一节。剥离规则在 `decks/build_pdf.py`。网页版保留完整内容（公司信息由 `decks/company.json` 填充），内部讨论请用网页版和 `research/03`、`research/04`。

## 在线版本

| 用途 | 链接 |
|---|---|
| **对内**：给三丰高层的合作提案（中文） | https://claude.ai/code/artifact/7cd1eaab-8b18-43d6-b8d4-2f8b07f17f31 |
| **对外**：给马来西亚客户的方案（中英双语，含 ROI 计算器） | https://claude.ai/code/artifact/f17f3f72-8fc7-4753-bcf5-95cb65e8f0f6 |

Artifact 默认私密，需在页面的分享菜单里主动分享后别人才能打开。

## 目录

```
research/
  01-sanfeng-capability-map.md   三丰七大子公司能力 → 马来西亚场景映射；需向三丰确认的 7 个问题
  02-malaysia-market.md          政策与市场研判（NIMP 2030 / Automation CA / 外劳征费 / 四大行业），含来源链接
  03-business-model.md           三阶段合作路径、背靠背合同结构、商务条款、跨境合规、风险登记册、首次会议话术
  04-financial-model.md          单项目经济模型、三年三情景损益、三丰口径测算、客户 ROI 算法
decks/
  internal-sanfeng-cn.html            对内提案（自包含，图片已内联，可直接双击打开或邮件发送）
  external-customer-bilingual.html    对外方案（同上）
  src/*.template.html                 可编辑源文件，图片以 {{img:name}} 占位
  assets/img/*.jpg                    从三丰画册裁切的产品实景图
  build.py                            把占位符替换成内联图片，生成上面两个 HTML
  build_pdf.py                        组装合作方版打印稿（剥离内部内容）并调用 print_pdf.js 输出 PDF
  print_pdf.js                        用 Chromium 把打印稿渲染成带页码的 4:3 PDF
dist/
  *.pdf                               生成的 PDF
```

## 改内容怎么做

正文与样式都在 `decks/src/*.template.html` 里改，改完重新打包：

```bash
python3 decks/build.py
```

`decks/` 下的两个 `.html` 是生成物，不要直接改（会被覆盖）。改完把同一个文件路径重新发布，在线链接不变。

重新生成 PDF（需要 Chromium、`pip install markdown`、`npm i playwright-core`）：

```bash
python3 decks/build.py
NODE_PATH=./node_modules python3 decks/build_pdf.py
```

Chromium 路径默认取 Playwright 的安装位置，可用环境变量 `CHROMIUM` 指定。

## 公司资料怎么填

两份 Pitch 里所有 `【待填：…】` 都来自 `decks/company.json`。把对应字段填上，再运行 `python3 decks/build.py`，正文、封面、联系方式会自动替换；留空的字段继续显示为【待填】。字段：

- `name` / `name_cn` / `website` / `reg_no` / `founded` / `team_size`
- `profile_cn` / `profile_en`：公司介绍（业务、团队、既有业绩）
- `phd_cn`：数字化转型博士的专业方向与代表项目
- `network_cn`：可覆盖的客户 / 园区 / 政府机构类型
- `funding_cn`：可投入的启动资金与团队规模
- `contact_name` / `contact_title` / `phone` / `whatsapp` / `email` / `address`

原本需要你提供的信息：

1. 我方公司中英文名称、注册地、成立年份、团队规模、既有业绩
2. 数字化转型博士的专业方向与代表项目
3. 可覆盖的客户 / 园区 / 政府机构类型
4. 联系人、电话 / WhatsApp、邮箱、公司地址
5. 实际可投入的启动资金与团队人数（用于重算 `research/04-financial-model.md`）

另外有一个信息会改变整个方案的定位，需要在与三丰的第一次会议上问清楚：**三丰在马来西亚 / 东南亚是否已有代理商或在谈的合作方**。若已有，Phase 1 要改成"行业补位"而非"独家路径"。

## 数据与版权

- 三丰能力描述与全部产品图片来自集团画册（2025-03 版）；**图片版权归三丰智能所有，对外使用前需取得书面授权**。
- 财务数据来自三丰智能 2025 年度报告摘要（深交所，2026-04-28）。
- 马来西亚政策与市场数据的来源链接见 `research/02-malaysia-market.md`，Pitch 页脚也列出了来源。
- 所有三年测算均为标注假设的模型，不是预测。
