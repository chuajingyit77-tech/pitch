# The learning backend

The company's lessons, its staff and their learning records live here, in a Supabase project of the owner's
(`qijing-learning`, Singapore), never in this repository: the repository is public, so it holds only the demo
lessons and the code. A screen running `play.html` and the admin page `admin.html` reach the backend with the
project's URL and publishable key (`lessons/backend.js`), which are public by design.

## Migrations

Applied in order (Supabase SQL editor, or the Supabase connector's `apply_migration`):

| file | what |
|---|---|
| `001_learning.sql` | the schema `qj` (tables, row level security), the helpers, the screens' `kiosk_*` and the admin page's `admin_*` functions |
| `002_demo_seed.sql` | the heron and the two demo lessons (made from `lessons/index.js` by `seed_demo.mjs`; re-running it updates the heron and leaves lessons alone) |
| `003_api_anon_only.sql` | the API functions callable by the publishable key's role only |
| `004_record_batches.sql` | `kiosk_send`: a batch of learning events counts once; first-answer figures in the record; personal screens' sessions kept alive |
| `005_admin_overview.sql` | the admin overview's figures |
| `006_delete_employee.sql` | deleting a name added by mistake (only while it has no learning record) |
| `007_guardians.sql` | the island's dolphin, the second guardian (teaches marketing and sales; shown once it has published lessons) |
| `008_macaw.sql` | the rainforest's macaw, the third guardian (teaches the contract lessons; shown once it has published lessons) |
| `009_tortoise.sql` | the cloud sea's old tortoise, the fourth guardian (teaches finance, the 名企之道 course and KPI; shown once he has published lessons) |

A migration that deletes rows, even only inside a function (006), waits for the owner's confirmation when applied through
the Supabase connector; until it is applied, the admin page says that feature is waiting for the update. A new migration
is a new numbered file; the test stand-in (`tools/qa/fakebase.cjs`) applies every `NNN_*.sql` here in
order, so the tests always run against what production has.

## How it is kept safe

- The tables are in the schema `qj`, which the API does not expose: nothing can read or write a row through the
  REST API. Row level security is on for every table with no policies, so even a mistaken grant would expose nothing.
- Screens and the admin page call functions in `public` (`kiosk_*`, `admin_*`). Each one is `security definer` with an
  empty `search_path`, checks the token it is given before anything else, and answers `{ ok: true, ... }` or
  `{ ok: false, error }`. Only the role `anon` (the publishable key) may call them.
- Codes, tokens, PINs and passwords are stored only as hashes (sha256 for tokens and codes, bcrypt for PINs and
  passwords). A setup code works once; a team code works for a set number of screens until it expires.
- Five wrong PINs lock a name for 15 minutes; thirty wrong PINs on one screen in ten minutes stop that screen trying
  for a while; wrong codes and admin passwords are throttled too.
- Supabase's Security Advisor lists two kinds of findings, both intended: "RLS Enabled No Policy" (the tables are
  closed to the API on purpose) and "Public Can Execute SECURITY DEFINER Function" (these 24 functions are the API;
  each checks its token itself).

## The functions

Screens: `kiosk_register(setup_code, device_label)` · `kiosk_bootstrap(device_token)` (guardians, published lessons,
staff names) · `kiosk_login(device_token, employee, pin)` · `kiosk_archive(device_token, session_token)` ·
`kiosk_send(device_token, session_token, events, batch)` (what happened in lessons; a batch counts once) ·
`kiosk_logout(device_token, session_token)`. (`kiosk_record`, the same without batches, is the first version, kept
so that no migration had to drop anything.)

The admin page: `admin_claim` (an account from an invite) · `admin_login` · `admin_logout` · `admin_password` ·
`admin_new_invite` · `admin_state` (everything the page shows) · `admin_overview` · `admin_save_employee` ·
`admin_delete_employee` · `admin_unlock` · `admin_device` · `admin_join_code` · `admin_save_lesson` ·
`admin_lesson_status` · `admin_lesson_report` · `admin_employee_report` · `admin_save_guardian`.

## Looking after it

- **The first admin account, or a way back in** when every admin has lost their password: in the SQL editor,
  `select qj.new_invite('who it is for');` gives a one-time invite code (7 days); open `admin.html`, choose 第一次使用.
- **Free plan pausing**: Supabase pauses a free project after about a week without any traffic. A screen connected to
  it asks for its lessons every 10 minutes, which keeps it awake; if the office is closed for longer, open the project
  in the Supabase dashboard and press Restore. Nothing is lost.
- **Backups**: the dashboard's Database → Backups (daily on paid plans). For a copy at any time: SQL editor, then
  export the `qj` tables, or `pg_dump --schema=qj`.

## The drafting job (Google Drive and learning records → draft lessons)

A scheduled Claude task turns the company's documents, and the questions staff keep getting wrong, into draft
lessons. It runs every night in the owner's Claude session, which holds the Google Drive and Supabase connectors (a
task that starts a fresh session cannot carry connectors on this account). Its full instructions (which Drive
folders, which ones are never read, the lesson rules) are stored in the task itself, not here: the folder names and
ids are the company's. Each run:

1. Reads its bookkeeping, `select id, name, modified_at, processed_at, status, note, lesson_id from qj.sources;`, and
   what is already taught (`qj.lessons` that are not archived).
2. Lists the library's files and compares each one's modified time with its rows. Source ids: `drive:<file id>`, or
   `drive:<file id>#1`, `#2` … for a long document drafted as several lessons (names say which part:
   `<file name> · 第4章`); `learning:<lesson id>#<step>` for a reinforcement lesson (step 5).
3. For each new or changed file:
   - not lesson material (an index, a form, a spreadsheet of records, a template, a placeholder, a copy of something
     already drafted): noted as skipped, with the reason:
     `insert into qj.sources (id, name, url, mime, modified_at, processed_at, status, note) values (…, now(), 'skipped', '<why>')
     on conflict (id) do update set name = excluded.name, url = excluded.url, mime = excluded.mime, modified_at = excluded.modified_at, processed_at = now(), status = 'skipped', note = excluded.note;`
   - changed, but nothing the lesson teaches changed: only `modified_at`, `processed_at` and a note are updated;
   - otherwise one lesson per document (or per part of a long one), written the way `DRAFT_PROMPT` in `admin.js` asks
     (in the voice of the guardian who teaches it, `VOICE` in `admin.js`: the heron for the new-staff week, everyone's
     lessons and the rest; the dolphin, `"guardian":"dolphin"`, for marketing and sales; the macaw, `"guardian":"macaw"`,
     for contracts; the tortoise, `"guardian":"tortoise"`, for finance, the 名企之道 course and KPI; a resident of that guardian's own world as the reward; 4–8 `say` lines, 2–3 `ask` questions with
     three options, exactly one `"ok": true`, a `reply` for every option, a closing `card` whose keywords fit on a phone,
     nothing that is not in the document), and saved as a draft:

         select qj.import_draft(
           '{"guardian":"heron","title":"…","keys":"…","about":"…","minutes":4,"badge":"…","reward":{"kind":"kohaku","name":"…","what":"红白锦鲤"},"steps":[…],"outro":"…","tags":[…],"sort":300}'::jsonb,
           '{"id":"drive:<file id>","name":"<file name>","url":"<webViewLink>","mime":"<mimeType>","modified":"<modifiedTime>"}'::jsonb);

     then checked with `qj.lesson_problems`. Where a document disagrees with the company manual, the lesson follows the
     manual and the source's note says what disagrees.
4. Sort bands: 100s the new-staff week, 200s the advanced course, 300–379 role lessons (300s everyone, then one band
   of ten per role), 400s the team's own cases, 500s reinforcement.
5. Learning: a question in a published lesson that at least 3 people answered in the last 30 days, with fewer than
   60% right the first time (answers in wrong-answer reviews do not count), gets a short reinforcement lesson that
   teaches the point again and answers the most-chosen wrong option; at most two a night, and not the same question
   again within 30 days. Its source row's note keeps the evidence (第一次答对率, people, answers, the wrong option).

Drafts appear on the admin page (课程, 草稿 · 等你审核; 资料来源 lists what was drafted from what, and why a file was
skipped). Nothing reaches a screen until an admin publishes it. The job never publishes, archives or deletes, and
never writes to the repository.

## Testing

`node idle-world-3d/tools/qa/fakebase.cjs --init` once (a local PostgreSQL 16), then
`node idle-world-3d/tools/qa/backend_rpc.cjs` runs every function the way the screens and the admin page call them
(126 checks). `school.cjs` and `admin.cjs` drive the real pages against the same stand-in (`tools/qa/README.md`).
