import json, math, os, sys, tempfile, unittest
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import economics as E

BASE = {"price": 10, "variable_cost": 4, "fixed_cost_monthly": 3000, "units_per_day_at_plan": 50,
        "startup_cost": 10000, "days_per_month": 30, "ramp_months": 0}

class Economics(unittest.TestCase):
    def test_point_values(self):
        r = E.run_once(BASE, lambda k: E.point(BASE[k]))
        self.assertEqual(r["contribution_per_unit"], 6)
        self.assertAlmostEqual(r["break_even_units_per_day"], 3000/30/6)
        self.assertAlmostEqual(r["year1_operating_profit"], 12*(50*30*6-3000))
        self.assertEqual(r["payback_month"], 2)       # 6000/month profit against 10000 startup
        self.assertEqual(r["cash_needed"], 10000)

    def test_losing_unit(self):
        d = dict(BASE, variable_cost=12)
        r = E.run_once(d, lambda k: E.point(d[k]))
        self.assertTrue(math.isinf(r["break_even_units_per_day"]))
        self.assertIsNone(r["payback_month"])

    def test_ramp_reduces_first_months(self):
        d = dict(BASE, ramp_months=3)
        r = E.run_once(d, lambda k: E.point(d[k]))
        self.assertLess(r["months"][0]["units"], r["months"][3]["units"])
        self.assertEqual(r["months"][3]["units"], 50*30)

    def test_deterministic_and_ranges(self):
        d = dict(BASE, variable_cost={"low": 3, "mode": 4, "high": 7})
        a = E.analyse(d, n=500, seed=1); b = E.analyse(d, n=500, seed=1)
        self.assertEqual(a["p_year1_profit"], b["p_year1_profit"])
        self.assertEqual(a["sensitivity"][0]["input"], "variable_cost")
        self.assertLessEqual(a["year1_p10"], a["year1_p50"]); self.assertLessEqual(a["year1_p50"], a["year1_p90"])
        self.assertTrue(0 <= a["p_year1_profit"] <= 1)

    def test_missing_field_is_error(self):
        with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False) as f:
            json.dump({"price": 1}, f)
        with self.assertRaises(E.InputError):
            E.load(f.name)
        os.unlink(f.name)

    def test_bad_range_is_error(self):
        d = dict(BASE, price={"low": 9, "mode": 5, "high": 12})
        with self.assertRaises(E.InputError):
            E.analyse(d, n=10)

    def test_capacity_flag(self):
        d = dict(BASE, capacity_units_per_day=10)
        self.assertFalse(E.analyse(d, n=10)["break_even_fits_capacity"])  # break-even 3000/30/6 = 16.7 > 10
        d2 = dict(BASE, capacity_units_per_day=20)
        self.assertTrue(E.analyse(d2, n=10)["break_even_fits_capacity"])

    def test_markdown_and_cli(self):
        here = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
        out = os.path.join(tempfile.mkdtemp(), "cfo.md")
        self.assertEqual(E.main([os.path.join(here, "example.json"), "--out", out, "--n", "200"]), 0)
        txt = open(out).read()
        self.assertIn("Probability of year-1 operating profit", txt)
        self.assertIn("What moves the result most", txt)

if __name__ == "__main__":
    unittest.main()
