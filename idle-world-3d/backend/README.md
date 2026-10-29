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
| `004_record_batches.sql` | a batch of learning events counts once; first-answer figures in the record; personal screens' sessions kept alive |
| `005_admin_overview.sql` | the admin overview's figures; deleting a name added by mistake |

A new migration is a new numbered file; the test stand-in (`tools/qa/fakebase.cjs`) applies every `NNN_*.sql` here in
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
  closed to the API on purpose) and "Public Can Execute SECURITY DEFINER Function" (these 23 functions are the API;
  each checks its token itself).

## The functions

Screens: `kiosk_register(setup_code, device_label)` · `kiosk_bootstrap(device_token)` (guardians, published lessons,
staff names) · `kiosk_login(device_token, employee, pin)` · `kiosk_archive(device_token, session_token)` ·
`kiosk_record(device_token, session_token, events, batch)` · `kiosk_logout(device_token, session_token)`.

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

## The drafting job (Google Drive → draft lessons)

A scheduled Claude task with the Google Drive and Supabase connectors turns the company's documents into draft
lessons. Each run:

1. Lists the files in the agreed Drive folder (and its subfolders) with their ids and modified times, and compares
   them with `select id, modified_at, status from qj.sources;` (a file's source id is `drive:<file id>`).
2. For each file that is new, or modified since it was drafted: reads it, and writes one lesson the way the admin
   page's "用 AI 起草" prompt asks (`DRAFT_PROMPT` in `admin.js`: the heron's voice, 4–8 `say` lines, 2–3 `ask`
   questions with three options, exactly one `"ok": true`, a `reply` for every option, a closing `card`, nothing that
   is not in the document).
3. Saves it as a draft, with where it came from:

       select qj.import_draft(
         '{"guardian":"heron","title":"…","keys":"…","about":"…","minutes":3,"badge":"…","steps":[…],"outro":"…"}'::jsonb,
         '{"id":"drive:<file id>","name":"<file name>","url":"<webViewLink>","mime":"<mimeType>","modified":"<modifiedTime>"}'::jsonb);

4. A file that cannot become a lesson (a form, a spreadsheet of numbers, a scan with no text) is noted instead:
   `insert into qj.sources (id, name, url, mime, modified_at, processed_at, status, note) values (…, now(), 'skipped', '<why>')
   on conflict (id) do update set modified_at = excluded.modified_at, processed_at = now(), status = 'skipped', note = excluded.note;`

Drafts appear on the admin page (课程, 草稿 · 等你审核; 资料来源 lists what was drafted from what). Nothing reaches a
screen until an admin publishes it.

## Testing

`node idle-world-3d/tools/qa/fakebase.cjs --init` once (a local PostgreSQL 16), then
`node idle-world-3d/tools/qa/backend_rpc.cjs` runs every function the way the screens and the admin page call them
(124 checks). `school.cjs` and `admin.cjs` drive the real pages against the same stand-in (`tools/qa/README.md`).
