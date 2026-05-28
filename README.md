# PersonalOS (teenybase port)

> A single-deploy personal operating system. Every domain of your life on one canvas: projects, tasks, finance, body, legal, taxes, reflections, soul. SSR Hono routes on Cloudflare Workers + D1 + R2. Schema is one config file. Open it in any agent and it knows your whole life.

This branch (`teenybase-port`) reshapes the original Supabase-based PersonalOS to run on [teenybase](https://github.com/teenybase/teenybase) — open-source Cloudflare Workers framework. Same shape of OS, same skills, runs anywhere a teenybase config runs.

## Try the live demo

**[https://personal-os.app.blitz.dev](https://personal-os.app.blitz.dev)**

Sign in: `alex@demo.personal-os.app` / `demopass123`

Pre-seeded with a fake person (Alex): 7 transactions, 2 projects + tasks with Be scores, an I-140 case, two LLCs, 2024 tax notes, Oura + Apple Health day, a habit on a 3-day streak, a reflection.

Try `/ask?q=coffee` and watch it return "Found 5 matching transactions, totaling $61.50."

The demo is hosted on [blitz.dev](https://blitz.dev), a free serverless host that runs teenybase apps. Click "Fork on blitz" from the project page to get your own copy with a fresh database in seconds.

## Tabs (11 SSR routes)

| Route | What |
|---|---|
| `/` (Home) | Projects with becoming statements + auto-recomputed Be score |
| `/tasks` | Flat task list across projects, status toggles inline |
| `/finance` | MTD income/expenses, accounts, recent transactions, statement upload, Plaid Connect |
| `/legal` | USCIS / court / permits / documents tracker |
| `/taxes` | Per-year status + notes |
| `/entities` | LLCs / C-corps with EIN, state, formation date |
| `/healthtab` | Last 30 days of Oura + Apple Health side-by-side |
| `/reflections` | Markdown journal with full-text search |
| `/soul` | Habits with one-tap daily check-in + streak |
| `/ask` | Keyword search across all transactions, with totals |
| `/profile` | Identity info + Oura PAT setting |

All CRUD via plain HTML forms. No JS framework. The only JS that ships is the Plaid Link client script (~50 lines) and the file upload progress bar.

## Three ways to run it

### 1. Local (private, no third party)

```bash
git clone https://github.com/socialloopai/PersonalOS.git
cd PersonalOS && git checkout teenybase-port
npm install
npx teeny generate --local && npx teeny deploy --local --yes
npx teeny dev --local
```

Open `http://localhost:8787`. SQLite on disk, nothing leaves your laptop.

### 2. Fork the blitz demo (easy mode, persistent, accessible from phone)

Visit the [live demo](https://personal-os.app.blitz.dev), click **Fork** from the blitz project page, and you get your own URL + a fresh database. Sign up under your own email. Free during blitz's pre-alpha period.

### 3. Your own Cloudflare account (full control)

```bash
git clone https://github.com/socialloopai/PersonalOS.git
cd PersonalOS && git checkout teenybase-port
npm install
npx wrangler login
npx teeny deploy --remote --yes
npx teeny secrets --remote --upload
```

Workers + D1 + R2 in your CF account.

## Optional integrations

| Feature | Tier 1 (local) | Tier 2/3 (deployed) | Setup |
|---|---|---|---|
| **Statement-importer** (PDF → transactions via Claude) | yes | yes | Upload PDF, run `skills/statement-importer/scripts/process_statements.py` |
| **Plaid live bank sync** | yes (with sandbox) | yes (needs Production approval) | Paste `PLAID_CLIENT_ID` + `PLAID_SECRET` into `.dev.vars` or blitz secrets |
| **Apple Health** | yes | yes | iOS Shortcut POSTs to `/api/health/apple` once daily |
| **Oura ring** | yes | yes | Paste Personal Access Token in `/profile`, daily cron syncs |

## Security

- Local: SQLite on your disk. Nothing leaves the machine.
- Blitz fork: your own claimed project, isolated D1 + R2, behind Google SSO if you enable it.
- Own CF: your account, your bindings, no shared infrastructure.

Tier 1 ships with permissive row-level rules (`'true'` everywhere) because it's single-user. For multi-user deployments, switch the rules to `auth.uid == owner_id` in each module file. Every table has `owner_id` populated from day one to make the switch trivial.

## Schema (25 tables in `modules/`)

| Module | Tables |
|---|---|
| `users.ts` | users (auth + profile fields extended) |
| `projects.ts` | projects, tasks, project_snapshots |
| `reflections-snapshots.ts` | reflections, snapshots, snapshot_runs, debriefs |
| `soul.ts` | soul_items, soul_logs, soul_item_steps, soul_step_logs |
| `health.ts` | apple_health_daily, oura_daily, nutrition_log, workouts, daily_checkin |
| `finance.ts` | plaid_items, bank_accounts, transactions, liabilities |
| `entities-legal-taxes.ts` | business_entities, legal_cases, tax_year_notes |
| `documents.ts` | documents (unified: identity / entity / tax / statement / other) |

Three SQLite triggers preserve the BECOME core: `tasks_set_completed_at_on_done`, `tasks_clear_completed_at_on_undone`, `tasks_be_recompute_*`. `be_score` auto-recomputes from active task impacts whenever a task changes.

## Claude skills (in `skills/`)

| Skill | Trigger | What it does |
|---|---|---|
| `personalos-add-task` | "add a task", "what should I do?" | Impact-scored intake + Suggest Mode via Do = Become ÷ Be |
| `personalos-add-project` | "add a project" | 4-layer interview (Being/Doing/Becoming/Foundation) |
| `personalos-add-habit` | "add a habit" | 3-layer habit interview for the Soul tab |
| `personalos-snapshot` | "yo let's go", "run the snapshot" | Daily BECOME synthesis across six domains |
| `personalos-debrief` | "morning brief", "orient me" | One-paragraph morning orientation |
| `personalos-schedule` | "plan my day/week" | Pulls projects + tasks + calendar, builds time-blocked plan |
| `statement-importer` | "import statements" | Python script: PDF → transactions, dedup via hash |

All skills now talk to teenybase REST instead of Supabase MCP. See [`skills/TEENYBASE-API.md`](./skills/TEENYBASE-API.md) for the cheat sheet (auth, query syntax, schema diffs).

Drop any skill folder into `~/.claude/skills/` to use it with Claude Code.

## Architecture diff vs original PersonalOS

| | Original | This branch |
|---|---|---|
| Backend | Supabase (Postgres + Auth + Storage + Edge Functions) | teenybase (Cloudflare Workers + D1 SQLite + R2 + Hono) |
| Frontend | 7,520-line vanilla JS SPA in `index.html` | ~1,800-line SSR Hono routes in `worker.ts` |
| Schema source | `supabase/schema.sql` (~25 tables) | `teenybase.ts` + 8 modules, same 25 tables |
| Migrations | Manual SQL | Auto-diffed by `teeny generate` |
| Statement bucket | Supabase Storage `statements` bucket | R2 file field on `documents` table |
| Auth | Permissive RLS, anon-key-secret | teenybase JWT, cookie-based, multi-user ready |
| Plaid | Edge function skeleton | Working Hono routes (`/api/plaid/link-token`, `/exchange`) |
| Cost | Free Supabase tier (limited) | Free Cloudflare Workers tier (generous) + blitz hosted |

The Be/Do/Become philosophy, the schema, the skills, the tabs, and the workflow are unchanged. What's changed is the underlying engine.

## Credits

Original [PersonalOS](https://github.com/socialloopai/PersonalOS) by [@socialloopai](https://github.com/socialloopai). This branch ports it to teenybase, then adds the SSR layer + Plaid integration + statement-importer skill port.

## License

[MIT](./LICENSE)
