#!/usr/bin/env python3
"""生成两份 PDF：

  dist/Sanfeng-Malaysia-Partnership-Proposal.pdf
      给合作方（三丰）看的合作提案 + 附录（01 能力地图、02 市场研判）
  dist/Smart-Factory-Malaysia-Customer.pdf
      对外客户方案（中英双语；交互计算器换成静态算例）

两份 PDF 都是给合作方看的对外版：只保留市场进入、行业、方案与合作路径。
去掉的内容：双方公司资料与联系方式、三丰财务数据、内部讨论议程、我方口径的损益与启动资金、
首次会议话术、附录 03（谈判策略）与 04（财务模型）。网页版保留完整内容。

页面为 1024×768（4:3），iPad 横屏全屏阅读正好一页。

先运行 build.py 生成自包含的 HTML，本脚本再把它们组装成打印稿，交给 print_pdf.js 渲染。

依赖：pip install markdown ；npm i playwright-core（NODE_PATH 指向其 node_modules）
"""
import os
import pathlib
import re
import subprocess
import sys

import markdown

ROOT = pathlib.Path(__file__).resolve().parent
REPO = ROOT.parent
DIST = REPO / "dist"
PRINT_DIR = ROOT / ".print"
RESEARCH = REPO / "research"

APPENDIX_CSS = """
<style>
.appendix{break-before:page}
.appendix .divider{padding:6rem 0 0}
.appendix .divider .eyebrow{margin-bottom:.8rem}
.appendix .divider h2{font-size:var(--f-display);margin-bottom:1rem}
.appendix .divider p{color:var(--ink-2);max-width:60ch}
.appendix .divider ol{color:var(--ink-2);padding-left:1.3rem;line-height:1.9;margin-top:1rem}
.doc{break-before:page;max-width:none}
.doc h1{font-size:var(--f-h2);border-bottom:1px solid var(--line);padding-bottom:.8rem;margin-bottom:1.2rem;
  background-image:linear-gradient(var(--grid) 1px,transparent 1px);background-size:100% 12px;background-position:0 -1px}
.doc h2{font-size:1.28rem;margin:1.8rem 0 .7rem;color:var(--ink)}
.doc h3{font-size:1.05rem;margin:1.3rem 0 .5rem;color:var(--ink)}
.doc p{margin:0 0 .7rem;color:var(--ink-2);max-width:78ch}
.doc ul,.doc ol{color:var(--ink-2);padding-left:1.3rem;margin:0 0 .8rem}
.doc li{margin-bottom:.25rem}
.doc blockquote{margin:0 0 1rem;border-left:3px solid var(--accent);background:var(--accent-soft);padding:.7rem 1rem;color:var(--accent-ink);border-radius:0 3px 3px 0}
.doc blockquote p{color:inherit;margin:0 0 .4rem}
.doc table{border-collapse:collapse;width:100%;font-size:var(--f-small);margin:0 0 1.1rem;border:1px solid var(--line);break-inside:auto}
.doc th,.doc td{padding:.5rem .7rem;text-align:left;border-bottom:1px solid var(--line);vertical-align:top}
.doc thead th{background:var(--surface-2);color:var(--ink-3);font-weight:600;font-family:"IBM Plex Mono",ui-monospace,monospace;font-size:var(--f-micro);letter-spacing:.06em;text-transform:uppercase}
.doc tr{break-inside:avoid}
.doc code{font-family:"IBM Plex Mono",ui-monospace,monospace;font-size:.85em;background:var(--surface-2);padding:.05em .3em;border-radius:2px}
.doc pre{background:var(--surface-2);border:1px solid var(--line);border-radius:3px;padding:.8rem 1rem;overflow-x:auto;font-size:.8rem;line-height:1.5;break-inside:avoid}
.doc pre code{background:none;padding:0}
.doc hr{border:0;border-top:1px solid var(--line);margin:1.6rem 0}
.doc a{color:var(--ink-2)}
.doc strong{color:var(--ink)}
</style>
"""


def md_to_html(path: pathlib.Path) -> str:
    text = strip_appendix_md(path.read_text(encoding="utf-8"))
    if path.name.startswith("01"):
        # 去掉"集团基本盘"（三丰公司资料与财务）一节，并把后续章节编号前移
        text = re.sub(r"## 1\. 集团基本盘.*?(?=## 2\.)", "", text, count=1, flags=re.S)
        text = re.sub(r"^(#{2,3}) (\d+)(\.\d+)?\. ", lambda m: f"{m.group(1)} {int(m.group(2)) - 1}{m.group(3) or ''}. ", text, flags=re.M)
    text = text.replace("销售话术", "销售材料").replace("（详见 03 号文件）", "")
    if path.name.startswith("01"):
        text = drop_asset_column(text)
    return markdown.markdown(text, extensions=["tables", "fenced_code", "sane_lists"])


def drop_asset_column(md: str) -> str:
    """去掉 01 号文件里的"图片素材"列和"图片素材："行（内部素材文件名，对外无意义）。"""
    out, in_asset_table = [], False
    for line in md.splitlines():
        if line.startswith("图片素材："):
            continue
        if line.startswith("|"):
            cells = line.strip().strip("|").split("|")
            if "图片素材" in line and not in_asset_table:
                in_asset_table = True
            if in_asset_table:
                line = "| " + " | ".join(c.strip() for c in cells[:-1]) + " |"
        else:
            in_asset_table = False
        out.append(line)
    return "\n".join(out)


def split_deck(html: str):
    """把自包含 HTML 拆成 head 部分（title/link/style）、main 内容、footer。"""
    m_main = re.search(r"<main>(.*?)</main>", html, re.S)
    m_footer = re.search(r"<footer>(.*?)</footer>", html, re.S)
    head = html[: html.index("<div class=\"topbar\">")]
    # 页面脚本（ROI 计算器、进度条）位于 </footer> 之后，必须一并保留
    tail = html[m_footer.end():] if m_footer else ""
    return head, m_main.group(1), (m_footer.group(1) if m_footer else ""), tail


FILL_SPAN = re.compile(r'<span class="fill">【待填：[^】]*】</span>')


def strip_common(main: str) -> str:
    """PDF 为"市场版"：去掉未填的公司占位信息。"""
    main = FILL_SPAN.sub("", main)
    main = main.replace('<div class="who"></div>', '<div class="who">我方马来西亚公司</div>')
    return main


def strip_internal_company(main: str) -> str:
    """对内提案：去掉双方公司资料，保留市场与合作路径内容。"""
    main = strip_common(main)
    # 封面：不写提交方 / 收件方
    main = re.sub(r"<span>提交方：.*?</span>\s*<span>致：.*?</span>",
                  "<span>三丰智能 × 马来西亚 · 市场进入与合作路径</span>", main, count=1, flags=re.S)
    main = main.replace("合作提案 · 机密 · 仅供三丰智能内部讨论", "合作提案 · 机密")
    main = main.replace("<span>版本 v1 · 2026-09</span>", "<span>v2 · 2026-09</span>")
    # 内部内容整节删除：11 三年业务规划（我方口径，含启动资金）、16 首次会议话术
    main = re.sub(r'<section class="slide" id="s12">.*?</section>\s*', "", main, count=1, flags=re.S)
    main = re.sub(r'<section class="slide" id="s17">.*?</section>\s*', "", main, count=1, flags=re.S)
    # 12 三丰口径：标题不再指向已删除的表
    main = main.replace("<h2>同一份计划，三丰口径</h2>", "<h2>这套方案对三丰意味着什么</h2>")
    main = main.replace("这是整份提案唯一需要贵司财务口径确认的一张表。", "这是整份提案中需要贵司按自身财务口径确认的一张表。")
    # 偏内部语气的句子改为面向合作方
    main = main.replace("争取首个项目的账期支持（20/50/30）——这不花三丰的钱，只是节奏。",
                        "建议首个项目采用 20/50/30 的付款节奏，以降低双方的资金占用。")
    main = re.sub(r"<p><strong>\"自动升级\"这四个字必须写进 MOU。</strong>.*?</p>",
                  "<p><strong>建议把\"达标后自动升级\"写进 MOU。</strong>这让我方敢于在 Phase 1 全力投入，也让贵司在验证完成后无需再谈一轮。</p>",
                  main, count=1, flags=re.S)
    main = re.sub(r'<p class="src" style="margin-top:\.9rem">注意：本表中标注"我方"的风险共 5 项.*?</p>', "", main, count=1, flags=re.S)
    # 02 为什么是现在：去掉三丰财务与规模数据块及来源行，措辞改为行业通用
    start = main.find('<div class="stats" style="--n:4">')
    if start != -1:
        end = main.find('<div class="cards two"', start)
        main = main[:start] + main[end:]
    main = re.sub(r'<p class="src" style="margin-top:1rem">数据来源：三丰智能 2025 年度报告摘要.*?</p>', "", main, count=1, flags=re.S)
    main = main.replace("在当前资产负债表状况下，任何", "对装备企业而言，任何")
    # 12 三丰口径：去掉引用其营收规模的句子
    main = re.sub(r"相对贵司 2025 年 17\.69 亿元的营收规模，这是约 3\.5% 的增量——而且是结构性毛利更高的增量。", "", main, count=1)
    # 18 下一步：去掉联系方式卡片
    main = re.sub(r'<div class="card">\s*<span class="tag">联系方式</span>.*?</div>\s*', "", main, count=1, flags=re.S)
    return renumber_slides(main)


def renumber_slides(main: str) -> str:
    n = 0

    def sub(match: re.Match[str]) -> str:
        nonlocal n
        n += 1
        return f'<span class="slide-no">{n:02d}</span>'

    return re.sub(r'<span class="slide-no">\d\d</span>', sub, main)


def strip_customer_company(main: str) -> str:
    """客户方案：去掉"我们是谁"整节、封面署名和联系方式。"""
    main = strip_common(main)
    # 封面署名
    main = re.sub(r'<div class="cover-meta">.*?</div>', '<div class="cover-meta"><span>Smart Factory Malaysia · 2026</span></div>',
                  main, count=1, flags=re.S)
    # 02 Who you are buying from
    main = re.sub(r'<section class="slide">\s*<div class="wrap">\s*<div class="slide-head"><span class="slide-no">02</span>.*?</section>',
                  "", main, count=1, flags=re.S)
    # 结尾联系方式
    main = re.sub(r'<div class="cover-meta" style="border-top-color:var\(--line\)">.*?</div>', "", main, count=1, flags=re.S)
    return renumber_slides(main)


PDF_MD_STRIPS = [
    # 03：谈判逻辑里引用的三丰财务数字
    (r"我 2025 年亏 1\.86 亿、刚计提商誉减值、还在处理境外子公司税务问题，现在出海投钱？", "现在出海投钱？"),
    (r"\*\*核心洞察\*\*：三丰 2025 年营收 17\.69 亿（−8\.69%）、归母净利 −1\.86 亿，主因是国内价格战导致毛利下滑、项目周期延长、商誉减值。",
     "**核心洞察**：国内价格战导致毛利下滑、项目周期延长。"),
    # 04：三丰口径段落里的营收对比
    (r"对一家 2025 年营收 17\.69 亿、正在为毛利率发愁的公司，这相当于用零成本换来约 \*\*3\.5% 的营收增量\*\*，且是\*\*结构性更高毛利的增量\*\*。", ""),
]


def strip_appendix_md(md: str) -> str:
    for pat, rep in PDF_MD_STRIPS:
        md = re.sub(pat, rep, md)
    return md


def strip_appendix_profile(md_html: str, doc_name: str) -> str:
    """附录 01 去掉"集团基本盘"（三丰公司资料与财务）一节。"""
    return md_html


def build_discussion_pack() -> pathlib.Path:
    deck = (ROOT / "internal-sanfeng-cn.html").read_text(encoding="utf-8")
    head, main, footer, tail = split_deck(deck)

    main = strip_internal_company(main)

    # 附录只放能力地图与市场研判；03 谈判策略、04 财务模型属内部资料，不进合作方版本
    docs = [RESEARCH / "01-sanfeng-capability-map.md", RESEARCH / "02-malaysia-market.md"]
    appendix = ['<section class="appendix"><div class="wrap divider">',
                '<div class="eyebrow">附录 · 研究底稿</div>',
                '<h2>附录</h2>',
                '<p>以下两篇是提案背后的研究底稿。正文里的市场与政策数字都能在这里找到出处。</p>',
                '<ol>']
    for d in docs:
        title = d.read_text(encoding="utf-8").splitlines()[0].lstrip("# ").strip()
        appendix.append(f"<li>{title}</li>")
    appendix.append("</ol></div></section>")
    for d in docs:
        appendix.append(f'<article class="doc wrap">{strip_appendix_profile(md_to_html(d), d.name)}</article>')

    html = (
        head.replace("<title>三丰智能马来西亚提案</title>", "<title>三丰智能马来西亚合作提案</title>")
        + APPENDIX_CSS
        + "<main>" + main + "</main>"
        + "\n".join(appendix)
        + "<footer>" + footer.replace("机密文件 · 仅供内部讨论 · v1 · 2026-09", "机密文件 · v2 · 2026-09") + "</footer>" + tail
    )
    out = PRINT_DIR / "partnership-proposal-cn.html"
    out.write_text(html, encoding="utf-8")
    return out


LEVY = 1850        # RM / 外劳 / 年（西马制造业）
ANCILLARY = 1500   # RM / 外劳 / 年：招募、宿舍、体检、中介（假设）
TAX = 0.24
ACA_CAP = 10_000_000

ROI_CASES = [
    # 名称(EN, CN), 投资, 替代工人, 其中外劳, 月综合成本, 年产值, 不良改善
    ("Robot cell (palletising / grinding)", "单站机器人工作站（码垛 / 打磨）", 450_000, 6, 5, 2_200, 8_000_000, 0.010),
    ("Conveying line (footwear / aluminium / appliance)", "标准输送线（制鞋 / 铝材 / 小家电）", 1_300_000, 12, 8, 2_200, 20_000_000, 0.015),
    ("AMR fleet, electronics plant", "AMR 车间物流（电子厂）", 2_500_000, 18, 12, 2_400, 60_000_000, 0.005),
    ("High-bay warehouse (stacker cranes + WMS)", "立体库（堆垛机 + WMS）", 6_000_000, 30, 22, 2_300, 80_000_000, 0.008),
]


def roi(capex, workers, foreign, wage, output, scrap):
    """与网页版计算器完全相同的算法。"""
    s_wage = workers * wage * 12
    s_levy = foreign * LEVY
    s_rec = foreign * ANCILLARY
    s_scrap = output * scrap
    benefit = s_wage + s_levy + s_rec + s_scrap
    shield = min(capex, ACA_CAP) * TAX
    net = capex - shield
    return dict(wage=s_wage, levy=s_levy, rec=s_rec, scrap=s_scrap, benefit=benefit,
                shield=shield, net=net, payback=net / benefit)


def rm(v):
    return f"RM {v:,.0f}"


def static_roi_section() -> str:
    rows = []
    for en, cn, capex, workers, foreign, wage, output, scrap in ROI_CASES:
        r = roi(capex, workers, foreign, wage, output, scrap)
        rows.append(
            f"<tr><td><strong>{en}</strong><span class=\"cn\">{cn}</span></td>"
            f"<td class=\"num\">{rm(capex)}</td>"
            f"<td class=\"num\">{workers} <span style=\"color:var(--ink-3)\">({foreign} foreign 外劳)</span></td>"
            f"<td class=\"num\">{rm(r['benefit'])}</td>"
            f"<td class=\"num\">− {rm(r['shield'])}</td>"
            f"<td class=\"num\">{rm(r['net'])}</td>"
            f"<td class=\"num\"><strong>{r['payback']:.1f} yrs 年</strong></td></tr>"
        )
    ex = ROI_CASES[1]
    e = roi(*ex[2:])
    return f"""
<section class="slide" id="calc">
  <div class="wrap">
    <div class="slide-head"><span class="slide-no">04</span><h2>What it is worth on your line<span class="cn">在你的产线上值多少钱</span></h2></div>
    <p class="lede">Four typical projects, one set of arithmetic. Bring your own headcount and wage figures and we run it live on site.
      <span class="cn">四个典型项目，同一套算法。带上你的人数和工资数据，我们现场帮你算。</span></p>

    <div class="tablewrap">
      <table>
        <thead><tr>
          <th>Project<br>项目</th><th class="num">Investment<br>投资</th><th class="num">Workers replaced<br>替代工人</th>
          <th class="num">Annual benefit<br>年化收益</th><th class="num">Automation CA shield<br>税盾</th>
          <th class="num">Net investment<br>有效投资</th><th class="num">Payback<br>回收期</th>
        </tr></thead>
        <tbody>{''.join(rows)}</tbody>
      </table>
    </div>

    <div class="cards two" style="margin-top:1rem">
      <div class="card">
        <span class="tag">Worked example 完整算例 · {ex[0]}</span>
        <div class="tablewrap" style="border:0"><table style="min-width:0">
          <tbody>
            <tr><td>Wages: {ex[3]} workers × RM {ex[5]:,}/month × 12 <span class="cn">工资：{ex[3]} 人 × RM {ex[5]:,}/月 × 12</span></td><td class="num">{rm(e['wage'])}</td></tr>
            <tr><td>Foreign worker levy: {ex[4]} × RM {LEVY:,} <span class="cn">外劳征费：{ex[4]} 人 × RM {LEVY:,}</span></td><td class="num">{rm(e['levy'])}</td></tr>
            <tr><td>Recruitment, hostel, medical: {ex[4]} × RM {ANCILLARY:,} <span class="cn">招募、宿舍、体检：{ex[4]} 人 × RM {ANCILLARY:,}（假设）</span></td><td class="num">{rm(e['rec'])}</td></tr>
            <tr><td>Scrap &amp; rework: RM {ex[6]/1e6:.0f}m output × {ex[7]*100:.1f}% <span class="cn">不良与返工：年产值 RM {ex[6]/1e6:.0f}m × {ex[7]*100:.1f}%</span></td><td class="num">{rm(e['scrap'])}</td></tr>
            <tr class="total"><td>Annual benefit <span class="cn">年化收益合计</span></td><td class="num">{rm(e['benefit'])}</td></tr>
            <tr><td>Investment <span class="cn">设备投资</span></td><td class="num">{rm(ex[2])}</td></tr>
            <tr><td>Automation CA: extra 100% × 24% tax <span class="cn">自动化资本减免：额外 100% × 24% 所得税</span></td><td class="num">− {rm(e['shield'])}</td></tr>
            <tr class="total"><td>Effective investment ÷ annual benefit <span class="cn">有效投资 ÷ 年化收益</span></td><td class="num"><strong>{e['payback']:.1f} years 年</strong></td></tr>
          </tbody>
        </table></div>
      </div>
      <div class="card">
        <span class="tag">What is and is not counted 算了什么、没算什么</span>
        <p><strong>Counted:</strong> fully loaded wages, the annual levy, recruitment and hostel costs per foreign worker, and a modest scrap/rework improvement on the line's output. Tax shield assumes the 24% corporate rate and the 200% Automation Capital Allowance on the first RM 10 million.
          <span class="cn"><strong>已计入：</strong>综合工资、年度外劳征费、每名外劳的招募与宿舍成本、产线产值上小幅的不良与返工改善。税盾按 24% 企业所得税率和首 1,000 万令吉 200% 自动化资本减免计算。</span></p>
        <p style="margin-top:.6rem"><strong>Not counted:</strong> floor space released, overtime and shift premiums, output gains from a faster line, lower injury and insurance costs, and the multi-tier levy increases due from 2026. All of these make the case better, not worse.
          <span class="cn"><strong>未计入：</strong>释放的厂房面积、加班与夜班溢价、产线提速带来的增产、工伤与保险成本下降、2026 年起的多层次征费加价。这些只会让账更好看，不会更差。</span></p>
        <p style="margin-top:.6rem"><strong>Live version:</strong> the web edition of this proposal has an interactive calculator — we can change every number with you in the meeting.
          <span class="cn"><strong>可交互版本：</strong>本方案的网页版带可修改的计算器，开会时可以当场按你的数字重算。</span></p>
      </div>
    </div>

    <p class="src" style="margin-top:.8rem">Automation CA is not automatic: the applicant must be incorporated and tax-resident in Malaysia, have carried on manufacturing or services activity for at least 36 months, obtain MIDA approval in advance and pass SIRIM technical verification. Figures are estimates for discussion, not tax advice.
      <span class="cn">自动化资本减免并非自动享有：申请公司须在马来西亚注册并为税务居民、从事制造或服务业满 36 个月、事先取得 MIDA 批准并通过 SIRIM 技术核验。本页测算仅供讨论，不构成税务意见。</span></p>
  </div>
</section>
"""


def build_customer_print() -> pathlib.Path:
    deck = (ROOT / "external-customer-bilingual.html").read_text(encoding="utf-8")
    head, main, footer, tail = split_deck(deck)
    # PDF 里没有交互，把计算器换成静态算例；再去掉公司资料
    main = re.sub(r'<section class="slide" id="calc">.*?</section>', static_roi_section(), main, count=1, flags=re.S)
    main = strip_customer_company(main)
    html = head + "<main>" + main + "</main><footer>" + footer + "</footer>" + tail
    out = PRINT_DIR / "customer-bilingual.html"
    out.write_text(html, encoding="utf-8")
    return out


def render(html_path: pathlib.Path, pdf_path: pathlib.Path, footer_left: str) -> None:
    cmd = ["node", str(ROOT / "print_pdf.js"), str(html_path), str(pdf_path), footer_left]
    subprocess.run(cmd, check=True, cwd=REPO)


def main() -> int:
    PRINT_DIR.mkdir(exist_ok=True)
    DIST.mkdir(exist_ok=True)

    pack = build_discussion_pack()
    cust = build_customer_print()

    render(pack, DIST / "Sanfeng-Malaysia-Partnership-Proposal.pdf",
           "三丰智能 × 马来西亚 · 合作提案 · 机密")
    render(cust, DIST / "Smart-Factory-Malaysia-Customer.pdf",
           "Smart Factory Malaysia · Proposal for discussion · 仅供讨论")
    return 0


if __name__ == "__main__":
    sys.exit(main())
