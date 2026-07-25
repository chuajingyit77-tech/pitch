#!/usr/bin/env python3
"""Render an approximate preview of the generated PPTX from recorded geometry.

LibreOffice cannot run in this sandbox, so the deck would otherwise ship
unseen. This replays the exact coordinates the generator used and draws them
with PIL, plus a geometry audit for off-slide, overlap and overflow faults.
"""
import json, os, textwrap
from PIL import Image, ImageDraw, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
REC = json.load(open(os.path.join(HERE, 'dist/deck-geometry.json')))
SW, SH, PPI = 13.333, 7.5, 110          # slide inches + render scale
PW, PH = int(SW * PPI), int(SH * PPI)

FONTS = {
    'Helvetica':      '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
    'Helvetica-Bold': '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf',
    'Times-Roman':    '/usr/share/fonts/truetype/dejavu/DejaVuSerif.ttf',
    'Times-Italic':   '/usr/share/fonts/truetype/dejavu/DejaVuSerif.ttf',
}
CJK_PATH = '/usr/share/fonts/truetype/wqy/wqy-zenhei.ttc'
_cache = {}
def has_cjk(s):
    return any('\u3400' <= ch <= '\u9fff' for ch in s)
def font(name, pt, cjk=False):
    path = CJK_PATH if cjk else FONTS.get(name, FONTS['Helvetica'])
    key = (path, int(pt))
    if key not in _cache:
        try:
            _cache[key] = ImageFont.truetype(path, max(6, int(pt)))
        except Exception as e:
            raise SystemExit(f'RENDERER FONT MISSING: {path} ({e}) — preview would be untrustworthy')
    return _cache[key]

def rgb(h, default=(0, 0, 0)):
    if not h:
        return default
    h = str(h).lstrip('#')
    if len(h) != 6:
        return default
    return tuple(int(h[i:i+2], 16) for i in (0, 2, 4))

def alpha_of(transparency):
    return 1 - (transparency or 0) / 100.0

def px(v):  # inches -> pixels
    return int(round(v * PPI))

def plain(t):
    """pptxgenjs text can be a string or a list of runs."""
    if isinstance(t, list):
        return ''.join(r.get('text', '') for r in t)
    return t if isinstance(t, str) else ''

slides = {}
for r in REC:
    slides.setdefault(r['slide'], []).append(r)

audit = []
os.makedirs(os.path.join(HERE, 'dist/slides'), exist_ok=True)

for n in sorted(slides):
    items = slides[n]
    bg = (255, 255, 255)
    for it in items:
        if it['kind'] == 'bg':
            bg = rgb(it['opt'].get('color'), (255, 255, 255))
    img = Image.new('RGB', (PW, PH), bg)
    d = ImageDraw.Draw(img)
    boxes = []

    for it in items:
        o = it.get('opt') or {}
        k = it['kind']
        if k == 'bg':
            continue
        x, y = o.get('x', 0), o.get('y', 0)
        w, h = o.get('w', 0), o.get('h', 0)

        if k == 'image':
            try:
                im = Image.open(os.path.join(HERE, o['path'])).convert('RGB')
                tw, th = px(w), px(h)
                sc = max(tw / im.width, th / im.height)
                im = im.resize((max(1, int(im.width * sc)), max(1, int(im.height * sc))))
                img.paste(im.crop((0, 0, tw, th)), (px(x), px(y)))
            except Exception as e:
                audit.append(f'slide {n}: image failed {o.get("path")} {e}')
            continue

        if k == 'shape':
            fill = o.get('fill') or {}
            col = rgb(fill.get('color'), None) if fill.get('color') else None
            a = alpha_of(fill.get('transparency', 0)) if col else 0
            line = o.get('line') or {}
            lc = rgb(line.get('color')) if line.get('color') and line.get('type') != 'none' else None
            x0, y0, x1, y1 = px(x), px(y), px(x + w), px(y + h)
            if h == 0:                      # a rule
                d.line([x0, y0, x1, y0], fill=lc or (120, 120, 120), width=1)
                continue
            # draw onto an RGBA layer, then composite so transparency is real
            layer = Image.new('RGBA', img.size, (0, 0, 0, 0))
            ld = ImageDraw.Draw(layer)
            fc = (col[0], col[1], col[2], int(255 * a)) if col else None
            oc = (lc[0], lc[1], lc[2], 255) if lc else None
            shp = (it.get('shape') or '').lower()
            if 'round' in shp:
                ld.rounded_rectangle([x0, y0, x1, y1], radius=max(2, px(o.get('rectRadius', .08))),
                                     fill=fc, outline=oc, width=1)
            elif 'ellipse' in shp:
                ld.ellipse([x0, y0, x1, y1], fill=fc, outline=oc, width=1)
            else:
                ld.rectangle([x0, y0, x1, y1], fill=fc, outline=oc, width=1)
            img = Image.alpha_composite(img.convert('RGBA'), layer).convert('RGB')
            d = ImageDraw.Draw(img)
            continue

        # ---- text ----
        txt = plain(it.get('text'))
        if not txt:
            continue
        size = o.get('fontSize', 12)
        cjk = has_cjk(txt)
        f = font(o.get('fontFace', 'Helvetica') + ('-Bold' if o.get('bold') else ''), size * PPI / 72.0, cjk)
        if o.get('fontFace') == 'Times-Italic' and not cjk:
            f = font('Times-Italic', size * PPI / 72.0)
        col = rgb(o.get('color'), (20, 20, 20))
        maxw = px(w) if w else PW
        lines = []
        for para in txt.split('\n'):
            cur = ''
            for word in para.split(' '):
                t = (cur + ' ' + word).strip()
                if d.textlength(t, font=f) <= maxw or not cur:
                    cur = t
                else:
                    lines.append(cur); cur = word
            lines.append(cur)
        lead = px((o.get('lineSpacing') or size * 1.22) / 72.0)
        ty = px(y)
        if o.get('valign') == 'middle' and h:
            ty = px(y) + (px(h) - len(lines) * lead) // 2
        for ln in lines:
            lw = d.textlength(ln, font=f)
            tx = px(x)
            if o.get('align') == 'center':
                tx = px(x) + (maxw - lw) // 2
            elif o.get('align') == 'right':
                tx = px(x) + maxw - lw
            d.text((tx, ty), ln, font=f, fill=col)
            ty += lead
        used_h = len(lines) * lead
        boxes.append((n, txt[:34], px(x), px(y), px(x) + maxw, px(y) + used_h))

        # audit: off-slide / overflow
        if x < -0.02 or y < -0.02 or x + w > SW + 0.02 or y + h > SH + 0.02:
            audit.append(f'slide {n}: OFF-SLIDE "{txt[:30]}" at x={x:.2f} y={y:.2f} w={w:.2f} h={h:.2f}')
        if h and used_h > px(h) + 4:
            audit.append(f'slide {n}: OVERFLOW "{txt[:30]}" needs {used_h/PPI:.2f}in, box is {h:.2f}in')
        if px(y) + used_h > PH + 2:
            audit.append(f'slide {n}: TEXT PAST BOTTOM "{txt[:30]}"')

    # audit: text-vs-text overlap
    for i in range(len(boxes)):
        for j in range(i + 1, len(boxes)):
            _, t1, ax0, ay0, ax1, ay1 = boxes[i]
            _, t2, bx0, by0, bx1, by1 = boxes[j]
            ox = min(ax1, bx1) - max(ax0, bx0)
            oy = min(ay1, by1) - max(ay0, by0)
            if ox > 12 and oy > 12:
                audit.append(f'slide {n}: OVERLAP "{t1[:22]}" ↔ "{t2[:22]}" ({ox}x{oy}px)')

    img.save(os.path.join(HERE, f'dist/slides/slide-{n:02d}.png'))

# contact sheet
cols, rows = 2, (len(slides) + 1) // 2
sheet = Image.new('RGB', (PW // 2 * cols + 30, PH // 2 * rows + 30), (235, 235, 235))
for i, n in enumerate(sorted(slides)):
    im = Image.open(os.path.join(HERE, f'dist/slides/slide-{n:02d}.png')).resize((PW // 2, PH // 2))
    sheet.paste(im, (10 + (i % cols) * (PW // 2 + 10), 10 + (i // cols) * (PH // 2 + 10)))
sheet.save(os.path.join(HERE, 'dist/deck-contact-sheet.png'))

print(f'rendered {len(slides)} slides')
if audit:
    print(f'--- {len(audit)} GEOMETRY ISSUES ---')
    for a in audit[:25]:
        print(' ✗', a)
else:
    print('--- geometry clean: nothing off-slide, overflowing or overlapping ---')
