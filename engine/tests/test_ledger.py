import os, sys, tempfile, unittest
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import ledger as L

GOOD = {"agent": "competitors", "claim": "X charges 29/mo", "source_url": "https://x.example/pricing",
        "fetched_at": "2026-11-11", "quote": "Pro: $29 per month", "kind": "price", "confidence": 0.9, "method": "firecrawl"}

class Ledger(unittest.TestCase):
    def setUp(self):
        self.path = os.path.join(tempfile.mkdtemp(), "evidence.jsonl")

    def test_add_and_ids(self):
        self.assertEqual(L.add(self.path, GOOD), "E-0001")
        self.assertEqual(L.add(self.path, GOOD), "E-0002")
        self.assertEqual(len(L.read(self.path)), 2)

    def test_model_capped(self):
        rec = dict(GOOD, method="model", confidence=0.8); rec.pop("source_url")
        self.assertTrue(any("capped" in e for e in L.validate(rec)))
        rec["confidence"] = 0.3
        self.assertEqual(L.validate(rec), [])

    def test_needs_url_and_date(self):
        rec = dict(GOOD); rec["source_url"] = "pricing page"; rec["fetched_at"] = "yesterday"
        errs = L.validate(rec)
        self.assertEqual(len(errs), 2)

    def test_bad_kind_rejected(self):
        with self.assertRaises(ValueError):
            L.add(self.path, dict(GOOD, kind="rumour"))

    def test_coverage_weights(self):
        for _ in range(3): L.add(self.path, GOOD)
        L.add(self.path, dict(GOOD, kind="competitor"))
        L.add(self.path, dict(GOOD, kind="review", method="model", confidence=0.2))  # model: does not count
        cov = L.coverage(L.read(self.path))
        c = cov["competitors"]["kinds"]
        self.assertEqual((c["price"]["have"], c["competitor"]["have"], c["review"]["have"]), (3, 1, 0))
        self.assertAlmostEqual(cov["competitors"]["weight"], round((1 + 1/3 + 0) / 3, 2))
        self.assertEqual(cov["scout"]["weight"], 0.0)

if __name__ == "__main__":
    unittest.main()
