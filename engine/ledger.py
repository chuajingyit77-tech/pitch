"""Evidence ledger: every factual claim an agent makes, with its source.

A ledger is a JSONL file (one record per line) so agents can append without
coordinating. Each record:

  {"id": "E-0001", "agent": "competitors", "claim": "...", "source_url": "https://...",
   "fetched_at": "2026-11-11", "quote": "verbatim text from the source",
   "kind": "price|review|market|regulation|customer|other",
   "confidence": 0.0-1.0, "method": "firecrawl|perplexity|search|manual|model"}

Rules enforced here:
- method "model" (the model's own recollection) caps confidence at 0.3 and
  needs no URL; every other method needs a URL and a fetched_at date.
- A run's evidence profile says which kinds each agent must produce. `check`
  reports coverage so the verdict can discount agents that ran on thin evidence.
Standard library only.
"""
import argparse
import json
import os
import re
import sys
from datetime import date

KINDS = {"price", "review", "market", "regulation", "customer", "competitor", "other"}
METHODS = {"firecrawl", "perplexity", "search", "manual", "model", "panel", "posthog", "clay"}
URL = re.compile(r"^https?://\S+$")

# What each agent must have sourced before its output counts at full weight.
DEFAULT_PROFILE = {
    "scout": {"market": 2},
    "competitors": {"competitor": 3, "price": 3, "review": 3},
    "panel_real": {"customer": 5},
    "pricing": {"price": 3},
    "cfo": {"price": 1},
}


def validate(rec):
    errs = []
    for k in ("agent", "claim", "kind", "confidence", "method"):
        if k not in rec:
            errs.append(f"missing {k}")
    if errs:
        return errs
    if rec["kind"] not in KINDS:
        errs.append(f"kind must be one of {sorted(KINDS)}")
    if rec["method"] not in METHODS:
        errs.append(f"method must be one of {sorted(METHODS)}")
    try:
        c = float(rec["confidence"])
        if not 0 <= c <= 1:
            errs.append("confidence must be within 0..1")
    except (TypeError, ValueError):
        errs.append("confidence must be a number")
        c = 0
    if rec["method"] == "model":
        if c > 0.3:
            errs.append("model recollection is capped at confidence 0.3")
    else:
        if not URL.match(str(rec.get("source_url", ""))):
            errs.append("source_url must be an http(s) URL for non-model evidence")
        if not re.match(r"^\d{4}-\d{2}-\d{2}$", str(rec.get("fetched_at", ""))):
            errs.append("fetched_at must be YYYY-MM-DD")
    return errs


def read(path):
    recs = []
    if not os.path.exists(path):
        return recs
    with open(path, encoding="utf-8") as f:
        for i, line in enumerate(f, 1):
            line = line.strip()
            if not line:
                continue
            try:
                recs.append(json.loads(line))
            except json.JSONDecodeError as e:
                raise ValueError(f"{path}:{i}: bad JSON: {e}")
    return recs


def add(path, rec):
    errs = validate(rec)
    if errs:
        raise ValueError("; ".join(errs))
    recs = read(path)
    rec = dict(rec)
    rec.setdefault("id", f"E-{len(recs)+1:04d}")
    rec.setdefault("fetched_at", date.today().isoformat())
    os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
    with open(path, "a", encoding="utf-8") as f:
        f.write(json.dumps(rec, ensure_ascii=False) + "\n")
    return rec["id"]


def coverage(recs, profile=None):
    """Per agent: required kinds, how many sourced (non-model) records exist, and a weight 0..1."""
    profile = profile or DEFAULT_PROFILE
    out = {}
    for agent, need in profile.items():
        mine = [r for r in recs if r.get("agent") == agent and r.get("method") != "model"]
        kinds = {}
        ratios = []
        for kind, n in need.items():
            have = sum(1 for r in mine if r.get("kind") == kind)
            kinds[kind] = {"need": n, "have": have}
            ratios.append(min(1.0, have / n))
        out[agent] = {"kinds": kinds, "weight": round(sum(ratios) / len(ratios), 2) if ratios else 1.0}
    return out


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    sub = ap.add_subparsers(dest="cmd", required=True)
    a1 = sub.add_parser("add", help="append one record (JSON on stdin or --json)")
    a1.add_argument("ledger")
    a1.add_argument("--json", help="the record as a JSON string")
    a2 = sub.add_parser("check", help="validate every record and report coverage")
    a2.add_argument("ledger")
    a2.add_argument("--profile", help="JSON file overriding the default evidence profile")
    a3 = sub.add_parser("list", help="print records, optionally for one agent")
    a3.add_argument("ledger")
    a3.add_argument("--agent")
    a = ap.parse_args(argv)
    if a.cmd == "add":
        raw = a.json if a.json else sys.stdin.read()
        try:
            print(add(a.ledger, json.loads(raw)))
        except ValueError as e:
            print(f"rejected: {e}", file=sys.stderr)
            return 2
        return 0
    recs = read(a.ledger)
    if a.cmd == "list":
        for r in recs:
            if not a.agent or r.get("agent") == a.agent:
                print(json.dumps(r, ensure_ascii=False))
        return 0
    bad = 0
    for r in recs:
        errs = validate(r)
        if errs:
            bad += 1
            print(f"{r.get('id','?')}: {'; '.join(errs)}")
    profile = None
    if a.profile:
        with open(a.profile, encoding="utf-8") as f:
            profile = json.load(f)
    cov = coverage(recs, profile)
    print(f"{len(recs)} records, {bad} invalid")
    for agent, c in cov.items():
        parts = ", ".join(f"{k} {v['have']}/{v['need']}" for k, v in c["kinds"].items())
        print(f"{agent:12s} weight {c['weight']:.2f}  ({parts})")
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
