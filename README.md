# PersonalOS

A single-file, identity-anchored personal operating system. One HTML file, one Supabase project, every domain of your life on one canvas: projects, tasks, finance, body, legal, taxes, reflections, soul.

The thesis: every project is a commitment to becoming someone. Every task is a vote toward that identity. The system's job is to make the gap between who you are now and who you're becoming measurable — so the next right action is always visible.

Read [`BLUEPRINT.md`](./BLUEPRINT.md) for the underlying methodology.

---

## What it is

- **One file.** The entire app is `index.html` — no build step, no framework, no bundler. Open it in a browser.
- **Vanilla JS + CSS.** ~7,500 lines of hand-written code. Quiet-luxury design system (monochrome + amber accent).
- **Supabase backend.** Postgres + auth + storage + edge functions. You bring your own project.
- **Plaid for finance (optional).** Connect bank accounts for automatic transaction sync. Skip if you don't need it.
- **AI-assisted rituals.** Snapshots, reflections, and synthesis are driven by Claude (via Claude Code or any Claude-capable tool you wire up).

## Tabs

- **Home** — projects with "becoming statements" and Be/Do/Become scores
- **Tasks** — flat task list across projects, sorted by what matters today
- **Finance** — Plaid-synced transactions, monthly minimums, runway
- **Physique** — workout rotation, recovery data (Apple Health + Oura)
- **Legal** — case tracker (USCIS, court, permits, documents) for self + a dependent
- **Taxes** — multi-year document storage and notes
- **Reflections** — journal with day/week/month/year zoom-lens
- **Soul** — habits and morning routines

## Quick start

### 1. Clone and configure

```bash
git clone https://github.com/YOUR_USERNAME/PersonalOS.git
cd PersonalOS
cp config.example.js config.js
```

Open `config.js` and fill in your Supabase URL and anon key (from Supabase → Settings → API).

### 2. Set up Supabase

Create a new Supabase project. The app expects tables like `projects`, `tasks`, `legal_cases`, `transactions`, `apple_health_daily`, `oura_daily`, `reflections`, `snapshots`, `soul_items`, `tax_documents`, `tax_year_notes`, `profile`, `plaid_items`, etc.

A schema dump is **not yet included** in this repo. The fastest way to bootstrap right now is to open `index.html`, watch the network requests fail, and create the tables Supabase tells you it's missing. Contributions of a clean `schema.sql` are very welcome (see [Contributing](#contributing)).

**⚠️ CRITICAL:** Before going to production, enable Row Level Security (RLS) on every table. The anon key in `config.js` ships to the browser — without RLS, anyone with that key can read and write your entire database.

### 3. Serve the file

Any static server works:

```bash
python3 -m http.server 8000
# or
npx serve .
```

Then open `http://localhost:8000`.

You can also just double-click `index.html` — but Plaid and some Supabase storage features need a real `http(s)://` origin.

## Architecture

- **No framework.** Pages are `<div class="page">` blocks; a tiny `navigate()` function swaps them.
- **All data lives in Supabase.** Every render function fetches what it needs and rebuilds its DOM.
- **Be/Do/Become scoring.** Projects have a `becoming_statement` (identity target). A Postgres trigger recomputes `be_score` whenever a task changes. The dashboard aggregates into a 0–100 Become score across six domains.
- **AI rituals as buttons that copy prompts.** The "synthesize" buttons don't call an API — they copy a prompt to your clipboard for you to paste into Claude. Your AI sessions then write back into Supabase via standard inserts.

## Claude skills

The `skills/` directory holds the AI rituals — Claude Code / Claude Desktop skills that read and write Supabase to drive the OS:

| Skill | Triggered by | What it does |
|---|---|---|
| `personalos-add-task` | "add a task", "what should I do?" | Impact-scored task intake with a suggest mode that uses the BECOME formula |
| `personalos-add-project` | "add a project", "new project" | 4-layer interview (Being/Doing/Becoming/Foundation) before any insert |
| `personalos-add-habit` | "add a habit", "track X" | 3-layer habit interview for the Soul tab |
| `personalos-snapshot` | "run today's snapshot", "yo let's go" | Generates the daily BECOME synthesis across six domains, writes to `snapshots` |
| `personalos-debrief` | "morning brief", "orient me" | One-paragraph morning orientation, writes to `debriefs` |
| `personalos-schedule` | "plan my day/week", "what should I work on" | Loads projects + tasks + calendar, builds a time-blocked plan, pushes to Google Calendar |
| `statement-importer` | "import statements", "process the pending statements" | Python script that processes bank statement PDFs from Supabase Storage and categorizes transactions with Claude |

To use them with [Claude Code](https://docs.claude.com/en/docs/claude-code/skills): copy any skill directory into `~/.claude/skills/`. To use them as `.skill` bundles in Claude Desktop or Anthropic Console: zip each directory.

Each skill's `SKILL.md` is the source of truth — the frontmatter describes triggers, and the body is the protocol Claude follows. Customize freely; the philosophy in [`BLUEPRINT.md`](./BLUEPRINT.md) is what holds them together.

## Configuration

Everything secret lives in `config.js` (gitignored). `config.example.js` shows the shape:

```js
window.PERSONAL_OS_CONFIG = {
  SUPABASE_URL: 'https://YOUR_PROJECT_REF.supabase.co',
  SUPABASE_ANON: 'YOUR_ANON_PUBLIC_KEY',
};
```

If you wire up Plaid, the Supabase edge function `plaid-sync` holds your Plaid `client_id` and `secret` server-side — they never touch the browser.

## Contributing

This started as one person's personal OS and is now open for forks. Two contributions especially welcome:

1. **`schema.sql`** — a clean Postgres schema dump so adopters can `psql < schema.sql` and go.
2. **Optional features as togglable modules.** Some tabs (Legal, Taxes, Soul) are deeply personal in shape — make them feel optional, not load-bearing.

PRs: keep the single-file philosophy (no build step, no framework). If a change requires a bundler, it's probably a fork, not a PR.

## License

[MIT](./LICENSE)
