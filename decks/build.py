#!/usr/bin/env python3
"""把 src/*.template.html 里的 {{img:name}} 占位符替换成内联 data URI，生成自包含的 HTML。

用法：  python3 decks/build.py
图片来源：decks/assets/img/<name>.jpg
"""
import base64
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parent
IMG_DIR = ROOT / "assets" / "img"
SRC_DIR = ROOT / "src"

TOKEN = re.compile(r"\{\{img:([a-z0-9\-]+)\}\}")


def main() -> int:
    templates = sorted(SRC_DIR.glob("*.template.html"))
    if not templates:
        print(f"没有找到模板：{SRC_DIR}/*.template.html", file=sys.stderr)
        return 1

    missing: set[str] = set()

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
        if missing:
            print(f"缺少图片：{', '.join(sorted(missing))}", file=sys.stderr)
            return 1
        out = ROOT / template.name.replace(".template", "")
        out.write_text(html, encoding="utf-8")
        print(f"{out.name:38s} {len(html) / 1024 / 1024:5.2f} MB  内联 {len(used)} 张图")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
