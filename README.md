# AffinBank 提案包 / AFFIN Bank pitch kit

面向 **Affin Bank Berhad** 的银行数字化风控 + 运营降本方案提案材料。
底层内容来自两份中文方案：《银行数字化风险管理平台》（B1–B5 风控）与《智驱未来，精益运营》（A1–A8 运营），合计 13 个模块。

---

## 目录

| 文件 | 语言 | 用途 |
|------|------|------|
| `command-centre/index.html` | EN / 中文可切换 | **数字指挥中心 Demo** — 会议现场演示用的主武器 |
| `docs/executive-brief.html` | 英文 | 两页执行摘要（网页版，可再导出 PDF） |
| `docs/executive-brief.pdf` | 英文 | **打印版留置文件**，A4 两页，打印 8–10 份带去 |
| `docs/battlecard-zh.md` | 中文 | **内部作战手册** — 带什么、见谁、怎么讲、异议怎么答、怎么报价 |

---

## 一、指挥中心 Demo 怎么用

```
直接用浏览器打开 command-centre/index.html
```

- **完全离线**：单个 HTML 文件，无外部依赖、无需网络、无需服务器。拷到 U 盘也能跑。
- 建议用 **Chrome / Edge 全屏（F11）** 演示，1440×900 以上分辨率。
- 右上角 `EN / 中文` 切换。**现场全程用 EN**，中文版留给自己彩排。

### 五个视图

| # | 视图 | 讲给谁听 | 核心信息 |
|---|------|----------|----------|
| 01 | Portfolio Overview 全局态势 | 所有人 | 全国资产地图 + 实时风险信号流 + 13 模块状态 |
| 02 | Construction Loans 建筑贷款 | **CRO / 信贷风险** | 放款 61.7% vs 实测进度 47.3%，超放 3,460 万令吉 |
| 03 | Collateral 抵押品 | 信贷管理 | LTV 每日重算、12 笔突破政策、重估成本 3,200 → 780 令吉 |
| 04 | Operating Cost 运营成本 | **COO / CFO** | A1–A8 每年省 4,500–6,300 万令吉 |
| 05 | The Business Case 价值与落地 | 决策层 | 价值构成、11 个月回本、90 天试点、马来西亚合规六条 |

### 现场必做的一个动作

第 02 屏右下角 **「Task drone survey」** 按钮 —— 现场点一次，会跑完整条链路（申报飞行许可 → 采集影像 → 与 BIM 配准 → 重算进度 → 触发暂缓拨付 → 通知信贷委员会），并实时更新左边的曲线和右边的建议动作。**这是整场演示最有说服力的 20 秒。**

---

## 二、关于数据

Demo 与执行摘要中的**所有数字都是示意与测算**，不是真实客户数据，也不是业绩承诺。
页面顶部与页脚都有明确标注（`CONCEPT DEMO · ILLUSTRATIVE DATA`）。测算口径按「150 家网点、82 亿令吉建筑贷款账簿」的假想银行搭建，需要在调研阶段用银行实际总账重算 —— 这一点在材料里已经写明，**现场也要主动说出来**，这是可信度，不是弱点。

---

## 三、还没做完的（见 `docs/battlecard-zh.md` 第十节）

- 🔴 两份主方案 PDF 的**英文版**
- 🔴 马来西亚**本地交付实体 / 合作伙伴**（RMiT 第三方评估的前提）
- 🔴 本地持证**无人机运营商**（CAAM ATF + RCoC-B + JUPEM APK）
- 🟡 三家中方公司英文资质包、双向 NDA 英文模板、本地持牌 CA（电子签章）

---

## 四、重新生成 PDF

修改 `docs/executive-brief.html` 后：

```bash
npm i playwright
node -e "
const {chromium}=require('playwright');(async()=>{
const b=await chromium.launch();const p=await b.newPage();
await p.goto('file://'+process.cwd()+'/docs/executive-brief.html');
await p.emulateMedia({media:'print'});
await p.pdf({path:'docs/executive-brief.pdf',format:'A4',printBackground:true,
  margin:{top:'0',right:'0',bottom:'0',left:'0'},preferCSSPageSize:true});
await b.close();})()"
```

打印版式已按 A4 两页调好；改动正文时注意别让第 2 页溢出到第 3 页。
