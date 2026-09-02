#!/usr/bin/env python3
"""把 src/*.template.html 里的 {{img:name}} 占位符替换成内联 data URI，生成自包含的 HTML。

用法：  python3 decks/build.py
图片来源：decks/assets/img/<name>.jpg
"""
import base64
import html as html_lib
import json
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parent
IMG_DIR = ROOT / "assets" / "img"
SRC_DIR = ROOT / "src"

TOKEN = re.compile(r"\{\{img:([a-z0-9\-]+)\}\}")
CO_TOKEN = re.compile(r"\{\{co:([a-z_]+)(?:\|([^}]*))?\}\}")
COMPANY_FILE = ROOT / "company.json"


def load_company() -> dict:
    """decks/company.json 里的公司资料；不存在则全部按未填处理。"""
    if not COMPANY_FILE.exists():
        return {}
    data = json.loads(COMPANY_FILE.read_text(encoding="utf-8"))
    data = {k: (v or "").strip() for k, v in data.items() if not k.startswith("_")}
    # 派生字段
    if data.get("whatsapp"):
        data["whatsapp_sep"] = " · WhatsApp "
    return data


def fill_company(html: str, company: dict) -> tuple[str, list[str]]:
    """把 {{co:field|fallback}} 换成资料；没填的显示为醒目的【待填：fallback】。"""
    missing: list[str] = []

    def sub(match: re.Match[str]) -> str:
        key, fallback = match.group(1), match.group(2) or ""
        value = company.get(key, "")
        if value:
            return html_lib.escape(value).replace("\n", "<br>")
        if not fallback:
            return ""
        missing.append(key)
        return f'<span class="fill">【待填：{html_lib.escape(fallback)}】</span>'

    return CO_TOKEN.sub(sub, html), missing


def main() -> int:
    templates = sorted(SRC_DIR.glob("*.template.html"))
    if not templates:
        print(f"没有找到模板：{SRC_DIR}/*.template.html", file=sys.stderr)
        return 1

    missing: set[str] = set()
    company = load_company()

    def inline(match: re.Match[str]) -> str:
        name = match.group(1)
        path = IMG_DIR / f"{name}.jpg"
        if not path.exists():
            missing.add(name)
            return ""
        return "data:image/jpeg;base64," + base64.b64encode(path.read_bytes()).decode("ascii")

    for template in templates:
        html = template.read_text(encoding="utf-8")
        used = sorted({m.group(1) for m in TOKEN.finditer(html)})
        html = TOKEN.sub(inline, html)
        html, unfilled = fill_company(html, company)
        if missing:
            print(f"缺少图片：{', '.join(sorted(missing))}", file=sys.stderr)
            return 1
        out = ROOT / template.name.replace(".template", "")
        out.write_text(html, encoding="utf-8")
        note = f"，未填公司字段：{', '.join(sorted(set(unfilled)))}" if unfilled else "，公司资料已填齐"
        print(f"{out.name:38s} {len(html) / 1024 / 1024:5.2f} MB  内联 {len(used)} 张图{note}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
