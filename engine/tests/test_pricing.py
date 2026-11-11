import json, os, random, sys, tempfile, unittest
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import pricing as P

def panel(n=60, seed=3, centre=20.0):
    rng = random.Random(seed); out = []
    for _ in range(n):
        tc = rng.uniform(0.4, 0.6) * centre; bg = tc + rng.uniform(0.1, 0.3) * centre
        ex = bg + rng.uniform(0.2, 0.4) * centre; te = ex + rng.uniform(0.2, 0.5) * centre
        out.append({"too_cheap": tc, "bargain": bg, "expensive": ex, "too_expensive": te})
    return out

class Pricing(unittest.TestCase):
    def test_points_are_ordered(self):
        r = P.analyse(panel())
        self.assertIsNotNone(r["pmc"]); self.assertIsNotNone(r["pme"])
        self.assertLess(r["pmc"], r["pme"])
        self.assertTrue(r["pmc"] <= r["opp"] <= r["pme"] or r["pmc"] <= r["ipp"] <= r["pme"])

    def test_range_scales_with_prices(self):
        a = P.analyse(panel(centre=10)); b = P.analyse(panel(centre=40))
        self.assertLess(a["pme"], b["pmc"] + 1e-9)

    def test_check_price(self):
        r = P.analyse(panel())
        self.assertIn("below", P.check_price(r, r["pmc"] - 1))
        self.assertIn("above", P.check_price(r, r["pme"] + 1))
        self.assertIn("inside", P.check_price(r, (r["pmc"] + r["pme"]) / 2))

    def test_load_drops_unordered_and_needs_five(self):
        rows = panel(6) + [{"too_cheap": 9, "bargain": 5, "expensive": 7, "too_expensive": 8}, {"bargain": 1}]
        with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False) as f:
            json.dump(rows, f)
        good, bad = P.load(f.name); os.unlink(f.name)
        self.assertEqual((len(good), bad), (6, 2))
        with self.assertRaises(ValueError):
            P.analyse(good[:4])

    def test_csv_and_cli(self):
        d = tempfile.mkdtemp(); p = os.path.join(d, "a.csv")
        with open(p, "w") as f:
            f.write("too_cheap,bargain,expensive,too_expensive\n")
            for r in panel(30):
                f.write(",".join(f"{r[k]:.2f}" for k in P.KEYS) + "\n")
        self.assertEqual(P.main([p, "--price", "20", "--json", os.path.join(d, "o.json")]), 0)
        with open(os.path.join(d, "o.json")) as fh:
            self.assertIn("planned_price_check", json.load(fh))

if __name__ == "__main__":
    unittest.main()
