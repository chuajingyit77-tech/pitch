#!/usr/bin/env python3
"""Build play.html, the stand-alone full-screen page for kiosk screens and home-screen web apps
(an old iPad on a shelf), from index.html. index.html is written as an artifact page fragment
(no doctype/head/body), so this wraps it in a proper document with the iOS web-app tags.

Also writes version.json with a hash of every runtime file: screens that stay on reload into a new
build by themselves (see "New versions" in app.js), and only when something really changed.

Run after every change:  python3 idle-world-3d/tools/build_standalone.py
"""
import hashlib, json, os, re

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
src = open(os.path.join(ROOT, 'index.html'), encoding='utf-8').read()

# <title> and the font <link>s belong in <head>
title = re.search(r'<title>.*?</title>\n?', src).group(0)
links = re.findall(r'<link [^>]*>\n?', src)
body = src
for chunk in [title, *links]:
    body = body.replace(chunk, '', 1)

page = f"""<!doctype html>
<!-- Generated from index.html by tools/build_standalone.py. Edit index.html, then run the script. -->
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<meta name="apple-mobile-web-app-title" content="栖境">
<meta name="theme-color" content="#05070a">
<link rel="apple-touch-icon" href="./assets/icon-180.png">
<link rel="icon" href="./assets/icon-180.png">
{title.strip()}
{''.join(links).strip()}
</head>
<body>
{body.strip()}
</body>
</html>
"""
open(os.path.join(ROOT, 'play.html'), 'w', encoding='utf-8').write(page)

# version = hash of every runtime file (not the docs, the tools or the generated page itself)
h = hashlib.sha256()
for dp, dns, fns in os.walk(ROOT):
    dns[:] = sorted(d for d in dns if d not in {'tools', '.git', 'node_modules'})
    for fn in sorted(fns):
        rel = os.path.relpath(os.path.join(dp, fn), ROOT)
        if rel in {'play.html', 'version.json'} or fn.endswith(('.md', '.glb')):
            continue
        h.update(rel.encode())
        h.update(open(os.path.join(dp, fn), 'rb').read())
build = h.hexdigest()[:12]
open(os.path.join(ROOT, 'version.json'), 'w').write(json.dumps({'build': build}) + '\n')
print(f'play.html written ({len(page)} bytes), build {build}')
