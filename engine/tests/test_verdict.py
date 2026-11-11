import os, sys, unittest
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import verdict as V

CRIT = [{"id": "K1", "status": "pass"}, {"id": "K2", "status": "pass"}, {"id": "K3", "status": "untested"}]

class Verdict(unittest.TestCase):
    def test_failed_criterion_is_nogo(self):
        r = V.compute({"kill_criteria": [{"id": "K1", "status": "fail"}], "p_year1_profit": 0.99, "live_conversion": 0.2})
        self.assertEqual(r["verdict"], V.NOGO); self.assertEqual(r["probability"], 0.0)

    def test_incomplete_without_signals(self):
        self.assertEqual(V.compute({"kill_criteria": CRIT})["verdict"], "INCOMPLETE")

    def test_go_when_strong_everywhere(self):
        r = V.compute({"kill_criteria": [{"id": "K1", "status": "pass"}], "p_year1_profit": 0.9,
                       "real_intent_rate": 0.35, "live_conversion": 0.09, "evidence_weights": {"competitors": 1, "scout": 1}})
        self.assertEqual(r["verdict"], V.GO); self.assertEqual(r["confidence"], "high")

    def test_untested_criteria_discount(self):
        full = V.compute({"kill_criteria": [{"id": "K1", "status": "pass"}], "p_year1_profit": 0.8, "simulated_buy_rate": 0.5})
        half = V.compute({"kill_criteria": CRIT, "p_year1_profit": 0.8, "simulated_buy_rate": 0.5})
        self.assertGreater(full["probability"], half["probability"])

    def test_real_outweighs_simulated(self):
        sim = V.compute({"kill_criteria": [], "simulated_buy_rate": 0.6, "real_intent_rate": 0.05})
        self.assertLess(sim["probability"], 0.4)

    def test_capacity_and_unit_loss_halve(self):
        base = {"kill_criteria": [{"id": "K1", "status": "pass"}], "p_year1_profit": 0.8}
        a = V.compute(base)["probability"]
        b = V.compute(dict(base, break_even_fits_capacity=False))["probability"]
        c = V.compute(dict(base, p_unit_profitable=0.2))["probability"]
        self.assertAlmostEqual(b, round(a / 2, 3), places=2); self.assertAlmostEqual(c, round(a / 2, 3), places=2)

    def test_deterministic(self):
        d = {"kill_criteria": CRIT, "p_year1_profit": 0.6, "simulated_buy_rate": 0.3}
        self.assertEqual(V.compute(d), V.compute(d))

if __name__ == "__main__":
    unittest.main()
