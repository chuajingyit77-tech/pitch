# -*- coding: utf-8 -*-
"""Burn-rate scenarios. The brief never states monthly fixed cost (gap D-08),
so we model three regimes and show what each REQUIRES in revenue.
Salary inputs are filled from external research; see salaries.md."""

def scenario(name, headcount_gross_rm, loading, other_fixed_rm, target_gm=0.50):
    """headcount_gross_rm: dict role->monthly gross RM (0 = unpaid founder)"""
    payroll_gross = sum(headcount_gross_rm.values())
    payroll_loaded = payroll_gross * loading
    fixed = payroll_loaded + other_fixed_rm
    return {
        "scenario": name,
        "payroll_gross_rm": round(payroll_gross),
        "payroll_loaded_rm": round(payroll_loaded),
        "other_fixed_rm": round(other_fixed_rm),
        "total_monthly_burn_rm": round(fixed),
        "revenue_needed_at_gm_rm": round(fixed / target_gm),
        "annual_burn_rm": round(fixed * 12),
    }
