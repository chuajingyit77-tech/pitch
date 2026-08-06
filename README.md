# pitch
is to make outstanding and visually and functionable good digital pitch

## Prospek Cerah CRM

A single-user CRM command center lives in [`crm/index.html`](crm/index.html) — one file, no server, no login. Dark sci-fi "command center" UI, Chinese interface.

- **Priority engine** — every active lead gets a P-score from urgency (overdue next actions, deal-rotting per stage, uncontacted new leads), deal value, and stage win probability. The FOCUS list ranks what to do today, with reasons and a suggested next-best-action when none is planned.
- **Proactive alerts** — daily briefing dialog on first open, browser notifications for overdue / due-today / cooling new leads, tab-title badge, and live status in the header.
- **Pipeline intelligence** — weighted forecast (value × stage probability), sales funnel chart, 14-day follow-up momentum sparkline, per-lead touch counter (80% of deals need 5+ follow-ups).
- **Log updates** — after a meeting/call/WhatsApp, log what happened, move the stage, and lock in the next action with a due date; one-tap WhatsApp/call from the focus cards.
- **Backup** — data is saved in the browser (localStorage); export/import a JSON backup from the settings tab.

To use it: open `crm/index.html` in any browser, or enable GitHub Pages on this repo (Settings → Pages → deploy from branch) and visit `/crm/`.
