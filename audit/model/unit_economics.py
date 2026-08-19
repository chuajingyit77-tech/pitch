#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Prospek Cerah + HDJ Drone - Unit Economics & Cash Model
Independent audit engine. All labour costs derive from researched Malaysian
market salaries (see audit/research/salaries.md); no figure is invented here
without being traceable to a named assumption below.
"""
from dataclasses import dataclass, field

# ---------------------------------------------------------------------------
# BLOCK 1 : LABOUR COST  (fully-loaded RM per PRODUCTIVE hour)
# Populated from external salary research. Placeholder until agents report.
# ---------------------------------------------------------------------------
STATUTORY_LOADING = None   # multiplier on gross (EPF+SOCSO+EIS+HRD+leave)
BILLABLE_UTILISATION = 0.60  # realistic for a <5-person services firm

ROLES = {}   # role -> dict(gross_month_rm, loaded_month_rm, cost_per_prod_hour)

def build_roles(salary_table, loading, util=BILLABLE_UTILISATION, hrs=160):
    out = {}
    for role, gross in salary_table.items():
        loaded = gross * loading
        out[role] = {
            "gross_month_rm": round(gross),
            "loaded_month_rm": round(loaded),
            "cost_per_paid_hour": round(loaded / hrs, 2),
            "cost_per_productive_hour": round(loaded / (hrs * util), 2),
        }
    return out

# ---------------------------------------------------------------------------
# BLOCK 2 : OFFER MODEL
# ---------------------------------------------------------------------------
@dataclass
class Offer:
    oid: str
    name: str
    price_rm: float                  # proposed test price
    hours: dict = field(default_factory=dict)   # role -> hours (base case)
    hours_bad: dict = field(default_factory=dict) # worst case hours
    cash_out_rm: float = 0.0         # third-party cash cost, base
    cash_out_bad_rm: float = 0.0     # worst case
    rework_prob: float = 0.0         # probability of a full rework cycle
    win_rate: float = None           # proposals needed per win
    notes: str = ""

    def labour(self, rates, worst=False):
        h = self.hours_bad if (worst and self.hours_bad) else self.hours
        return sum(rates[r]["cost_per_productive_hour"] * n for r, n in h.items())

    def total_hours(self, worst=False):
        h = self.hours_bad if (worst and self.hours_bad) else self.hours
        return sum(h.values())

    def economics(self, rates):
        base_lab = self.labour(rates)
        base_cost = base_lab + self.cash_out_rm
        worst_lab = self.labour(rates, worst=True)
        worst_cost = worst_lab + self.cash_out_bad_rm
        exp_cost = base_cost + self.rework_prob * (worst_cost - base_cost)
        def gm(c):
            return (self.price_rm - c) / self.price_rm * 100 if self.price_rm else float('nan')
        return {
            "offer": self.oid,
            "price_rm": self.price_rm,
            "hours_base": self.total_hours(),
            "hours_worst": self.total_hours(worst=True),
            "labour_base_rm": round(base_lab),
            "cash_out_rm": self.cash_out_rm,
            "cost_base_rm": round(base_cost),
            "cost_expected_rm": round(exp_cost),
            "cost_worst_rm": round(worst_cost),
            "gm_base_pct": round(gm(base_cost), 1),
            "gm_expected_pct": round(gm(exp_cost), 1),
            "gm_worst_pct": round(gm(worst_cost), 1),
            "gp_base_rm": round(self.price_rm - base_cost),
            "gp_worst_rm": round(self.price_rm - worst_cost),
            "rm_per_internal_hour": round(self.price_rm / self.total_hours(), 0) if self.total_hours() else None,
        }

# ---------------------------------------------------------------------------
# BLOCK 3 : BREAK-EVEN / CAPACITY
# ---------------------------------------------------------------------------
def breakeven(fixed_monthly_rm, offer_econ):
    gp = offer_econ["gp_base_rm"]
    gpw = offer_econ["gp_worst_rm"]
    return {
        "offer": offer_econ["offer"],
        "units_to_cover_fixed_base": round(fixed_monthly_rm / gp, 2) if gp > 0 else None,
        "units_to_cover_fixed_worst": round(fixed_monthly_rm / gpw, 2) if gpw > 0 else None,
    }

def capacity(offer_econ, delivery_hours_available_month):
    h = offer_econ["hours_base"]
    return round(delivery_hours_available_month / h, 1) if h else None

if __name__ == "__main__":
    print("Model engine ready. Awaiting researched salary + cost inputs.")
