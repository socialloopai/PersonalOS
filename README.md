# PersonalOS

![PersonalOS dashboard](assets/banner.png)

PersonalOS keeps everything you'd otherwise lose track of in one database: bank transactions, legal cases, business entity docs, taxes, sleep score, habits, journal. Claude can answer "what did I spend on coffee in 2022" because it's all in one place.

Live demo at **https://personal-os.app.blitz.dev**. 

## Fork to make your own

**Local** (private, nothing leaves your laptop)

```bash
git clone https://github.com/socialloopai/PersonalOS.git
cd PersonalOS && npm install
npx teeny generate --local && npx teeny deploy --local --yes
npx teeny dev --local
```

**Claude sets it up on Cloudflare** (persistent on the cloud accessible from your phone)

Paste into Claude Code:

```
Clone github.com/socialloopai/PersonalOS and deploy it to a new Blitz project running on Cloudflare. Install the blitz skill (`npx -y @blitzdev/skill install`) and use it first. 
```

Blitz is an infracturcture service lets Claude Code provisions a ready-made backend on Cloudflare so you do zero manual setup. Each Blitz project packages a Cloudflare Worker, SQLite database (D1), file storage (R2), and a live `<slug>.app.blitz.dev` URL. Claude uses Blitz to work on your personalOS immediately instead of doing any infrastructure setup. 


**Self-hosted on Cloudflare**

```bash
git clone https://github.com/socialloopai/PersonalOS.git
cd PersonalOS && npm install && npx wrangler login
npx teeny deploy --remote --yes
```

## What's in it

11 tabs: Home (projects with Be scores), Tasks, Finance, Legal, Taxes, Entities, Health, Reflections, Soul (habits), Ask, Profile. All CRUD via plain HTML forms, no JS framework. The only client-side script is Plaid Link.

## Integrations

- **Bank transactions**. Plaid sandbox works out of the box. Production needs your own Plaid approval (~$1-2/month). Zero-vendor path: upload statement PDFs and the `statement-importer` skill parses them with Claude.
- **Apple Health**. iOS Shortcut POSTs daily metrics to `/api/health/apple`.
- **Oura**. Paste your Personal Access Token in `/profile`, a Cloudflare cron syncs nightly.

## Connecting your real bank (Plaid Production)

The demo and a fresh install both run in Plaid sandbox by default. Fake banks, fake transactions, test login is `user_good` / `pass_good`. To wire up your actual Chase or BofA you need Plaid Production access. It is real and free to apply for, here is the path:

1. Sign up at https://dashboard.plaid.com/signup
2. In the dashboard, go to Team Settings → Keys. Sandbox creds are there immediately. Production starts disabled.
3. Click "Request Production". Plaid asks what you're building. "Personal finance dashboard for my own bank accounts" is the truthful answer that usually gets approved in 1 to 5 business days.
4. Once approved, copy the Production `client_id` and `secret` and set them on your deployment:
   - **Local**: edit `.dev.vars` with `PLAID_CLIENT_ID=...`, `PLAID_SECRET=...`, `PLAID_ENV=production`, restart `teeny dev --local`.
   - **Blitz fork**: on the blitz.dev project page, add `PLAID_CLIENT_ID` and `PLAID_SECRET` as secrets and `PLAID_ENV=production` as a var, then commit to redeploy.
   - **Self-hosted Cloudflare**: same as local but put the values in `.prod.vars`, then `npx teeny secrets --remote --upload`.
5. Click "Connect a bank account" on the Finance tab. Real Plaid Link opens, log in to your bank normally.

Pricing for personal use is roughly $0.30 per connected item per month plus per-API-call fees. Three or four banks tends to run $1 to $2 per month. Sandbox stays free indefinitely.

## Claude skills

The original shipped 7 skills (add-project, add-task, add-habit, snapshot, debrief, schedule, statement-importer) that drive the OS via natural-language interviews. All ported to teenybase REST in `skills/`. Drop any folder into `~/.claude/skills/` to use with Claude Code.

See `skills/TEENYBASE-API.md` for the auth + query cheat sheet.

## License

[MIT](./LICENSE)
