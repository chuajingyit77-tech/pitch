#!/usr/bin/env python3
"""One-page executive leave-behind (A4 portrait) for the AFFIN programme."""
from reportlab.lib.pagesizes import A4
from reportlab.lib.colors import HexColor
from reportlab.lib.utils import ImageReader
from reportlab.pdfgen import canvas
from reportlab.pdfbase.pdfmetrics import stringWidth

W, H = A4  # 595.27 x 841.89
INK=HexColor('#0A0F1A'); SLATE=HexColor('#131E30'); PANEL=HexColor('#16233A')
PAPER=HexColor('#F4F5F2'); CARD=HexColor('#FFFFFF'); LINE=HexColor('#DDE1DA')
INKT=HexColor('#16202E'); BODY=HexColor('#45525F'); MUTE=HexColor('#7C8794')
TEAL=HexColor('#159AA8'); TEALB=HexColor('#2FC0CE'); BRASS=HexColor('#A9791F'); BRASSB=HexColor('#C69A4C')
OK=HexColor('#3FA06B'); WARN=HexColor('#C67E1C'); RISK=HexColor('#C6472F'); WHITE=HexColor('#FFFFFF')
SER='Times-Roman'; SERB='Times-Bold'; SERI='Times-Italic'
SANS='Helvetica'; SANSB='Helvetica-Bold'; MONOF='Courier'; MONOB='Courier-Bold'

c = canvas.Canvas('dist/AFFIN-Executive-Onepager.pdf', pagesize=A4)
c.setTitle('AFFIN Bank — Cost Reduction & Credit Loss Prevention Programme (Executive Summary)')
c.setAuthor('Prospek Cerah Inovasi IT Sdn. Bhd.')

MX = 38  # margin
def y(top):  # convert "from top" to reportlab bottom-origin
    return H - top

def wrap(text, font, size, maxw):
    words=text.split(); lines=[]; cur=''
    for w in words:
        t=(cur+' '+w).strip()
        if stringWidth(t,font,size)<=maxw: cur=t
        else:
            if cur: lines.append(cur)
            cur=w
    if cur: lines.append(cur)
    return lines

def para(x, top, text, font, size, color, maxw, leading=None, valign_top=True):
    leading = leading or size*1.32
    c.setFont(font,size); c.setFillColor(color)
    ty = y(top)
    for ln in wrap(text,font,size,maxw):
        c.drawString(x, ty, ln); ty -= leading
    return H-ty  # returns new top

def rrect(x, top, w, h, r=6, fill=None, stroke=None, sw=1):
    c.saveState()
    if fill: c.setFillColor(fill)
    if stroke: c.setStrokeColor(stroke); c.setLineWidth(sw)
    c.roundRect(x, y(top)-h, w, h, r, fill=1 if fill else 0, stroke=1 if stroke else 0)
    c.restoreState()

# ---------- HEADER BAND with hero image ----------
BAND=132
c.saveState()
p=c.beginPath(); p.rect(0, y(BAND), W, BAND); c.clipPath(p, stroke=0)
try:
    img=ImageReader('assets/img/hero_b1.jpg')
    iw,ih=img.getSize(); scale=max(W/iw, BAND/ih); dw,dh=iw*scale, ih*scale
    c.drawImage(img,(W-dw)/2, y(BAND)-(dh-BAND)/2, width=dw, height=dh, mask='auto')
except Exception as e:
    c.setFillColor(INK); c.rect(0,y(BAND),W,BAND,fill=1,stroke=0)
c.restoreState()
c.saveState(); c.setFillColor(INK); c.setFillAlpha(0.55); c.rect(0,y(BAND),W,BAND,fill=1,stroke=0); c.restoreState()
c.saveState(); c.setFillColor(INK); c.setFillAlpha(0.30); c.rect(0,y(BAND),W,BAND,fill=1,stroke=0); c.restoreState()

c.setFont(MONOB,7.5); c.setFillColor(TEALB)
c.drawString(MX, y(30), 'C O N F I D E N T I A L   P R O G R A M M E   S U M M A R Y   ·   J U L Y   2 0 2 6')
c.setFont(SERB,25); c.setFillColor(WHITE)
c.drawString(MX, y(58), 'We remove existing cost — not add a system.')
c.setFont(SANS,10.5); c.setFillColor(HexColor('#DCE4EE'))
c.drawString(MX, y(78), 'A cost-reduction & credit-loss-prevention programme for AFFIN Bank, sized on AFFIN’s own baseline data.')
# equation strip on band
eq=[('Existing cost removed',False),('+',None),('Avoidable credit loss',False),('−',None),('Implementation cost',False),('=',None),('Net benefit',True)]
ex=MX; ey=94
c.setFont(MONOB,7)
for t,res in eq:
    if res is None:
        c.setFillColor(TEALB if t=='=' else HexColor('#AEBAC6')); c.setFont(SANSB,11)
        c.drawString(ex, y(ey+10), t); ex+=stringWidth(t,SANSB,11)+7; c.setFont(MONOB,7); continue
    w=stringWidth(t,MONOB,7)+14
    c.saveState()
    c.setFillColor(BRASS if res else PANEL); c.setFillAlpha(0.9 if res else 0.55)
    c.setStrokeColor(BRASSB if res else HexColor('#2A3B54')); c.setLineWidth(0.8)
    c.roundRect(ex, y(ey+13), w, 17, 4, fill=1, stroke=1); c.restoreState()
    c.setFillColor(BRASSB if res else HexColor('#CBD5E1')); c.setFont(MONOB,7)
    c.drawString(ex+7, y(ey+9), t); ex+=w+6

# ---------- BODY on paper ----------
c.setFillColor(PAPER); c.rect(0,0,W,y(BAND),fill=1,stroke=0)

top=BAND+26
# thesis line
c.setFont(MONOB,7.5); c.setFillColor(TEAL); c.drawString(MX, y(top-8),'THE MESSAGE')
top=para(MX, top+8, 'Rather than layer a new platform on top of every existing task, we convert full manual checking into exception-driven checking — reducing routine site inspections, turning emergency repairs into planned maintenance, optimising ATM & vendor cost, and catching over-drawdowns earlier. Every figure is computed on AFFIN’s own anonymised data; nothing scales until the bank confirms net benefit is positive.',
     SANS, 9.3, BODY, W-2*MX, leading=13)

# two tracks
top+=16
colw=(W-2*MX-14)/2
def track(x, tg, tgcol, h, items):
    rrect(x, top, colw, 150, 6, fill=CARD, stroke=LINE, sw=0.8)
    c.saveState(); c.setFillColor(tgcol); c.setFillAlpha(0.14)
    c.roundRect(x+14, y(top+14)-15, stringWidth(tg,MONOB,7)+16, 15, 3, fill=1, stroke=0); c.restoreState()
    c.setFillColor(tgcol); c.setFont(MONOB,7); c.drawString(x+22, y(top+24), tg)
    c.setFillColor(INKT); c.setFont(SERB,13.5); c.drawString(x+14, y(top+46), h)
    iy=top+64
    c.setFont(SANS,8.6)
    for it in items:
        c.setFillColor(tgcol); c.rect(x+15, y(iy)+1.5, 7, 2.2, fill=1, stroke=0)
        c.setFillColor(BODY)
        for k,ln in enumerate(wrap(it, SANS,8.6, colw-40)):
            c.drawString(x+28, y(iy+k*11), ln)
        iy+= 11*len(wrap(it,SANS,8.6,colw-40)) + 5
track(MX,'TRACK A · OPERATING COST',BRASS,'Hard savings you can bank',
      ['Emergency repairs → planned maintenance','ATM downtime & replenishment routing','HVAC over-run and inefficient equipment','Duplicate vendors, price variance, double billing'])
track(MX+colw+14,'TRACK B · CREDIT LOSS',TEAL,'Losses caught earlier',
      ['Drawdowns released ahead of physical progress','Stalled projects detected months late','Fund diversion & progress–payment mismatch','Collateral erosion tracked continuously'])
top+=150+18

# gate strip
rrect(MX, top, W-2*MX, 34, 6, fill=HexColor('#EAF4EF'), stroke=OK, sw=0.8)
c.setFillColor(OK); c.circle(MX+18, y(top+17), 4, fill=1, stroke=0)
c.setFillColor(INKT); c.setFont(SANSB,9)
c.drawString(MX+32, y(top+14),'Commercial Go/No-Go gate')
c.setFillColor(BODY); c.setFont(SANS,8.6)
c.drawString(MX+32, y(top+26),'No large-scale roll-out until AFFIN confirms net benefit is positive and the Benefit-to-Cost Ratio clears a jointly-agreed hurdle.')
top+=34+18

# B1 flagship strip: drawdown-vs-progress assurance
STRIP=110
rrect(MX, top, W-2*MX, STRIP, 6, fill=CARD, stroke=LINE, sw=0.8)
inner_r = W-MX-16                      # right inner edge
# header row: eyebrow left, WATCH pill far right
c.setFillColor(TEAL); c.setFont(MONOB,7); c.drawString(MX+16, y(top+20),'B1 · CONSTRUCTION FINANCE ASSURANCE')
c.saveState(); c.setFillColor(WARN); c.setFillAlpha(0.16)
c.roundRect(inner_r-52, y(top+23)-1, 52, 15, 3, fill=1, stroke=0); c.restoreState()
c.setFillColor(WARN); c.setFont(MONOB,7.5); c.drawString(inner_r-44, y(top+21),'WATCH')
# title
c.setFillColor(INKT); c.setFont(SERB,13); c.drawString(MX+16, y(top+42),'Drawdown vs physical progress')
# left column: two gauges
gauge_x=MX+16; bar_x=gauge_x+130; bar_w=110
def gbar(gy,label,pct,col):
    c.setFillColor(BODY); c.setFont(SANS,8.4); c.drawString(gauge_x, y(gy)-1, label)
    c.setFillColor(HexColor('#E4E7E0')); c.roundRect(bar_x, y(gy)-3, bar_w, 8, 3, fill=1, stroke=0)
    c.setFillColor(col); c.roundRect(bar_x, y(gy)-3, bar_w*pct/100, 8, 3, fill=1, stroke=0)
    c.setFillColor(INKT); c.setFont(MONOB,8.4); c.drawString(bar_x+bar_w+8, y(gy)-1, f'{pct}%')
gbar(top+66,'Physical progress',62,OK)
gbar(top+88,'Cumulative drawdown',81,RISK)
# right column: note (clear of the left column which ends ~ bar_x+bar_w+40)
nx=MX+16+300; nw=inner_r-nx
c.setFillColor(BODY); c.setFont(SANS,8.2)
note='19-point gap — drawdown is ahead of physical works. The system holds release pending an exception site visit; no committee authority is bypassed. We augment human judgement, never replace it.'
ty2=top+60
for ln in wrap(note, SANS,8.2, nw):
    c.drawString(nx, y(ty2), ln); ty2+=11
top+=STRIP+18

# the ask (4 items in a row)
c.setFillColor(INKT); c.setFont(SERB,13); c.drawString(MX, y(top),'The ask')
top+=10
asks=[('1','Discovery Workshop','Ops, Finance, Corporate Banking, Credit, Risk & Technology pick one A-track and one B1 pilot.'),
      ('2','Name the owners','Executive sponsor, B1 business owner, and risk owner.'),
      ('3','Share baseline data','Inspection counts, ATM & energy bills, vendor contracts, drawdown data.'),
      ('4','Fix two pilot dates','A 10–15 branch A-pilot and a 3–5 project B1 Shadow-Mode pilot, each Day-90.')]
aw=(W-2*MX-3*10)/4
for i,(n,h,b) in enumerate(asks):
    ax=MX+i*(aw+10)
    rrect(ax, top, aw, 96, 6, fill=CARD, stroke=LINE, sw=0.8)
    c.setFillColor(BRASSB); c.setFont(SERB,20); c.drawString(ax+12, y(top+28), n)
    c.setFillColor(INKT); c.setFont(SANSB,8.8)
    for k,ln in enumerate(wrap(h,SANSB,8.8,aw-24)):
        c.drawString(ax+12, y(top+42+k*11), ln)
    c.setFillColor(BODY); c.setFont(SANS,7.6)
    for k,ln in enumerate(wrap(b,SANS,7.6,aw-24)):
        c.drawString(ax+12, y(top+64+k*9.5), ln)
top+=96+16

# evidence discipline footer
c.setStrokeColor(LINE); c.setLineWidth(0.8); c.line(MX, y(top), W-MX, y(top))
top+=12
c.setFillColor(MUTE); c.setFont(SANS,6.8)
disc='Evidence discipline: comparable-market case results are Partner-Provided and Pending Independent Verification, shown for capability reference only. Public AFFIN facts are drawn from AFFIN Group’s public profile. All value figures are generated from AFFIN’s own baseline inputs — no result is presented as achieved until verified.'
for ln in wrap(disc, SANS,6.8, W-2*MX):
    c.drawString(MX, y(top), ln); top+=9
top+=4
c.setFillColor(INKT); c.setFont(MONOB,7)
c.drawString(MX, y(top),'Prospek Cerah Inovasi IT Sdn. Bhd.')
c.setFillColor(MUTE); c.setFont(MONOF,7)
tail='Confidential — for AFFIN Bank internal evaluation   ·   July 2026'
c.drawRightString(W-MX, y(top), tail)

c.showPage(); c.save()
print('WROTE dist/AFFIN-Executive-Onepager.pdf')
