#!/usr/bin/env python3
"""One-page A4 executive leave-behind for the AFFIN Bank programme.

Story: gain-share commercial model (RM 0 until it works), Track A eight
existing cost lines, Track B five credit-loss modules, the compounding
"one flight, thirteen returns" argument, credibility, and the ask.
"""
import os
from reportlab.lib.pagesizes import A4
from reportlab.lib.colors import HexColor
from reportlab.lib.utils import ImageReader
from reportlab.pdfgen import canvas
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.pdfmetrics import stringWidth
from reportlab.pdfbase.cidfonts import UnicodeCIDFont

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, 'dist', 'AFFIN-Executive-Onepager.pdf')
os.makedirs(os.path.dirname(OUT), exist_ok=True)

W, H = A4  # 595.28 x 841.89

# ---------------------------------------------------------------- palette
INK   = HexColor('#06090F')   # near-black ink
INK2  = HexColor('#111823')   # raised dark panel
PAPER = HexColor('#F6F5F1')   # warm paper
CARD  = HexColor('#FFFFFF')
LINE  = HexColor('#DCD9D0')
BODY  = HexColor('#3C444E')
MUTE  = HexColor('#858D96')
CYAN  = HexColor('#0B8892')   # signal cyan
CYANL = HexColor('#4FC8CF')   # cyan on dark
GOLD  = HexColor('#8A6620')   # money gold — money / % figures ONLY
GOLDL = HexColor('#D9AE63')   # gold on dark
GREEN = HexColor('#2E8757')
AMBER = HexColor('#A9701B')
RED   = HexColor('#B8402D')
WHITE = HexColor('#FFFFFF')
PALE  = HexColor('#C9D1DA')

SER, SERB, SERI = 'Times-Roman', 'Times-Bold', 'Times-Italic'
SANS, SANSB = 'Helvetica', 'Helvetica-Bold'
MONO, MONOB = 'Courier', 'Courier-Bold'
try:
    pdfmetrics.registerFont(UnicodeCIDFont('STSong-Light'))
    CJK = 'STSong-Light'
except Exception:
    CJK = None

MX = 34.0                     # side margin (> 30pt requirement)
IW = W - 2 * MX               # inner width

c = canvas.Canvas(OUT, pagesize=A4)
c.setTitle('AFFIN Bank — Cost Reduction & Credit-Loss Prevention (Executive Summary)')
c.setAuthor('Prospek Cerah Inovasi IT Sdn. Bhd.')
c.setSubject('Gain-share programme summary — RM 0 until it works')


# ---------------------------------------------------------------- helpers
def y(top):
    """Convert a from-the-top coordinate into reportlab's bottom-origin."""
    return H - top


def wrap(text, font, size, maxw):
    lines, cur = [], ''
    for word in text.split():
        t = (cur + ' ' + word).strip()
        if stringWidth(t, font, size) <= maxw:
            cur = t
        else:
            if cur:
                lines.append(cur)
            cur = word
    if cur:
        lines.append(cur)
    return lines


def draw_lines(x, top, text, font, size, color, maxw, leading):
    c.setFont(font, size)
    c.setFillColor(color)
    t = top
    for ln in wrap(text, font, size, maxw):
        c.drawString(x, y(t), ln)
        t += leading
    return t


def rrect(x, top, w, h, r=5, fill=None, stroke=None, sw=0.8, alpha=None):
    c.saveState()
    if alpha is not None:
        c.setFillAlpha(alpha)
    if fill:
        c.setFillColor(fill)
    if stroke:
        c.setStrokeColor(stroke)
        c.setLineWidth(sw)
    c.roundRect(x, y(top) - h, w, h, r, fill=1 if fill else 0, stroke=1 if stroke else 0)
    c.restoreState()


def pill(x, top, text, font, size, fg, bg, padx=6, h=12, alpha=1.0):
    w = stringWidth(text, font, size) + 2 * padx
    c.saveState()
    c.setFillColor(bg)
    c.setFillAlpha(alpha)
    c.roundRect(x, y(top) - h, w, h, 2.5, fill=1, stroke=0)
    c.restoreState()
    c.setFillColor(fg)
    c.setFont(font, size)
    c.drawString(x + padx, y(top) - h + (h - size) / 2 + 1.2, text)
    return w


def tracking(x, baseline_top, text, font, size, color, extra=1.7):
    """Letter-spaced small caps style label."""
    c.setFont(font, size)
    c.setFillColor(color)
    cx = x
    for ch in text:
        c.drawString(cx, y(baseline_top), ch)
        cx += stringWidth(ch, font, size) + extra
    return cx - x


# ---------------------------------------------------------- paper ground
c.setFillColor(PAPER)
c.rect(0, 0, W, H, fill=1, stroke=0)

# ================================================================ 1. HEADER
BAND = 112.0
c.saveState()
p = c.beginPath()
p.rect(0, y(BAND), W, BAND)
c.clipPath(p, stroke=0)
try:
    img = ImageReader(os.path.join(HERE, 'assets/img/hero_b1.jpg'))
    iw, ih = img.getSize()
    s = max(W / iw, BAND / ih) * 1.02
    dw, dh = iw * s, ih * s
    c.drawImage(img, (W - dw) / 2, y(BAND) - (dh - BAND) * 0.42, width=dw, height=dh, mask='auto')
except Exception:
    c.setFillColor(INK)
    c.rect(0, y(BAND), W, BAND, fill=1, stroke=0)
c.restoreState()

# dark scrim: flat + left-weighted gradient for type contrast
c.saveState()
c.setFillColor(INK)
c.setFillAlpha(0.66)
c.rect(0, y(BAND), W, BAND, fill=1, stroke=0)
c.restoreState()
# top strip darkened so the small eyebrow type holds contrast across the width
c.saveState()
for i in range(14):
    c.setFillColor(INK)
    c.setFillAlpha(0.030 * (1 - i / 14.0))
    c.rect(0, y(37) + i * 2.4, W, 2.6, fill=1, stroke=0)
c.restoreState()
c.saveState()
steps = 46
for i in range(steps):
    c.setFillColor(INK)
    c.setFillAlpha(0.42 * (1 - i / steps) ** 1.25)
    c.rect(i * W / steps, y(BAND), W / steps + 0.7, BAND, fill=1, stroke=0)
c.restoreState()
# hairline under band
c.setFillColor(CYAN)
c.rect(0, y(BAND) - 2.2, W, 2.2, fill=1, stroke=0)

tracking(MX, 28, 'CONFIDENTIAL PROGRAMME SUMMARY', MONOB, 6.6, CYANL, 1.9)
c.setFillColor(HexColor('#98A3B0'))
c.setFont(MONO, 6.6)
c.drawRightString(W - MX, y(28), 'AFFIN BANK BERHAD  ·  JULY 2026')

c.setFillColor(WHITE)
c.setFont(SERB, 21.5)
c.drawString(MX, y(53), 'You are already paying for this.')
c.setFillColor(GOLDL)
c.setFont(SERB, 21.5)
c.drawString(MX, y(76), 'You are just paying it to inefficiency.')

c.setFillColor(PALE)
c.setFont(SANS, 8.6)
c.drawString(MX, y(95), 'Thirteen modules. One capture layer. Paid only out of savings AFFIN itself has verified.')

top = BAND + 12.0

# ================================================ 2. COMMERCIAL MODEL PANEL
PANEL_H = 126.0
rrect(MX, top, IW, PANEL_H, 6, fill=INK2)
# gold rail on the left edge of the panel
c.saveState()
c.setFillColor(GOLD)
c.roundRect(MX, y(top) - PANEL_H, 3.4, PANEL_H, 1.5, fill=1, stroke=0)
c.rect(MX + 1.6, y(top) - PANEL_H, 1.8, PANEL_H, fill=1, stroke=0)
c.restoreState()

px = MX + 20
tracking(px, top + 19, 'THE COMMERCIAL MODEL  ·  GAIN-SHARE', MONOB, 6.5, CYANL, 1.6)

c.setFillColor(WHITE)
c.setFont(SERB, 27)
c.drawString(px, y(top + 50), 'RM 0 until it works.')
c.setFillColor(GOLDL)
c.setFont(SANSB, 10.2)
c.drawString(px, y(top + 68), 'No verified saving. No fee. Ever.')
draw_lines(px, top + 82, 'Zero financial risk to the bank. AFFIN commits people and data — not budget — until a saving has been booked.',
           SANS, 7.5, HexColor('#98A3B0'), 232, 10)
c.setStrokeColor(HexColor('#2A3441'))
c.setLineWidth(0.7)
c.line(px, y(top + 102), px + 232, y(top + 102))
c.setFillColor(CYANL)
c.setFont(MONOB, 7.0)
c.drawString(px, y(top + 114), '00  \u00bb  01  \u00bb  02')
c.setFillColor(HexColor('#98A3B0'))
c.setFont(SANS, 7.3)
c.drawString(px + 92, y(top + 114), 'AFFIN can stop after any phase.')

# phase ladder on the right
qx = MX + 274
qw = IW - 274 - 20
phases = [
    ('00', 'Diagnostic — at OUR cost', 'AFFIN pays RM 0. 4–6 weeks. Delivers a jointly-signed Verified Savings Baseline.', CYANL),
    ('01', '90-day pilot — one capped fee', 'Credited back in full against Phase 02. Nothing else is invoiced.', GOLDL),
    ('02', 'Scale — paid only from savings', "Verified by AFFIN's own finance team. No verified saving in a period, no fee for that period.", WHITE),
]
ty = top + 13
for code, head, sub, col in phases:
    c.setFillColor(col)
    c.setFont(MONOB, 12)
    c.drawString(qx, y(ty + 9.5), code)
    c.setFillColor(WHITE)
    c.setFont(SANSB, 8.4)
    c.drawString(qx + 27, y(ty + 9), head)
    nxt = draw_lines(qx + 27, ty + 20, sub, SANS, 7.2, HexColor('#98A3B0'), qw - 27, 9.2)
    ty = nxt + 5.5
top += PANEL_H + 8

# guarantee strip
G_H = 27.0
rrect(MX, top, IW, G_H, 4, fill=HexColor('#E8F1EB'), stroke=GREEN, sw=0.9)
c.setFillColor(GREEN)
c.circle(MX + 16, y(top + G_H / 2), 3.6, fill=1, stroke=0)
c.setFillColor(GREEN)
c.setFont(SANSB, 8.4)
c.drawString(MX + 27, y(top + 17.5), 'DAY-90 GUARANTEE')
c.setFillColor(INK)
c.setFont(SANS, 8.4)
c.drawString(MX + 128, y(top + 17.5),
             "If AFFIN's own measurement shows verified savings below the pilot cost, we absorb the shortfall.")
top += G_H + 13

# ============================================================ 3. TRACK A
A_ROWS = [
    ('A1', 'Building inspection',   '50–60%', 'manual rope/ladder inspection, patchy records'),
    ('A2', 'Branch energy',         '18–25%', 'HVAC running into empty nights'),
    ('A3', 'Maintenance',           '20–25%', 'breakdowns cost 3–5x planned work'),
    ('A4', 'Branch network',        '10–15%', 'overlapping catchments, prime rent on quiet sites'),
    ('A5', 'Security & guarding',   '20–30%', 'night shifts are a third of the bill'),
    ('A6', 'ATM operations',        '~60%',   'checked twice a day; skimmers invisible to that'),
    ('A7', 'Collateral valuation',  '30–40%', '3–5 days and a travel bill per revaluation'),
    ('A8', 'Insurance premium',     '8–15%',  'priced on industry average — no data to argue with'),
]
A_H = 148.0
rrect(MX, top, IW, A_H, 5, fill=CARD, stroke=LINE, sw=0.8)
tracking(MX + 16, top + 19, 'TRACK A  ·  EIGHT EXISTING COST LINES', MONOB, 6.5, GOLD, 1.5)
c.setFillColor(MUTE)
c.setFont(SANS, 6.8)
c.drawRightString(W - MX - 16, y(top + 19), 'reduction band on the bank’s current spend')
c.setStrokeColor(LINE)
c.setLineWidth(0.7)
c.line(MX + 16, y(top + 26), W - MX - 16, y(top + 26))

colw = (IW - 32 - 20) / 2
row_h = 22.5
for i, (code, name, pct, why) in enumerate(A_ROWS):
    cx = MX + 16 + (i // 4) * (colw + 20)
    ry = top + 32 + (i % 4) * row_h
    c.setFillColor(GOLD)
    c.setFont(MONOB, 7.2)
    c.drawString(cx, y(ry + 8), code)
    c.setFillColor(INK)
    c.setFont(SANSB, 8.6)
    c.drawString(cx + 22, y(ry + 8), name)
    c.setFillColor(GOLD)
    c.setFont(SANSB, 10.4)
    c.drawRightString(cx + colw, y(ry + 8), pct)
    c.setFillColor(MUTE)
    c.setFont(SANS, 6.9)
    c.drawString(cx + 22, y(ry + 17), why)
    if i % 4 != 3:
        c.setStrokeColor(HexColor('#EDEBE4'))
        c.setLineWidth(0.6)
        c.line(cx, y(ry + 21.5), cx + colw, y(ry + 21.5))

# A8 insight callout inside the card
ins_top = top + A_H - 25
c.saveState()
c.setFillColor(CYAN)
c.setFillAlpha(0.07)
c.roundRect(MX + 16, y(ins_top) - 19, IW - 32, 19, 3, fill=1, stroke=0)
c.restoreState()
c.setFillColor(CYAN)
c.setFont(MONOB, 6.8)
c.drawString(MX + 24, y(ins_top + 12.5), 'A8')
ins_text = ('works by feeding the risk data captured in A1–A7 to the insurer as negotiating evidence '
            '— the bank stops being priced on an average it cannot dispute.')
ins_x = MX + 42
ins_max = (W - MX - 24) - ins_x
ins_size = 7.6
while stringWidth(ins_text, SANS, ins_size) > ins_max and ins_size > 6.4:
    ins_size -= 0.1
c.setFillColor(BODY)
c.setFont(SANS, ins_size)
c.drawString(ins_x, y(ins_top + 12.5), ins_text)
top += A_H + 11

# ================================= 4. TRACK B  +  COMPOUNDING ARGUMENT
ROW_H = 120.0
bw = IW * 0.355
cwid = IW - bw - 12

# --- Track B card
rrect(MX, top, bw, ROW_H, 5, fill=CARD, stroke=LINE, sw=0.8)
tracking(MX + 14, top + 19, 'TRACK B  ·  CREDIT LOSS', MONOB, 6.5, CYAN, 1.5)
c.setStrokeColor(LINE)
c.setLineWidth(0.7)
c.line(MX + 14, y(top + 26), MX + bw - 14, y(top + 26))
B_ROWS = [
    ('B1', 'Construction loan early warning', 'stall or diversion surfaced 3–6 months earlier'),
    ('B2', 'NPL disposal', None),
    ('B3', 'Collateral monitoring', None),
    ('B4', 'Capital optimisation', None),
    ('B5', 'Fraud detection', None),
]
by = top + 34
for code, name, sub in B_ROWS:
    c.setFillColor(CYAN)
    c.setFont(MONOB, 7.2)
    c.drawString(MX + 14, y(by), code)
    c.setFillColor(INK)
    c.setFont(SANSB, 8.2)
    c.drawString(MX + 36, y(by), name)
    by += 10.5
    if sub:
        c.setFillColor(MUTE)
        c.setFont(SANS, 6.9)
        c.drawString(MX + 36, y(by), sub)
        by += 11.0
    else:
        by += 4.0
c.setStrokeColor(HexColor('#EDEBE4'))
c.setLineWidth(0.6)
c.line(MX + 14, y(top + ROW_H - 15), MX + bw - 14, y(top + ROW_H - 15))
c.setFillColor(MUTE)
c.setFont(SANS, 6.9)
c.drawString(MX + 14, y(top + ROW_H - 5.5), 'All five run on the same capture layer as Track A.')

# --- Compounding card (dark, this is the USP)
cx0 = MX + bw + 12
rrect(cx0, top, cwid, ROW_H, 5, fill=INK)
c.saveState()
pth = c.beginPath()
pth.roundRect(cx0, y(top) - ROW_H, cwid, ROW_H, 5)
c.clipPath(pth, stroke=0)
try:
    dt = ImageReader(os.path.join(HERE, 'assets/img/digital_twin.jpg'))
    diw, dih = dt.getSize()
    ds = max((cwid * 0.46) / diw, ROW_H / dih)
    c.saveState()
    c.setFillAlpha(0.24)
    c.drawImage(dt, cx0 + cwid - diw * ds, y(top) - ROW_H, width=diw * ds, height=dih * ds, mask='auto')
    c.restoreState()
    # fade the image back into the panel from the left
    for i in range(30):
        c.setFillColor(INK)
        c.setFillAlpha(max(0.0, 1.0 - i / 26.0))
        c.rect(cx0 + cwid * 0.52 + i * (cwid * 0.48 / 30), y(top) - ROW_H,
               cwid * 0.48 / 30 + 0.7, ROW_H, fill=1, stroke=0)
except Exception:
    pass
c.restoreState()

tracking(cx0 + 16, top + 18, 'WHY THIRTEEN COSTS LESS THAN THREE', MONOB, 6.5, CYANL, 1.5)
c.setFillColor(WHITE)
c.setFont(SERB, 17)
c.drawString(cx0 + 16, y(top + 39), 'One flight. Thirteen returns.')
tw = cwid - 32
nxt = draw_lines(cx0 + 16, top + 50,
                 'The same drone flight that inspects a building for A1 also revalues collateral for A7, verifies progress for B1 and feeds monitoring for B3.',
                 SANS, 7.5, HexColor('#B4BDC7'), tw, 9.9)
nxt = draw_lines(cx0 + 16, nxt + 3,
                 'Thirteen modules share one capture layer — drone, satellite, IoT, fixed camera, BIM/GIS — and one technology base: digital twin, GIS, AI, big-data risk control, e-signature/PKI.',
                 SANS, 7.5, HexColor('#B4BDC7'), tw, 9.9)
draw_lines(cx0 + 16, top + ROW_H - 22,
           'The 13th module costs a fraction of the 1st — which is why buying it piecemeal from three vendors costs more and delivers less.',
           SANSB, 7.8, GOLDL, tw, 9.8)
top += ROW_H + 11

# ========================================================== 5. CREDIBILITY
CR_H = 46.0
rrect(MX, top, IW, CR_H, 4, fill=HexColor('#EFEEE8'), stroke=LINE, sw=0.7)
c.setFillColor(CYAN)
c.rect(MX, y(top) - CR_H + 4, 2.6, CR_H - 8, fill=1, stroke=0)
tracking(MX + 14, top + 15, 'DELIVERY TECHNOLOGY PARTNER', MONOB, 6.2, MUTE, 1.4)
c.setFillColor(INK)
c.setFont(SANSB, 9.4)
partner_en = 'Yunxingyu'
c.drawString(MX + 14, y(top + 30), partner_en)
xoff = MX + 14 + stringWidth(partner_en, SANSB, 9.4) + 7
c.setFillColor(CYAN)
c.setFont(MONOB, 7.2)
c.drawString(xoff, y(top + 30), 'BEIJING STOCK EXCHANGE : 873806')
if CJK:
    c.setFont(CJK, 8.0)
    c.setFillColor(BODY)
    c.drawString(MX + 14, y(top + 41), '北京云星宇交通科技股份有限公司')
c.setFillColor(BODY)
for k, ln in enumerate(['28 years in IT   ·   400+ registered IP rights   ·   119 software copyrights',
                        'RMB 3.0bn of contracts across 100+ projects in 30 provinces',
                        '12 national / provincial awards']):
    c.setFont(SANS, 7.2)
    c.drawRightString(W - MX - 14, y(top + 16 + k * 11), ln)
top += CR_H + 10

# ============================================================== 6. THE ASK
c.setFillColor(INK)
c.setFont(SERB, 13)
c.drawString(MX, y(top + 10), 'The ask')
c.setFillColor(MUTE)
c.setFont(SANS, 7.4)
c.drawString(MX + 56, y(top + 10), 'four decisions, none of them a budget decision')
top += 16
ASK_H = 64.0
asks = [
    ('1', 'Approve the diagnostic', 'It costs AFFIN nothing and takes 4–6 weeks.'),
    ('2', 'Half a day in one room', 'Operations, Finance, Corporate Banking, Credit, Risk, Technology.'),
    ('3', 'Name three owners', 'Executive sponsor, B1 business owner, risk owner.'),
    ('4', 'Fix the hurdle in writing', 'Benefit-to-Cost hurdle and the Day-90 measurement method.'),
]
aw = (IW - 3 * 9) / 4
for i, (n, head, sub) in enumerate(asks):
    ax = MX + i * (aw + 9)
    rrect(ax, top, aw, ASK_H, 4, fill=CARD, stroke=LINE, sw=0.8)
    c.setFillColor(HexColor('#E7E4DA'))
    c.setFont(SERB, 17)
    c.drawRightString(ax + aw - 9, y(top + 19), n)
    c.setFillColor(GOLD)
    c.rect(ax + 11, y(top + 14), 12, 2, fill=1, stroke=0)
    c.setFillColor(INK)
    c.setFont(SANSB, 8.3)
    hy = draw_lines(ax + 11, top + 29, head, SANSB, 8.3, INK, aw - 20, 10)
    draw_lines(ax + 11, hy + 2, sub, SANS, 7.0, BODY, aw - 20, 9.0)
top += ASK_H + 10

# ========================================================== 7. CLOSING LINE
c.setStrokeColor(HexColor('#CFCBC0'))
c.setLineWidth(0.7)
c.line(MX, y(top), W - MX, y(top))
top += 18
close = 'The only thing AFFIN risks by starting is finding out how much it has been overpaying.'
c.setFillColor(INK)
c.setFont(SERI, 13.5)
c.drawCentredString(W / 2, y(top), close)
top += 14

# =============================================================== 8. FOOTER
c.setStrokeColor(HexColor('#CFCBC0'))
c.setLineWidth(0.7)
c.line(MX, y(top), W - MX, y(top))
top += 11
disc = ('Evidence discipline: reduction bands and external case results are the delivery partner’s model and partner-provided data pending independent '
        'verification, shown for planning and capability reference only. All ringgit figures are computed from AFFIN’s own inputs. No result is presented as '
        'achieved until measured and confirmed by AFFIN. Commercial terms are indicative and subject to written agreement.')
top = draw_lines(MX, top, disc, SANS, 6.6, MUTE, IW, 8.6)
top += 4
c.setFillColor(INK)
c.setFont(MONOB, 6.8)
c.drawString(MX, y(top), 'Prospek Cerah Inovasi IT Sdn. Bhd.')
c.setFillColor(MUTE)
c.setFont(MONO, 6.8)
c.drawRightString(W - MX, y(top), 'Confidential — for AFFIN Bank internal evaluation  ·  July 2026')

c.showPage()
c.save()
print('WROTE %s  (last content baseline at top=%.1f, bottom margin=%.1f)' % (OUT, top, H - top))
