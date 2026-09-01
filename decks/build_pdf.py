#!/usr/bin/env python3
"""生成两份 PDF：

  dist/三丰智能马来西亚合作提案-讨论稿.pdf
      封面 + 讨论议程 + 对内提案全文 + 附录（research/ 四篇底稿）
  dist/Smart-Factory-Malaysia-客户方案.pdf
      对外客户方案（中英双语）

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

AGENDA_HTML = """
<section class="slide" id="agenda">
  <div class="wrap">
    <div class="slide-head">
      <span class="slide-no">议程</span>
      <h2>这次讨论要定下来的五件事</h2>
      <span class="kicker">Internal Discussion</span>
    </div>
    <p class="lede">这份文件是我们<strong>内部讨论用的底稿</strong>，不是给三丰的最终版。建议 90 分钟：前 20 分钟对齐结论（先读第 01、08、12、14 节），后 70 分钟逐项把下面五个决策定下来。定不下来的，记录分歧和需要补的信息。</p>

    <div class="cards two">
      <div class="card"><span class="tag">决策 1 · 定位</span><h3>是否接受"零投入灯塔项目"路线</h3><p>由我方以本地总集成主体承接，三丰背靠背供货；<strong>不先要独家、不谈合资</strong>。如果不接受，替代方案是什么，代价是什么？</p></div>
      <div class="card"><span class="tag">决策 2 · 第一单从哪来</span><h3>目标客户池与具体线索</h3><p>建议次序：关丹产业园 / 柔佛中资工厂 → 本地传统制造（家具、铝材、食品、五金）→ 配电类小项目。<strong>各自手里现在有哪些能叫得出名字的线索？</strong>今天列出名单。</p></div>
      <div class="card"><span class="tag">决策 3 · MOU 的数字</span><h3>Phase 1 达标条件与 Phase 2 底线</h3><p>累计签约 ≥ RM 300 万、交付端毛利 ≥ 20%、回款 ≥ 90%、按期验收——这组数字是否接受？进入独家代理后，<strong>我们能承受的年度最低采购额上限</strong>是多少？</p></div>
      <div class="card"><span class="tag">决策 4 · 投入与分工</span><h3>钱、人、博士的服务怎么定</h3><p>启动资金 RM 180–230 万由谁出、比例多少；首批 5 人团队谁负责组建；数字化诊断服务是否独立收费、定价多少（建议 RM 2–5 万/次）。</p></div>
      <div class="card"><span class="tag">决策 5 · 怎么接触三丰</span><h3>走哪条线、谁去谈、什么时候</h3><p>执行口是<strong>进出口公司总经理</strong>，决策口是<strong>集团分管海外的副总</strong>。谁有渠道？先约哪一位？第一次会议目标日期定在哪一周？</p></div>
      <div class="card"><span class="tag">会前各自准备</span><h3>带来这次讨论的材料</h3><p>① 各自的客户 / 园区 / 政府线索清单；② 我方公司资料（名称、注册、团队、业绩）用于替换文中【待填】；③ 对三丰内部情况的了解：是否已有马来西亚代理、境外子公司在哪；④ 可投入资金区间。</p></div>
    </div>

    <div class="callout quiet" style="margin-top:1.15rem">
      <p><strong>讨论后 7 天内的动作：</strong>补齐【待填】内容并定稿对三丰的版本 → 按决策 2 的名单启动 3–5 家客户的免费诊断预约 → 按决策 5 发出第一次会议邀请。</p>
    </div>
  </div>
</section>
"""

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
    text = path.read_text(encoding="utf-8")
    return markdown.markdown(text, extensions=["tables", "fenced_code", "sane_lists"])


def split_deck(html: str):
    """把自包含 HTML 拆成 head 部分（title/link/style）、main 内容、footer。"""
    m_main = re.search(r"<main>(.*?)</main>", html, re.S)
    m_footer = re.search(r"<footer>(.*?)</footer>", html, re.S)
    head = html[: html.index("<div class=\"topbar\">")]
    # 页面脚本（ROI 计算器、进度条）位于 </footer> 之后，必须一并保留
    tail = html[m_footer.end():] if m_footer else ""
    return head, m_main.group(1), (m_footer.group(1) if m_footer else ""), tail


def build_discussion_pack() -> pathlib.Path:
    deck = (ROOT / "internal-sanfeng-cn.html").read_text(encoding="utf-8")
    head, main, footer, tail = split_deck(deck)

    # 封面文案改成"讨论稿"
    main = main.replace("合作提案 · 机密 · 仅供三丰智能内部讨论", "合作提案 · 内部讨论稿 · 机密")
    main = main.replace("<span>版本 v1 · 2026-09</span>", "<span>讨论稿 v2 · 2026-09</span>")

    # 在封面之后插入议程
    first_end = main.index("</section>") + len("</section>")
    main = main[:first_end] + AGENDA_HTML + main[first_end:]

    docs = sorted(RESEARCH.glob("0*.md"))
    appendix = ['<section class="appendix"><div class="wrap divider">',
                '<div class="eyebrow">附录 · 研究底稿</div>',
                '<h2>附录</h2>',
                '<p>以下四篇是提案背后的完整研究与测算。正文里每一个数字都能在这里找到出处或假设。</p>',
                '<ol>']
    for d in docs:
        title = d.read_text(encoding="utf-8").splitlines()[0].lstrip("# ").strip()
        appendix.append(f"<li>{title}</li>")
    appendix.append("</ol></div></section>")
    for d in docs:
        appendix.append(f'<article class="doc wrap">{md_to_html(d)}</article>')

    html = (
        head.replace("<title>三丰智能马来西亚提案</title>", "<title>三丰智能马来西亚合作提案 · 讨论稿</title>")
        + APPENDIX_CSS
        + "<main>" + main + "</main>"
        + "\n".join(appendix)
        + "<footer>" + footer + "</footer>" + tail
    )
    out = PRINT_DIR / "discussion-pack-cn.html"
    out.write_text(html, encoding="utf-8")
    return out


def build_customer_print() -> pathlib.Path:
    deck = (ROOT / "external-customer-bilingual.html").read_text(encoding="utf-8")
    head, main, footer, tail = split_deck(deck)
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

    render(pack, DIST / "三丰智能马来西亚合作提案-讨论稿.pdf",
           "三丰智能 × 马来西亚 · 合作提案内部讨论稿 · 机密")
    render(cust, DIST / "Smart-Factory-Malaysia-客户方案.pdf",
           "Smart Factory Malaysia · Proposal for discussion · 仅供讨论")
    return 0


if __name__ == "__main__":
    sys.exit(main())
