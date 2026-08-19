# -*- coding: utf-8 -*-
import sys; sys.path.insert(0,'/home/user/pitch/audit/model')
from inputs import *
from offers import OFFERS

# 情景B：创始人拿生存工资（不是市场价）。这是对计划最有利的合理假设。
LEAN_SAL = {"BD":3000,"PM":5000,"DEV":4500,"TECH":3500,"QA":5000}
LEAN = {r:{"cost_per_productive_hour": round(g*LOADING_LEAN/HOURS_PRODUCTIVE,2)} for r,g in LEAN_SAL.items()}
print("情景B 人力费率 (RM/生产工时，创始人生存工资):", {k:v["cost_per_productive_hour"] for k,v in LEAN.items()})
burnB = 25540  # 情景B 月烧钱

print()
hdr=f"{'Offer':<12}{'售价':>8}{'成本期望':>10}{'毛利RM':>9}{'毛利%':>8}{'最坏毛利%':>10}{'RM/工时':>9}{'killrule':>9}{'覆盖月烧钱需几单':>16}{'月产能(单)':>10}"
print("="*len(hdr)); print("BLOCK 3 — 情景B 重算（对计划最有利的假设：创始人只拿生存工资）"); print("="*len(hdr))
print(hdr); print("-"*len(hdr))
DELIVERY_HOURS = 3*HOURS_PRODUCTIVE   # 3人可交付 = 256 生产工时/月
survivors=[]
for o in OFFERS:
    e=o.economics(LEAN)
    gp=e["price_rm"]-e["cost_expected_rm"]
    units = burnB/gp if gp>0 else None
    cap = DELIVERY_HOURS/e["hours_base"]
    kill = "通过" if e["rm_per_internal_hour"]>=PLAN_KILL_RM_PER_HOUR and e["gm_expected_pct"]>=PLAN_KILL_MIN_GM_PCT else "✗"
    us = f"{units:.1f}" if units else "永远不能"
    if gp>0 and e["gm_expected_pct"]>=30: survivors.append((e['offer'],e['gm_expected_pct'],units,cap))
    print(f"{e['offer']:<12}{e['price_rm']:>8,.0f}{e['cost_expected_rm']:>10,.0f}{gp:>9,.0f}{e['gm_expected_pct']:>8.1f}{e['gm_worst_pct']:>10.1f}{e['rm_per_internal_hour']:>9,.0f}{kill:>9}{us:>16}{cap:>10.1f}")

print()
print("即使在最有利假设下，毛利率≥30% 的 Offer 只有：")
for s in survivors: print(f"   · {s[0]:<10} 期望毛利 {s[1]:.1f}%  覆盖月烧钱需 {s[2]:.1f} 单/月  交付产能上限 {s[3]:.1f} 单/月")
if not survivors: print("   （无）")

print()
print("="*104)
print("BLOCK 4 — 反推：要通过计划自己的 kill rule (RM250/内部工时)，售价必须是多少？")
print("="*104)
print(f"{'Offer':<12}{'当前售价':>10}{'内部工时':>9}{'需售价@RM250/hr':>17}{'涨价倍数':>10}{'市场是否接受':>14}")
for o in OFFERS:
    e=o.economics(LEAN); need=e["hours_base"]*PLAN_KILL_RM_PER_HOUR
    print(f"{e['offer']:<12}{e['price_rm']:>10,.0f}{e['hours_base']:>9.0f}{need:>17,.0f}{need/e['price_rm']:>10.2f}x{'':>14}")
