# PersonalOS

![PersonalOS dashboard](assets/banner.png)

PersonalOS keeps everything you'd otherwise lose track of in one database: bank transactions, legal cases, business entity docs, taxes, sleep score, habits, journal. Claude can answer "what did I spend on coffee in 2022" because it's all in one place.

Live demo at **https://personal-os.app.blitz.dev**. No signup, you land on Alex's seeded dashboard: 2 projects, 7 transactions, an I-140 case, two LLCs, an Oura day, a coffee habit on a 3-day streak. Try `/ask?q=coffee`.

Built on [teenybase](https://github.com/teenybase/teenybase), the open-source framework Blitz runs on. Schema and access rules in one TypeScript config, auth + REST API + R2 storage generated from that. Runs anywhere teenybase runs.

## Fork to get your own

Three deploy paths, same code.

**Local** (private, nothing leaves your laptop)

```bash
git clone https://github.com/socialloopai/PersonalOS.git
cd PersonalOS && npm install
npx teeny generate --local && npx teeny deploy --local --yes
npx teeny dev --local
```

**Blitz.dev** (persistent, accessible from your phone)

Paste into Claude Code:

```
Install the blitz skill (`npx -y @blitzdev/skill install`) and fork github.com/socialloopai/PersonalOS to a new blitz.dev slug.
```

You get your own URL with a fresh database, claimed under your Google account.

**Your own Cloudflare**

```bash
git clone https://github.com/socialloopai/PersonalOS.git
cd PersonalOS && npm install && npx wrangler login
npx teeny deploy --remote --yes
```

## What's in it

11 SSR tabs: Home (projects with Be scores), Tasks, Finance, Legal, Taxes, Entities, Health, Reflections, Soul (habits), Ask, Profile. All CRUD via plain HTML forms, no JS framework. The only client-side script is Plaid Link.

Schema is 25 tables in `modules/` plus three SQLite triggers preserving the BECOME core (`tasks_be_recompute_*`). Schema lives in `teenybase.ts`, migrations are auto-diffed by `teeny generate`.

## Integrations

- **Bank transactions**. Plaid sandbox works out of the box. Production needs your own Plaid approval (~$1-2/month). Zero-vendor path: upload statement PDFs and the `statement-importer` skill parses them with Claude.
- **Apple Health**. iOS Shortcut POSTs daily metrics to `/api/health/apple`.
- **Oura**. Paste your Personal Access Token in `/profile`, a Cloudflare cron syncs nightly.

## Claude skills

The original shipped 7 skills (add-project, add-task, add-habit, snapshot, debrief, schedule, statement-importer) that drive the OS via natural-language interviews. All ported to teenybase REST in `skills/`. Drop any folder into `~/.claude/skills/` to use with Claude Code.

See `skills/TEENYBASE-API.md` for the auth + query cheat sheet.

## Caveats

Pre-alpha. JWT signature verification is stubbed for tier-1 local (decodes payload only, marked TODO in the code). The Postgres-specific SQL in some skills (mainly `AT TIME ZONE`) is documented as "compute TZ math client-side" in the cheat sheet, the agent adapts at runtime.

## Credits

Original [PersonalOS](https://github.com/socialloopai/PersonalOS) by [@socialloopai](https://github.com/socialloopai). I ported the backend so anyone can spin up a copy on Cloudflare in under a minute. Honestly the seed flow is the only reason I sat down to do this.

[MIT](./LICENSE)
