"""Van Westendorp price sensitivity from four answers per respondent.

Each respondent answers four prices: too_cheap, bargain, expensive, too_expensive.
Input: a JSON list of objects with those four keys (and anything else, ignored),
or a CSV with those four column headers. Output: the four classic points.

- PMC  point of marginal cheapness:      too_cheap  (desc) meets expensive  (asc)
- PME  point of marginal expensiveness:  bargain    (desc) meets too_expensive (asc)
- OPP  optimal price point:              too_cheap  (desc) meets too_expensive (asc)
- IPP  indifference price point:         bargain    (desc) meets expensive  (asc)

Acceptable range is PMC..PME. Respondents whose answers are not ordered
too_cheap <= bargain <= expensive <= too_expensive are dropped and counted.
Standard library only.
"""
import argparse
import csv
import json
import sys

KEYS = ["too_cheap", "bargain", "expensive", "too_expensive"]


def load(path):
    if path.endswith(".csv"):
        with open(path, newline="", encoding="utf-8") as f:
            rows = list(csv.DictReader(f))
    else:
        with open(path, encoding="utf-8") as f:
            rows = json.load(f)
            if isinstance(rows, dict) and "answers" in rows:
                rows = rows["answers"]
    good, bad = [], 0
    for r in rows:
        try:
            v = [float(r[k]) for k in KEYS]
        except (KeyError, TypeError, ValueError):
            bad += 1
            continue
        if v[0] <= v[1] <= v[2] <= v[3]:
            good.append(dict(zip(KEYS, v)))
        else:
            bad += 1
    return good, bad


def _curve(values, ascending, grid):
    n = len(values)
    s = sorted(values)
    out = []
    for p in grid:
        le = sum(1 for x in s if x <= p)
        out.append((le / n) if ascending else (1 - le / n))
    return out


def _cross(grid, a, b):
    """First price where curve a drops to or below curve b; linear interpolation between grid points."""
    for i in range(1, len(grid)):
        d0, d1 = a[i - 1] - b[i - 1], a[i] - b[i]
        if d0 > 0 >= d1:
            if d0 == d1:
                return grid[i]
            t = d0 / (d0 - d1)
            return grid[i - 1] + t * (grid[i] - grid[i - 1])
    return None


def analyse(answers, steps=400):
    if len(answers) < 5:
        raise ValueError("need at least 5 valid respondents")
    lo = min(a["too_cheap"] for a in answers)
    hi = max(a["too_expensive"] for a in answers)
    grid = [lo + (hi - lo) * i / steps for i in range(steps + 1)]
    tc = _curve([a["too_cheap"] for a in answers], False, grid)   # share who think price is too cheap (desc)
    bg = _curve([a["bargain"] for a in answers], False, grid)     # share who think it is a bargain (desc)
    ex = _curve([a["expensive"] for a in answers], True, grid)    # share who think it is expensive (asc)
    te = _curve([a["too_expensive"] for a in answers], True, grid)
    return {
        "respondents": len(answers),
        "pmc": _cross(grid, tc, ex),
        "pme": _cross(grid, bg, te),
        "opp": _cross(grid, tc, te),
        "ipp": _cross(grid, bg, ex),
    }


def check_price(result, price):
    pmc, pme = result["pmc"], result["pme"]
    if pmc is None or pme is None:
        return "range undefined"
    if price < pmc:
        return "below the acceptable range: buyers will doubt quality"
    if price > pme:
        return "above the acceptable range: too many buyers will call it too expensive"
    return "inside the acceptable range"


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("answers", help="JSON list or CSV with too_cheap,bargain,expensive,too_expensive")
    ap.add_argument("--price", type=float, help="a planned price to check against the range")
    ap.add_argument("--json", help="write the result as JSON here")
    a = ap.parse_args(argv)
    good, bad = load(a.answers)
    try:
        r = analyse(good)
    except ValueError as e:
        print(f"error: {e} ({bad} dropped)", file=sys.stderr)
        return 2
    r["dropped"] = bad
    if a.price is not None:
        r["planned_price"] = a.price
        r["planned_price_check"] = check_price(r, a.price)
    if a.json:
        with open(a.json, "w", encoding="utf-8") as fh:
            json.dump(r, fh, indent=2)
    f = lambda x: "n/a" if x is None else f"{x:.2f}"
    print(f"respondents {r['respondents']} (dropped {bad})")
    print(f"acceptable range  {f(r['pmc'])} .. {f(r['pme'])}")
    print(f"optimal {f(r['opp'])}   indifference {f(r['ipp'])}")
    if a.price is not None:
        print(f"planned {a.price:.2f}: {r['planned_price_check']}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
