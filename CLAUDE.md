# Project: Prospek Cerah CRM (in `pitch` repo)

## 与用户沟通
- 用户是 Prospek Cerah 的老板，单人使用本系统，非程序员。
- 回复一律用**简体中文**，少用术语；代码和界面文案保持现有中文风格。
- 用户重视：科技感的视觉、系统"主动提醒该做什么"、长期可用、手机可用。

## 项目结构
- `crm/index.html` — 整个 CRM 应用（单文件：HTML+CSS+JS，无构建步骤，无框架）。
- `crm/sw.js`, `crm/manifest.webmanifest`, `crm/icon-*.png` — PWA（可安装到手机、离线可用）。
- `crm/supabase-setup.sql` — 云同步数据库表结构（Supabase 项目 `snmooeroilxegvtzuloc`）。
- `.github/workflows/deploy-pages.yml` — 推送后自动部署 `crm/` 到 GitHub Pages。

## 设计系统（指挥中心风格，深色单主题）
- 背景 `#05080F` 深空蓝黑 + 网格纹理；面板 `#0C1322`。
- 主色：青色 `#22D3EE`（accent）+ 琥珀 `#FFB454`（品牌太阳/警示）；语义色：红 `#FF6B6B`、绿 `#3DDC97`。
- 数据/数字用等宽字体（`--mono`），眉标用大写字母加宽字距。
- 界面语言：中文为主，眉标可配英文（如 FOCUS、BRIEFING）。

## 核心业务逻辑（改动前先理解）
- 阶段：New→Contacted→Meeting→Proposal→Negotiation→Won/Lost（内部存英文，界面显示中文）。
- 优先级引擎 `analyse()`：紧急度（逾期/各阶段静默上限 ROT_DAYS/新线索未联系）+ 价值 + 阶段成交率 STAGE_PROB。
- 数据存 localStorage key `prospek_cerah_crm_v1`；云同步为整包 JSON upsert 到 `crm_state` 表（RLS 只允许本人）。
- **保持向后兼容**：改数据结构时必须兼容旧 localStorage/云端数据。

## 开发约定
- 保持单文件、无依赖、无构建；纯 ES5 风格 JS（var/function），与现有代码一致。
- `<!-- ARTIFACT-BODY-START/END -->` 标记之间是可独立发布的应用主体，PWA 相关标签放标记外的 `<head>` 里。
- 每次改动后用 Playwright + 本地 http 服务器冒烟测试（参考 scratchpad 的 smoke 脚本模式），检查：JS 零报错、手机宽度 390px 无横向溢出。
- 分支：`claude/prospek-cerah-crm-design-q7wys2`；提交信息用英文。
