# Pitch Engine: plan

A system that takes a business idea, tests it against real evidence and real
people, and ships an instrumented pitch whose live results feed back into the
verdict. Built in this repo, run from Claude Code, with a visual front end.

It starts from the Founder skill (the eleven-agent method in AI Sensei's reel)
and goes past it in five places where that pack stops.

## 1. Where the Founder skill stops, and what we do instead

| Founder skill | Pitch Engine |
| --- | --- |
| Agents answer from model memory. Competitor prices, market facts and reviews are whatever Claude recalls. | Every factual claim is backed by an **evidence record**: source URL, date fetched, quote, confidence. Pulled live with Firecrawl and Perplexity, stored, and re-checkable. No evidence, no claim. |
| 100 simulated buyers, read as an upper bound. | Simulated panel **calibrated** on real review language scraped from competitors, then a **real panel**: named prospects from Clay, contacted through Gmail, answers logged. The verdict weights real answers above simulated ones. |
| Output is markdown in a `founder/` folder. No history, no comparison. | **Supabase** holds ideas, runs, evidence, panel answers, numbers and verdicts. Every run is versioned. You can see how a verdict moved after a pivot. |
| Ends at a business plan document. | Ends at a **live pitch**: a landing page or deck generated in this repo, instrumented with **PostHog** (views, scroll, clicks, waitlist signups). Real engagement flows back into the verdict as the strongest signal of all. |
| Point estimates: one break-even number, one margin. | **Ranges and probabilities**: Monte Carlo over the unit-economics inputs, sensitivity table (which input moves the verdict most), scenario cases. Verdict carries a probability, not a label alone. |
| Run once, by hand. | **Monitors**: Firecrawl watches competitor pages, PostHog watches the pitch, a scheduled task re-runs the affected agents and sends a digest when the verdict changes. |

Kept from the Founder skill because they are right: file-based handoffs between
agents, a computed verdict, kill criteria set first by a board, frameworks applied
without impersonating anyone, and disclaimers on simulated data.

## 2. The agents

Twelve, in sequence, each writing to the shared store and reading what came before.

| # | Agent | Job | Evidence it must produce |
| --- | --- | --- | --- |
| 1 | **Board** | Kill criteria, the biggest assumption, what good looks like at 12 months. Three lenses (offer, moat, product) plus a **Red Team** lens that argues for NO-GO. | Criteria written as measurable checks, each later marked pass / fail / untested. |
| 2 | **Scout** | Market size, trends, regulation, timing. | Perplexity answers with citations; each number stored with source and date. |
| 3 | **Competitors** | Direct, indirect, substitutes: prices, positioning, complaints. | Firecrawl scrapes of pricing pages and review pages; quotes stored verbatim with URL. |
| 4 | **Panel (simulated)** | 20 to 100 buyer personas built from Competitors' review language, each a sub-agent. | Buy / pass / reasons / four price answers per buyer, tallied by segment. |
| 5 | **Panel (real)** | 10 to 30 real prospects matching the target, found in Clay, contacted by email with the same pitch. | Replies logged as answers; response and buy-intent rates. Runs only with your approval per batch. |
| 6 | **Pricing** | Van Westendorp on both panels, Gabor-Granger on the real one, checked against competitor prices. | Acceptable range, recommended test price, margin at that price. |
| 7 | **Offer** | Promise, proof, guarantee, bonuses, one-liner. Re-tests on the simulated panel. | Before/after buy rate. |
| 8 | **CFO** | Unit economics as **distributions**: contribution, break-even, year-one P&L, cash needed, payback. Monte Carlo and sensitivity. | Probability of operating profit in year one; the two inputs that matter most. |
| 9 | **Marketing** | Channels, first 100 customers, ten hooks in panel language, max CAC from the CFO. | Hooks later A/B tested on the pitch page with PostHog. |
| 10 | **Brand** | Names with domain and handle availability checked live, voice, tagline, visual brief. Visuals and a short video through Higgsfield. | Availability check results stored. |
| 11 | **Ops and Launch** | Delivery stack, roles, bottlenecks, permits to check, a dated 30-day plan whose first step is the live pitch test. | Checklist with owners and dates. |
| 12 | **Plan** | Compiles the plan and computes the verdict: GO / PIVOT / NO-GO with probability, kill-criteria scorecard, the three actions for this week. | Verdict record in Supabase, business plan markdown, one-page summary, pitch deck outline. |

The verdict is computed from: kill criteria passed, probability of year-one profit,
real panel intent rate (weighted 3x the simulated rate), and live pitch conversion
once it exists. The rule is written in code, not prose, so two runs on the same
inputs give the same verdict.

## 3. The pieces

```
pitch/
  .claude/skills/pe-*/        the twelve agents as skills, plus /pe-run (orchestrator)
  engine/                     Python tools: evidence ledger, panel dealer, pricing,
                              monte-carlo economics, verdict, compile
  supabase/                   schema: ideas, runs, evidence, personas, answers,
                              numbers, verdicts, pitch_events
  idea-lab/                   the visual front end, reads runs from Supabase
  pitches/<idea>/             generated landing page or deck per idea, with PostHog
  docs/                       this plan, method notes
```

- **Skills**: our own, written for this system. Not a copy of the Founder pack.
- **Engine**: standard-library Python, deterministic, tested. Same inputs, same outputs.
- **Supabase**: the project you already have connected. One schema, row-level security on, service key only on the server side.
- **Idea Lab**: becomes the viewer for real runs: evidence drawer per claim, verdict history, kill-criteria scorecard, panel results by segment, one-click "generate the pitch".
- **Pitch pages**: built with the same craft as idle-world and idea-lab. PostHog snippet with events for view, section reached, CTA click, signup. Waitlist writes to Supabase.
- **Connectors**: Perplexity (Scout), Firecrawl (Competitors, monitors), Clay plus Gmail (real panel), PostHog (pitch telemetry), Higgsfield (brand visuals), Playwright (already here: screenshots, availability checks, page QA), Composio (fallback for anything else).

## 4. Phases

**Phase 0: foundation, this week, no new connectors needed.**
- Supabase schema and the evidence ledger.
- Engine tools: Monte Carlo unit economics, Van Westendorp, verdict rule, compiler. Tests for each.
- Twelve skills with file and database handoffs. Scout and Competitors run on web search for now and label evidence as "search, unverified" until Firecrawl and Perplexity are connected.
- Orchestrator `/pe-run <idea>` that runs the chain and writes the run.
- Idea Lab reads a run from Supabase and shows evidence and verdict history.
- Prove it end to end on one idea of yours.

**Phase 1: real evidence, once Firecrawl and Perplexity are connected.**
- Competitors scrapes pricing and review pages; Scout cites sources.
- Simulated panel personas built from scraped review language.
- Brand checks domains and handles live.

**Phase 2: real people and the live pitch, once Clay, Gmail and PostHog are in.**
- Real panel: Clay search, approved email batch, reply logging.
- Pitch generator: landing page per idea with PostHog events and a Supabase waitlist.
- Verdict starts weighting live conversion.

**Phase 3: it runs itself.**
- Firecrawl monitors on competitor pages, PostHog weekly pull, scheduled re-run of affected agents, digest to you when a verdict changes.
- Compare mode in Idea Lab: idea A vs idea B, or one idea before and after a pivot.

## 5. What is deliberately left out

- No autonomous spending: the real panel emails and any paid tools run only on your approval per batch.
- No claims without a source. Where the model is guessing it says so and the verdict discounts it.
- No impersonation of named people. Frameworks only.
- No financial, legal or tax advice. Permits, trademarks and company structure get a "check this with" line.

## 6. Open questions for you

1. Whose ideas go through this: yours, or clients' you pitch for? That decides whether one run is private to you or exportable as a client deliverable.
2. Home market and currency for the CFO defaults, and language for the pitch pages (English, Chinese, both).
3. One real idea to run through Phase 0 so the system is proven on something you care about, not a matcha café.
