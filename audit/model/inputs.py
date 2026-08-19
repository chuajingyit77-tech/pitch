# -*- coding: utf-8 -*-
"""
Researched Malaysian cost inputs, 2026. Every figure traceable to
audit/research/salaries.md. Nothing here is invented.
"""

# --- Statutory loading (derived, see salaries.md §4.3) --------------------
LOADING_FULL   = 1.28   # >=10 staff, 1-mth bonus, medical, HRD levy 1%
LOADING_LEAN   = 1.19   # <10 staff (no HRD levy), no bonus provision

# --- Productive hours per month ------------------------------------------
# 160 paid hrs x 88.85% attendance (13 PH + 12 AL + 4 MC) x 60% billable
HOURS_PAID        = 160
ATTENDANCE_FACTOR = 0.8885
UTILISATION       = 0.60
HOURS_PRODUCTIVE  = round(HOURS_PAID * ATTENDANCE_FACTOR * UTILISATION, 1)   # 85.3

# --- Fully-loaded cost per PRODUCTIVE hour (RM), Klang Valley mid-level ---
# from salaries.md master table, "RM/productive hr (85, real)" column
RATES = {
  "BD":   {"cost_per_productive_hour": 75.57,  "role": "BD/销售执行 mid, gross RM5,000"},
  "PM":   {"cost_per_productive_hour": 125.77, "role": "项目经理 mid, gross RM8,500"},
  "TECH": {"cost_per_productive_hour": 75.57,  "role": "摄影测量/GIS mid, gross RM5,000"},
  "DEV":  {"cost_per_productive_hour": 122.16, "role": "软件工程师 mid, gross RM8,250"},
  "QA":   {"cost_per_productive_hour": 125.77, "role": "技术QA/scan-to-BIM lead, gross RM8,500"},
}

# --- The plan's OWN kill rule --------------------------------------------
# "每 RM5,000 不得超过 20 内部工时"  =>  RM250 revenue per internal hour
PLAN_KILL_RM_PER_HOUR = 250.0
PLAN_KILL_MIN_GM_PCT  = 30.0

# --- Burn scenarios -------------------------------------------------------
# Monthly GROSS salary by person. 0 = unpaid founder (opportunity cost only).
SCENARIOS = {
  "A 市场价全职 (4人按市场工资)": {
      "salaries": {"JY_MD": 15000, "Shermyn_PM": 8500, "Papu_DEV": 8250, "Hanif_TECH": 5000},
      "loading": LOADING_LEAN, "other_fixed": 6500},
  "B 创业压缩 (4人拿生存工资)": {
      "salaries": {"JY_MD": 3000, "Shermyn_PM": 5000, "Papu_DEV": 4500, "Hanif_TECH": 3500},
      "loading": LOADING_LEAN, "other_fixed": 6500},
  "C 极限求生 (2位创始人零薪)": {
      "salaries": {"JY_MD": 0, "Shermyn_PM": 4000, "Papu_DEV": 0, "Hanif_TECH": 3000},
      "loading": LOADING_LEAN, "other_fixed": 4500},
}

# other_fixed breakdown (RM/month), from software+compliance research:
OTHER_FIXED_DETAIL = {
  "共享办公/办公室": 2000, "软件与云 (Metashape摊销+Postshot+存储)": 1400,
  "会计/公司秘书/审计": 700, "保险 (专业责任+设备)": 350,
  "通讯/网络/杂项": 500, "交通/差旅底数": 1200, "银行/合规/杂费": 350,
}
