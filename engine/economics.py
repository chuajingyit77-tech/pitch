"""Unit economics as distributions, not point estimates.

Input: a JSON object (see example.json). Every numeric field may be a number or a
range {"low": x, "mode": y, "high": z}; ranges are sampled from a triangular
distribution. Nothing is guessed: a missing required field is an error.

Output: contribution per unit, break-even, year-one P&L month by month, the
probability of an operating profit in year one, cash needed, payback month, and
a one-at-a-time sensitivity table. Deterministic for a given seed.

Standard library only. No network.
"""
import argparse
import json
import math
import random
import sys

REQUIRED = ["price", "variable_cost", "fixed_cost_monthly", "units_per_day_at_plan", "startup_cost"]
OPTIONAL = {"days_per_month": 30, "ramp_months": 3, "capacity_units_per_day": None, "currency": ""}


class InputError(ValueError):
    pass


def load(path):
    with open(path, encoding="utf-8") as f:
        data = json.load(f)
    for k in REQUIRED:
        if k not in data:
            raise InputError(f"missing required field: {k}")
    for k, v in OPTIONAL.items():
        data.setdefault(k, v)
    return data


def is_range(v):
    return isinstance(v, dict) and {"low", "mode", "high"} <= set(v)


def point(v):
    """The 'most likely' value of a field: the mode of a range, or the number."""
    return float(v["mode"]) if is_range(v) else float(v)


def sample(v, rng):
    if is_range(v):
        lo, mo, hi = float(v["low"]), float(v["mode"]), float(v["high"])
        if not (lo <= mo <= hi):
            raise InputError(f"range must satisfy low <= mode <= high, got {v}")
        if lo == hi:
            return lo
        return rng.triangular(lo, hi, mo)
    return float(v)


def run_once(d, pick):
    """One deterministic evaluation given a picker that maps a field to a number."""
    price = pick("price")
    vc = pick("variable_cost")
    fixed = pick("fixed_cost_monthly")
    plan = pick("units_per_day_at_plan")
    startup = pick("startup_cost")
    days = pick("days_per_month")
    ramp = int(round(pick("ramp_months")))
    contribution = price - vc
    be_units_day = (fixed / days / contribution) if contribution > 0 else math.inf
    months, cum, payback, worst = [], -startup, None, -startup
    for m in range(1, 13):
        factor = min(1.0, m / (ramp + 1)) if ramp > 0 else 1.0
        units = plan * days * factor
        revenue = units * price
        op_profit = units * contribution - fixed
        cum += op_profit
        worst = min(worst, cum)
        if payback is None and cum >= 0:
            payback = m
        months.append({"month": m, "units": units, "revenue": revenue, "operating_profit": op_profit, "cumulative": cum})
    year1 = sum(x["operating_profit"] for x in months)
    return {
        "contribution_per_unit": contribution,
        "margin_at_plan": (contribution * plan * days - fixed) / (price * plan * days) if price * plan > 0 else -math.inf,
        "break_even_units_per_day": be_units_day,
        "year1_operating_profit": year1,
        "cash_needed": -worst if worst < 0 else 0.0,
        "payback_month": payback,
        "months": months,
    }


def analyse(d, n=5000, seed=7):
    rng = random.Random(seed)
    base = run_once(d, lambda k: point(d[k]))
    sims = []
    for _ in range(n):
        drawn = {k: sample(d[k], rng) for k in REQUIRED + ["days_per_month", "ramp_months"]}
        sims.append(run_once(d, lambda k, drawn=drawn: drawn[k]))

    def pct(key, q):
        vals = sorted(s[key] for s in sims if s[key] is not None and not math.isinf(s[key]))
        if not vals:
            return None
        i = min(len(vals) - 1, max(0, int(round(q * (len(vals) - 1)))))
        return vals[i]

    p_profit = sum(1 for s in sims if s["year1_operating_profit"] > 0) / n
    p_unit = sum(1 for s in sims if s["contribution_per_unit"] > 0) / n
    cap = d.get("capacity_units_per_day")
    fits = None if cap is None else base["break_even_units_per_day"] <= point(cap)

    # One-at-a-time sensitivity on year-one profit: swing each ranged input to its low and high.
    sens = []
    for k in REQUIRED:
        if is_range(d[k]):
            lo = run_once(d, lambda kk, k=k: float(d[k]["low"]) if kk == k else point(d[kk]))["year1_operating_profit"]
            hi = run_once(d, lambda kk, k=k: float(d[k]["high"]) if kk == k else point(d[kk]))["year1_operating_profit"]
            sens.append({"input": k, "year1_at_low": lo, "year1_at_high": hi, "swing": abs(hi - lo)})
    sens.sort(key=lambda s: -s["swing"])

    return {
        "currency": d.get("currency", ""),
        "base": {k: v for k, v in base.items() if k != "months"},
        "months": base["months"],
        "simulations": n,
        "seed": seed,
        "p_year1_profit": p_profit,
        "p_unit_profitable": p_unit,
        "year1_p10": pct("year1_operating_profit", 0.10),
        "year1_p50": pct("year1_operating_profit", 0.50),
        "year1_p90": pct("year1_operating_profit", 0.90),
        "cash_needed_p90": pct("cash_needed", 0.90),
        "break_even_fits_capacity": fits,
        "sensitivity": sens,
    }


def to_markdown(r):
    c = r["currency"]
    b = r["base"]
    f = lambda x: ("n/a" if x is None or (isinstance(x, float) and math.isinf(x)) else f"{c}{x:,.0f}")
    lines = [
        "# Unit economics",
        "",
        f"- Contribution per unit: {f(b['contribution_per_unit'])}",
        f"- Break-even: {b['break_even_units_per_day']:.0f} units/day" if not math.isinf(b["break_even_units_per_day"]) else "- Break-even: never (unit loses money)",
        f"- Margin at plan: {b['margin_at_plan']*100:.0f}%",
        f"- Year 1 operating profit (base): {f(b['year1_operating_profit'])}",
        f"- Year 1 range (P10 / P50 / P90): {f(r['year1_p10'])} / {f(r['year1_p50'])} / {f(r['year1_p90'])}",
        f"- Probability of year-1 operating profit: {r['p_year1_profit']*100:.0f}% ({r['simulations']} simulations, seed {r['seed']})",
        f"- Cash needed (base / P90): {f(b['cash_needed'])} / {f(r['cash_needed_p90'])}",
        f"- Payback month (base): {b['payback_month'] if b['payback_month'] else 'not within year 1'}",
    ]
    if r["break_even_fits_capacity"] is not None:
        lines.append(f"- Break-even fits capacity: {'yes' if r['break_even_fits_capacity'] else 'no'}")
    if r["sensitivity"]:
        lines += ["", "## What moves the result most", "", "| input | year 1 at low | year 1 at high | swing |", "|---|---|---|---|"]
        for s in r["sensitivity"]:
            lines.append(f"| {s['input']} | {f(s['year1_at_low'])} | {f(s['year1_at_high'])} | {f(s['swing'])} |")
    lines += ["", "## Year 1 by month", "", "| month | units | revenue | operating profit | cumulative |", "|---|---|---|---|---|"]
    for m in r["months"]:
        lines.append(f"| {m['month']} | {m['units']:,.0f} | {f(m['revenue'])} | {f(m['operating_profit'])} | {f(m['cumulative'])} |")
    lines += ["", "Every number above traces to an input in numbers.json. Estimates are marked as ranges there; replace them with quotes and real data."]
    return "\n".join(lines) + "\n"


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("numbers", help="path to numbers.json")
    ap.add_argument("--out", help="write a markdown report here")
    ap.add_argument("--json", help="write the full result as JSON here")
    ap.add_argument("--n", type=int, default=5000)
    ap.add_argument("--seed", type=int, default=7)
    a = ap.parse_args(argv)
    try:
        r = analyse(load(a.numbers), n=a.n, seed=a.seed)
    except InputError as e:
        print(f"error: {e}", file=sys.stderr)
        return 2
    if a.json:
        with open(a.json, "w", encoding="utf-8") as fh:
            json.dump(r, fh, indent=2)
    md = to_markdown(r)
    if a.out:
        with open(a.out, "w", encoding="utf-8") as fh:
            fh.write(md)
    else:
        sys.stdout.write(md)
    return 0


if __name__ == "__main__":
    sys.exit(main())
