# -*- coding: utf-8 -*-
import sys; sys.path.insert(0,'/home/user/pitch/audit/model')
from inputs import *
from unit_economics import Offer, breakeven
from offers import OFFERS

print("="*104)
print("BLOCK 1 — 每月烧钱率 (BURN) 情景。计划从未给出这个数字 (缺口 D-08)，但它决定一切。")
print("="*104)
print(f"{'情景':<28}{'薪资总额':>10}{'含法定负担':>12}{'其他固定':>10}{'月烧钱':>12}{'年烧钱':>12}{'需营收@50%GM':>14}")
burns={}
for name,s in SCENARIOS.items():
    g=sum(s["salaries"].values()); loaded=g*s["loading"]; fixed=loaded+s["other_fixed"]
    burns[name]=fixed
    print(f"{name:<28}{g:>10,.0f}{loaded:>12,.0f}{s['other_fixed']:>10,.0f}{fixed:>12,.0f}{fixed*12:>12,.0f}{fixed/0.5:>14,.0f}")

print()
print("  计划的 30 天及格线 = RM15,000 到账。对照上表：")
for name,f in burns.items():
    cover = 15000*0.5/f*100   # assume 50% GM on that revenue
    print(f"    · {name:<28} RM15,000 营收(按50%毛利=RM7,500毛利) 只覆盖 {cover:5.1f}% 的月烧钱 → 当月净亏 RM{f-7500:,.0f}")

print()
print("="*104)
print("BLOCK 2 — 逐个 Offer 的真实单位经济（人力按马来西亚市场工资全负担计价，非'现金成本'口径）")
print(f"人力费率(RM/生产工时): BD {RATES['BD']['cost_per_productive_hour']} | PM {RATES['PM']['cost_per_productive_hour']} | TECH {RATES['TECH']['cost_per_productive_hour']} | DEV {RATES['DEV']['cost_per_productive_hour']} | QA {RATES['QA']['cost_per_productive_hour']}")
print(f"生产工时 = 160 x 88.85%出勤 x 60%可计费 = {HOURS_PRODUCTIVE} 小时/月")
print("="*104)
hdr=f"{'Offer':<12}{'售价':>8}{'工时':>6}{'成本(基准)':>11}{'成本(期望)':>11}{'成本(最坏)':>11}{'毛利%基准':>10}{'毛利%期望':>10}{'毛利%最坏':>10}{'RM/内部工时':>12}{'自家killrule':>12}"
print(hdr); print("-"*len(hdr))
results=[]
for o in OFFERS:
    e=o.economics(RATES); results.append((o,e))
    kill = "通过" if e["rm_per_internal_hour"]>=PLAN_KILL_RM_PER_HOUR and e["gm_expected_pct"]>=PLAN_KILL_MIN_GM_PCT else "✗不及格"
    print(f"{e['offer']:<12}{e['price_rm']:>8,.0f}{e['hours_base']:>6.0f}{e['cost_base_rm']:>11,.0f}{e['cost_expected_rm']:>11,.0f}{e['cost_worst_rm']:>11,.0f}{e['gm_base_pct']:>10.1f}{e['gm_expected_pct']:>10.1f}{e['gm_worst_pct']:>10.1f}{e['rm_per_internal_hour']:>12,.0f}{kill:>12}")
