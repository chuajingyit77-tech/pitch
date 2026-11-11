# engine

The deterministic core of Pitch Engine. Standard-library Python 3, no network, no
installs. Same inputs, same outputs.

| tool | what it does |
| --- | --- |
| `economics.py numbers.json [--out cfo.md] [--json out.json]` | Unit economics with ranges: contribution, break-even, year 1 by month, probability of a year-1 operating profit (Monte Carlo, seeded), cash needed, payback, and which input moves the result most. |
| `pricing.py answers.json\|.csv [--price P]` | Van Westendorp from four price answers per respondent: acceptable range, optimal and indifference points, and a check of a planned price. |
| `ledger.py add\|check\|list evidence.jsonl` | The evidence ledger. Every factual claim with source URL, fetch date, quote, kind, method and confidence. Model recollection is capped at 0.3. `check` reports per-agent coverage weights for the verdict. |
| `verdict.py signals.json` | The verdict, computed: a failed kill criterion is NO-GO; otherwise a weighted score of the CFO probability, simulated buy rate, real intent rate and live conversion, discounted for untested criteria and thin evidence. |

```bash
python3 -m unittest discover -s engine/tests -v
python3 engine/economics.py engine/example.json
```

Inputs that are estimates are written as `{"low", "mode", "high"}` ranges so the
report carries the uncertainty instead of hiding it. `supabase/schema.sql` holds
the tables these results are stored in.
