"""The verdict, computed. Same inputs, same answer, every time.

Input: a JSON file with whatever of these is known:

  kill_criteria: [{"id": "K1", "text": "...", "status": "pass|fail|untested"}]
  p_year1_profit: 0..1          from economics.py
  p_unit_profitable: 0..1       from economics.py
  break_even_fits_capacity: true|false|null
  simulated_buy_rate: 0..1      from the simulated panel
  real_intent_rate: 0..1        from the real prospect panel (optional)
  live_conversion: 0..1         from the pitch page, visitors -> signups (optional)
  evidence_weights: {"competitors": 0.67, ...}   from ledger.py coverage (optional)

Rule:
  1. Any kill criterion with status "fail" -> NO-GO, whatever else says.
  2. Score = weighted mean of the available signals:
       p_year1_profit                     weight 3
       simulated_buy_rate (capped at 0.6) weight 1, scaled 0..0.6 -> 0..1
       real_intent_rate                   weight 3, scaled 0..0.4 -> 0..1
       live_conversion                    weight 4, scaled 0..0.10 -> 0..1
     Signals that are absent are left out of the mean, and the result is
     discounted by the share of kill criteria still untested and by thin
     evidence (mean of evidence_weights, floor 0.5).
  3. Score >= 0.65 -> GO, >= 0.40 -> PIVOT, else NO-GO.
  Probability reported is the discounted score; confidence is low when fewer
  than two signals exist or more than half the criteria are untested.
Standard library only.
"""
import argparse
import json
import sys

GO, PIVOT, NOGO = "GO", "PIVOT", "NO-GO"


def _scaled(x, cap):
    return max(0.0, min(1.0, float(x) / cap))


def compute(d):
    crit = d.get("kill_criteria", []) or []
    failed = [c for c in crit if c.get("status") == "fail"]
    untested = [c for c in crit if c.get("status") not in ("pass", "fail")]
    reasons = []
    signals = []
    if d.get("p_year1_profit") is not None:
        signals.append(("p_year1_profit", float(d["p_year1_profit"]), 3))
    if d.get("simulated_buy_rate") is not None:
        signals.append(("simulated_buy_rate", _scaled(d["simulated_buy_rate"], 0.6), 1))
    if d.get("real_intent_rate") is not None:
        signals.append(("real_intent_rate", _scaled(d["real_intent_rate"], 0.4), 3))
    if d.get("live_conversion") is not None:
        signals.append(("live_conversion", _scaled(d["live_conversion"], 0.10), 4))

    if failed:
        reasons.append(f"kill criteria failed: {', '.join(c.get('id','?') for c in failed)}")
        return {"verdict": NOGO, "probability": 0.0, "confidence": "high", "signals": signals, "reasons": reasons,
                "untested_criteria": [c.get("id") for c in untested]}

    if not signals:
        return {"verdict": "INCOMPLETE", "probability": None, "confidence": "none", "signals": [],
                "reasons": ["no signals yet: run the CFO and a panel"], "untested_criteria": [c.get("id") for c in untested]}

    raw = sum(v * w for _, v, w in signals) / sum(w for _, _, w in signals)
    untested_share = len(untested) / len(crit) if crit else 1.0
    crit_discount = 1 - 0.5 * untested_share                    # all untested -> x0.5, all tested -> x1
    ew = d.get("evidence_weights") or {}
    ev_discount = max(0.5, sum(ew.values()) / len(ew)) if ew else 0.75   # no ledger at all -> x0.75
    if d.get("p_unit_profitable") is not None and float(d["p_unit_profitable"]) < 0.5:
        reasons.append("the unit loses money in most simulations")
        raw *= 0.5
    if d.get("break_even_fits_capacity") is False:
        reasons.append("break-even is above capacity")
        raw *= 0.5
    score = round(raw * crit_discount * ev_discount, 3)
    verdict = GO if score >= 0.65 else PIVOT if score >= 0.40 else NOGO
    confidence = "low" if (len(signals) < 2 or untested_share > 0.5) else "medium" if len(signals) < 3 else "high"
    if untested:
        reasons.append(f"{len(untested)} of {len(crit)} kill criteria untested")
    if ew:
        thin = [a for a, w in ew.items() if w < 0.67]
        if thin:
            reasons.append(f"thin evidence from: {', '.join(thin)}")
    for name, v, w in sorted(signals, key=lambda s: -s[2]):
        reasons.append(f"{name} = {v:.2f} (weight {w})")
    return {"verdict": verdict, "probability": score, "confidence": confidence, "signals": signals,
            "reasons": reasons, "untested_criteria": [c.get("id") for c in untested],
            "discounts": {"criteria": round(crit_discount, 2), "evidence": round(ev_discount, 2)}}


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("inputs", help="JSON file of signals")
    ap.add_argument("--json", help="write the result here")
    a = ap.parse_args(argv)
    with open(a.inputs, encoding="utf-8") as f:
        r = compute(json.load(f))
    if a.json:
        with open(a.json, "w", encoding="utf-8") as fh:
            json.dump(r, fh, indent=2)
    p = "" if r["probability"] is None else f" ({r['probability']*100:.0f}%, confidence {r['confidence']})"
    print(f"{r['verdict']}{p}")
    for x in r["reasons"]:
        print(f"- {x}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
