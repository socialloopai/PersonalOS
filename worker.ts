import {$Database, $Env, OpenApiExtension, PocketUIExtension, teenyHono} from 'teenybase/worker'
import type {Context} from 'hono'
import config from 'virtual:teenybase'
import * as Plaid from './plaid'

// Inline cookie reader so we don't depend on hono/cookie (blitz-hosted builds
// only allow `teenybase` + relative imports).
function getCookie(c: Context<any>, name: string): string | undefined {
    const header = c.req.header('cookie') || ''
    const m = header.match(new RegExp('(?:^|; )' + name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '=([^;]*)'))
    return m ? decodeURIComponent(m[1]) : undefined
}

type Env = $Env & {
    Bindings: CloudflareBindings & {
        PLAID_CLIENT_ID?: string
        PLAID_SECRET?: string
        PLAID_ENV?: 'sandbox' | 'development' | 'production'
        // Binding names differ across deploy targets:
        //   local (wrangler.jsonc):    PRIMARY_DB, PRIMARY_BUCKET
        //   blitz.dev hosted runtime:  TEENY_PRIMARY_DB, TEENY_PRIMARY_R2
        // db() / bucket() helpers pick whichever exists.
        PRIMARY_DB?: D1Database
        PRIMARY_BUCKET?: R2Bucket
        TEENY_PRIMARY_DB?: D1Database
        TEENY_PRIMARY_R2?: R2Bucket
        // Public-demo mode: when set, every request is silently authenticated
        // as this user. Used on personal-os.app.blitz.dev so visitors don't
        // have to sign up. Forkers DO NOT inherit this — they set it (or not)
        // on their own deployment.
        DEMO_USER_ID?: string
    }
}

// Blitz's runtime hands us an RPC stub that LOOKS like D1 (it has `.prepare`)
// but `.prepare(...).bind(...).all()` chain throws because the methods aren't
// actually implemented. Instead it exposes the teenybase storage adapter
// surface (`.run(sql, args)`). We adapt by mimicking the D1 prepare/bind/all
// chain on top of `.run(...)` whenever we're on blitz.
class _CompatStmt {
    constructor(private adapter: any, private sql: string, private bindings: any[] = []) {}
    bind(...args: any[]) { return new _CompatStmt(this.adapter, this.sql, args) }
    async all<T = any>(): Promise<{results: T[]; success?: boolean; meta?: any}> {
        return this.adapter.run(this.sql, this.bindings)
    }
    async first<T = any>(): Promise<T | null> {
        const r = await this.adapter.run(this.sql, this.bindings)
        return (r?.results?.[0] as T) ?? null
    }
    async run(): Promise<any> {
        return this.adapter.run(this.sql, this.bindings)
    }
}

function wrapAdapterAsD1Like(adapter: any): D1Database {
    return {prepare(sql: string) { return new _CompatStmt(adapter, sql) as any }} as any
}

const db = (c: Context<Env>): D1Database => {
    if (c.env.TEENY_PRIMARY_DB) return wrapAdapterAsD1Like(c.env.TEENY_PRIMARY_DB)
    return c.env.PRIMARY_DB!
}
const bucket = (c: Context<Env>): R2Bucket | undefined => c.env.TEENY_PRIMARY_R2 || c.env.PRIMARY_BUCKET
const dbE = (env: any): D1Database => {
    if (env.TEENY_PRIMARY_DB) return wrapAdapterAsD1Like(env.TEENY_PRIMARY_DB)
    return env.PRIMARY_DB
}

function plaidCreds(c: Context<Env>): Plaid.PlaidCreds | null {
    const clientId = c.env.PLAID_CLIENT_ID
    const secret = c.env.PLAID_SECRET
    if (!clientId || !secret) return null
    return {clientId, secret, env: (c.env.PLAID_ENV || 'sandbox') as any}
}

// ───────────────────────────── auth helpers ─────────────────────────────
// Tier 1 (local): decode JWT payload without verifying signature.
// TODO(tier 2/3): verify HMAC against env.JWT_SECRET + env.JWT_SECRET_USERS before trusting.
type User = {id: string; username: string; email: string; name?: string | null}

function decodeJwtPayload(token: string): any | null {
    try {
        const parts = token.split('.')
        if (parts.length !== 3) return null
        const payload = parts[1].replace(/-/g, '+').replace(/_/g, '/')
        const padded = payload + '='.repeat((4 - (payload.length % 4)) % 4)
        return JSON.parse(atob(padded))
    } catch {
        return null
    }
}

async function getCurrentUser(c: Context<Env>): Promise<User | null> {
    // Demo mode short-circuit: every visitor is the seeded demo user.
    if (c.env.DEMO_USER_ID) {
        const demo = await db(c)
            .prepare(`SELECT id, username, email, name FROM users WHERE id = ?`)
            .bind(c.env.DEMO_USER_ID)
            .first<User>()
        if (demo) return demo
    }
    const cookie = getCookie(c, 'personal_os_auth')
    if (!cookie) return null
    const payload = decodeJwtPayload(cookie)
    if (!payload?.id) return null
    if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) return null
    const row = await db(c)
        .prepare(`SELECT id, username, email, name FROM users WHERE id = ?`)
        .bind(payload.id)
        .first<User>()
    return row || null
}

// ─────────────────────────────── views ──────────────────────────────────
const esc = (s: any): string =>
    String(s ?? '').replace(/[&<>"']/g, (c) => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]!))

const fmtUSD = (n: number) => new Intl.NumberFormat('en-US', {style: 'currency', currency: 'USD'}).format(n)

const CSS = `
:root { --bg:#0a0a0a; --fg:#e5e5e5; --mute:#737373; --line:#1f1f1f; --accent:#f59e0b; }
* { box-sizing: border-box; }
body { background: var(--bg); color: var(--fg); font-family: ui-sans-serif, system-ui, -apple-system, sans-serif; margin: 0; line-height: 1.5; }
a { color: var(--accent); text-decoration: none; }
a:hover { text-decoration: underline; }
header { border-bottom: 1px solid var(--line); padding: 1rem 2rem; display: flex; justify-content: space-between; align-items: center; }
nav a { margin-right: 1.25rem; color: var(--fg); font-size: 0.9rem; }
nav a.active { color: var(--accent); }
main { max-width: 1100px; margin: 0 auto; padding: 2rem; }
h1 { margin: 0 0 1.5rem; font-weight: 500; font-size: 1.5rem; }
h2 { margin: 2rem 0 0.75rem; font-weight: 500; font-size: 1.1rem; color: var(--mute); text-transform: uppercase; letter-spacing: 0.05em; }
table { width: 100%; border-collapse: collapse; font-size: 0.9rem; }
th, td { text-align: left; padding: 0.65rem 0.5rem; border-bottom: 1px solid var(--line); }
th { color: var(--mute); font-weight: 500; font-size: 0.8rem; text-transform: uppercase; letter-spacing: 0.04em; }
.muted { color: var(--mute); }
.amount-out { color: #ef4444; }
.amount-in  { color: #10b981; }
.card { border: 1px solid var(--line); border-radius: 6px; padding: 1.25rem; margin-bottom: 1rem; }
.kpi { font-size: 2rem; font-weight: 500; }
.kpi-label { color: var(--mute); font-size: 0.85rem; text-transform: uppercase; letter-spacing: 0.05em; }
.grid { display: grid; gap: 1rem; }
.grid-2 { grid-template-columns: repeat(2, 1fr); }
.grid-3 { grid-template-columns: repeat(3, 1fr); }
form { display: flex; flex-direction: column; gap: 0.75rem; max-width: 360px; }
input, textarea, select { background: #161616; border: 1px solid var(--line); color: var(--fg); padding: 0.6rem 0.75rem; border-radius: 4px; font: inherit; }
button { background: var(--accent); color: #000; border: 0; padding: 0.65rem 1rem; border-radius: 4px; font: inherit; font-weight: 500; cursor: pointer; }
button.ghost { background: transparent; color: var(--fg); border: 1px solid var(--line); }
.err { color: #ef4444; margin: 0.5rem 0; font-size: 0.9rem; }
pre { background: #161616; padding: 1rem; border-radius: 4px; overflow-x: auto; font-size: 0.85rem; }
`

function layout(opts: {title: string; user: User | null; path: string; body: string; demoMode?: boolean}): string {
    const navItem = (href: string, label: string) =>
        `<a href="${href}" ${opts.path === href ? 'class="active"' : ''}>${label}</a>`
    const nav = opts.user
        ? `${navItem('/', 'Home')}${navItem('/tasks', 'Tasks')}${navItem('/finance', 'Finance')}${navItem('/legal', 'Legal')}${navItem('/taxes', 'Taxes')}${navItem('/entities', 'Entities')}${navItem('/healthtab', 'Health')}${navItem('/reflections', 'Reflections')}${navItem('/soul', 'Soul')}${navItem('/ask', 'Ask')}${navItem('/profile', 'Profile')}`
        : ''
    const userBox = opts.demoMode
        ? `<span class="muted">demo · everyone shares this data</span>`
        : opts.user
            ? `<span class="muted">${esc(opts.user.name || opts.user.username)}</span>&nbsp;&middot;&nbsp;<a href="/auth/logout" onclick="event.preventDefault();document.getElementById('logout-form').submit();">Sign out</a><form id="logout-form" method="post" action="/auth/logout" style="display:none"></form>`
            : `<a href="/auth/sign-in">Sign in</a>`
    const banner = opts.demoMode
        ? `<div style="background:#1f1f1f;color:#f59e0b;padding:0.5rem 2rem;font-size:0.85rem;text-align:center;border-bottom:1px solid #1f1f1f">Public demo · all visitors share the same account · <a href="https://github.com/socialloopai/PersonalOS/tree/teenybase-port" style="color:#f59e0b;text-decoration:underline">fork to get your own</a></div>`
        : ''
    return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${esc(opts.title)} · Personal OS</title><meta name="viewport" content="width=device-width,initial-scale=1"><style>${CSS}</style></head><body>${banner}<header><div><strong>Personal OS</strong> &nbsp;<nav style="display:inline">${nav}</nav></div><div>${userBox}</div></header><main>${opts.body}</main></body></html>`
}

const signInPage = (err?: string) => layout({
    title: 'Sign in', user: null, path: '/auth/sign-in',
    body: `<h1>Sign in</h1>
${err ? `<p class="err">${esc(err)}</p>` : ''}
<form method="post" action="/auth/sign-in">
    <input name="identity" type="text" placeholder="Email or username" required autofocus>
    <input name="password" type="password" placeholder="Password" required>
    <button type="submit">Sign in</button>
</form>
<p class="muted" style="margin-top:1rem">No account yet? <a href="/auth/sign-up">Create one</a></p>`,
})

const signUpPage = (err?: string) => layout({
    title: 'Sign up', user: null, path: '/auth/sign-up',
    body: `<h1>Create your Personal OS</h1>
${err ? `<p class="err">${esc(err)}</p>` : ''}
<form method="post" action="/auth/sign-up">
    <input name="username" type="text" placeholder="Username" required autofocus>
    <input name="email" type="email" placeholder="Email" required>
    <input name="name" type="text" placeholder="Full name">
    <input name="password" type="password" placeholder="Password" required minlength="8">
    <input name="passwordConfirm" type="password" placeholder="Confirm password" required>
    <button type="submit">Create account</button>
</form>
<p class="muted" style="margin-top:1rem">Already have one? <a href="/auth/sign-in">Sign in</a></p>`,
})

// ────────────────────────────── app + routes ─────────────────────────────
const app = teenyHono<Env>(async (c) => {
    // Pass D1 + R2 bindings directly — blitz's runtime exposes them as RPC stubs
    // which the older D1Adapter wrapper rejects. Local wrangler still works the
    // same way; D1Adapter is only needed in non-Workers contexts.
    const $db = new $Database(c, config, db(c), bucket(c))
    $db.extensions.push(new OpenApiExtension($db, true))
    $db.extensions.push(new PocketUIExtension($db))
    return $db
})

// Auth pages — bypassed entirely when DEMO_USER_ID is set
app.get('/auth/sign-in', (c) => c.env.DEMO_USER_ID ? c.redirect('/') : c.html(signInPage()))
app.get('/auth/sign-up', (c) => c.env.DEMO_USER_ID ? c.redirect('/') : c.html(signUpPage()))

function setAuthCookie(c: Context<Env>, token: string) {
    // Mirror teenybase's authCookie config: name=personal_os_auth, Path=/, HttpOnly, SameSite=Lax.
    // Add Secure if the request came in over HTTPS (any HTTPS deploy, including blitz.dev hosted).
    const maxAge = 12 * 60 * 60
    const isHttps = new URL(c.req.url).protocol === 'https:'
    c.header('set-cookie', `personal_os_auth=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${isHttps ? '; Secure' : ''}`)
}

// Use teenybase's auth extension directly instead of same-origin fetch — blitz's
// runtime forbids the worker fetching its own /api/* (and it's faster anyway).
function authExt(c: Context<Env>): any {
    return (c.get('$db' as any) as any).table('users').extension('auth')
}

app.post('/auth/sign-up', async (c) => {
    const f = await c.req.parseBody()
    try {
        const data = await authExt(c).signUp({
            username: f.username, email: f.email, name: f.name,
            password: f.password, passwordConfirm: f.passwordConfirm,
        })
        setAuthCookie(c, data.token)
        return c.redirect('/')
    } catch (e: any) {
        return c.html(signUpPage((e?.message || String(e)).slice(0, 300)))
    }
})

app.post('/auth/sign-in', async (c) => {
    const f = await c.req.parseBody()
    try {
        const data = await authExt(c).loginWithPassword({identity: f.identity, password: f.password})
        setAuthCookie(c, data.token)
        return c.redirect('/')
    } catch (e: any) {
        return c.html(signInPage((e?.message || String(e)).slice(0, 300)))
    }
})

app.post('/auth/logout', async (c) => {
    c.header('set-cookie', 'personal_os_auth=; Path=/; HttpOnly; Max-Age=0')
    return c.redirect('/auth/sign-in')
})

async function requireUser(c: Context<Env>): Promise<User | Response> {
    const user = await getCurrentUser(c)
    if (!user) return c.redirect('/auth/sign-in')
    return user
}

async function requireUserJson(c: Context<Env>): Promise<User | Response> {
    const user = await getCurrentUser(c)
    if (!user) return c.json({error: 'not authenticated'}, 401)
    return user
}

// ────────────────────────────── Plaid routes ─────────────────────────────
app.post('/api/plaid/link-token', async (c) => {
    const u = await requireUserJson(c); if (u instanceof Response) return u
    const creds = plaidCreds(c)
    if (!creds) return c.json({error: 'Plaid not configured. Set PLAID_CLIENT_ID + PLAID_SECRET in .dev.vars'}, 500)
    try {
        const res = await Plaid.createLinkToken(creds, u.id)
        return c.json({link_token: res.link_token, expiration: res.expiration})
    } catch (e: any) {
        return c.json({error: e.message}, 500)
    }
})

// Exchanges a public_token, stores access_token, syncs accounts + transactions.
app.post('/api/plaid/exchange', async (c) => {
    const u = await requireUserJson(c); if (u instanceof Response) return u
    const creds = plaidCreds(c)
    if (!creds) return c.json({error: 'Plaid not configured'}, 500)

    const body = await c.req.json<{public_token: string}>()
    if (!body?.public_token) return c.json({error: 'missing public_token'}, 400)

    // Generate a random id helper (D1 doesn't have gen_random_uuid; teenybase autoSetUid
    // happens via REST insert path, but for direct DB writes here we generate our own).
    const newId = () => crypto.randomUUID().replace(/-/g, '').slice(0, 22)

    try {
        // 1. Exchange public_token for access_token
        const ex = await Plaid.exchangePublicToken(creds, body.public_token)

        // 2. Look up institution name (best-effort)
        let institutionName: string | null = null
        let institutionId: string | null = null
        try {
            const info = await Plaid.itemInfo(creds, ex.access_token)
            institutionId = info.item.institution_id
            if (institutionId) {
                const inst = await Plaid.institutionGet(creds, institutionId)
                institutionName = inst.institution.name
            }
        } catch (_) { /* institution lookup is best-effort */ }

        // 3. Insert plaid_items row directly (skip REST round-trip)
        const plaidItemId = newId()
        const nowIso = new Date().toISOString()
        await db(c)
            .prepare(`INSERT INTO plaid_items (id, created, updated, owner_id, institution_id, institution_name, access_token, last_synced_at)
                      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
            .bind(plaidItemId, nowIso, nowIso, u.id, institutionId, institutionName, ex.access_token, nowIso)
            .run()

        // 4. Fetch accounts and insert
        const accounts = await Plaid.accountsGet(creds, ex.access_token)
        const accountIdMap: Record<string, string> = {}
        for (const a of accounts.accounts) {
            const acctId = newId()
            await db(c)
                .prepare(`INSERT INTO bank_accounts (id, created, updated, owner_id, plaid_item_id, plaid_account_id, name, type, subtype, mask, balance_current, balance_available)
                          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
                .bind(acctId, nowIso, nowIso, u.id, plaidItemId, a.account_id, a.official_name || a.name,
                      a.type, a.subtype, a.mask, a.balances.current, a.balances.available)
                .run()
            accountIdMap[a.account_id] = acctId
        }

        // 5. Initial transactions sync (paginate until has_more = false, cap at 50 pages)
        let cursor: string | undefined = undefined
        let totalAdded = 0
        for (let i = 0; i < 50; i++) {
            const sync = await Plaid.transactionsSync(creds, ex.access_token, cursor)
            for (const t of sync.added) {
                const txnId = newId()
                await db(c)
                    .prepare(`INSERT OR IGNORE INTO transactions (id, created, updated, owner_id, bank_account_id, plaid_transaction_id, date, amount, name, merchant_name, ai_category, pending, source)
                              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'plaid')`)
                    .bind(txnId, nowIso, nowIso, u.id, accountIdMap[t.account_id] || null,
                          t.transaction_id, t.date, t.amount, t.name, t.merchant_name,
                          t.personal_finance_category?.primary?.toLowerCase() || null,
                          t.pending ? 1 : 0)
                    .run()
                totalAdded++
            }
            cursor = sync.next_cursor
            if (!sync.has_more) break
        }

        // 6. Update plaid_items with final cursor
        await db(c)
            .prepare(`UPDATE plaid_items SET cursor = ?, last_synced_at = ? WHERE id = ?`)
            .bind(cursor || '', new Date().toISOString(), plaidItemId).run()

        return c.json({
            ok: true,
            plaid_item_id: plaidItemId,
            institution: institutionName,
            accounts_added: accounts.accounts.length,
            transactions_added: totalAdded,
        })
    } catch (e: any) {
        return c.json({error: e.message || String(e)}, 500)
    }
})

// ─────────────────────── Health ingestion ────────────────────────────────
// Auth: Bearer token in Authorization header (the same JWT the cookie holds).
// iOS Shortcut posts here once per day. Fields are all optional except date.
async function getUserFromBearer(c: Context<Env>): Promise<User | null> {
    const auth = c.req.header('authorization') || c.req.header('Authorization')
    if (!auth?.startsWith('Bearer ')) return null
    const payload = decodeJwtPayload(auth.slice(7))
    if (!payload?.id) return null
    if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) return null
    return db(c).prepare(`SELECT id, username, email, name FROM users WHERE id = ?`).bind(payload.id).first<User>()
}

app.post('/api/health/apple', async (c) => {
    const u = await getUserFromBearer(c)
    if (!u) return c.json({error: 'invalid bearer token'}, 401)
    const body = await c.req.json<{
        date: string; rhr_bpm?: number; hrv_ms?: number; steps?: number;
        active_kcal?: number; sleep_hours?: number; body_fat_pct?: number; weight_kg?: number;
    }>()
    if (!body?.date) return c.json({error: 'missing date'}, 400)

    const id = crypto.randomUUID().replace(/-/g, '').slice(0, 22)
    const now = new Date().toISOString()
    await db(c)
        .prepare(`INSERT INTO apple_health_daily (id, created, updated, owner_id, date, rhr_bpm, hrv_ms, steps, active_kcal, sleep_hours, body_fat_pct, weight_kg)
                  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                  ON CONFLICT(owner_id, date) DO UPDATE SET
                    updated = excluded.updated, rhr_bpm = excluded.rhr_bpm, hrv_ms = excluded.hrv_ms,
                    steps = excluded.steps, active_kcal = excluded.active_kcal,
                    sleep_hours = excluded.sleep_hours, body_fat_pct = excluded.body_fat_pct,
                    weight_kg = excluded.weight_kg`)
        .bind(id, now, now, u.id, body.date,
              body.rhr_bpm ?? null, body.hrv_ms ?? null, body.steps ?? null,
              body.active_kcal ?? null, body.sleep_hours ?? null, body.body_fat_pct ?? null, body.weight_kg ?? null)
        .run()
    return c.json({ok: true, date: body.date})
})

// Oura sync — pulls last 30 days from Oura v2 using each user's stored PAT.
// Called by cron (scheduled handler) or manually via POST.
async function syncOuraForUser(db: D1Database, userId: string, pat: string) {
    const end = new Date().toISOString().slice(0, 10)
    const start = new Date(Date.now() - 30 * 86400 * 1000).toISOString().slice(0, 10)
    const headers = {Authorization: `Bearer ${pat}`}
    const fetchOura = (path: string) =>
        fetch(`https://api.ouraring.com/v2/usercollection/${path}?start_date=${start}&end_date=${end}`, {headers})
            .then(r => r.ok ? r.json<{data: any[]}>() : Promise.reject(`oura ${path} ${r.status}`))
    const [readiness, sleep, activity] = await Promise.all([
        fetchOura('daily_readiness').catch(() => ({data: []})),
        fetchOura('daily_sleep').catch(() => ({data: []})),
        fetchOura('daily_activity').catch(() => ({data: []})),
    ])
    const byDate = new Map<string, any>()
    for (const r of readiness.data) byDate.set(r.day, {...byDate.get(r.day), readiness_score: r.score, rhr_bpm: r.contributors?.resting_heart_rate, hrv_ms: r.contributors?.hrv_balance})
    for (const s of sleep.data) byDate.set(s.day, {...byDate.get(s.day), sleep_score: s.score, total_sleep_hrs: s.contributors?.total_sleep ? s.contributors.total_sleep / 60 : null})
    for (const a of activity.data) byDate.set(a.day, {...byDate.get(a.day), activity_score: a.score})
    let upserts = 0
    for (const [date, row] of byDate.entries()) {
        const id = crypto.randomUUID().replace(/-/g, '').slice(0, 22)
        const now = new Date().toISOString()
        await db.prepare(`INSERT INTO oura_daily (id, created, updated, owner_id, date, readiness_score, sleep_score, activity_score, total_sleep_hrs, rhr_bpm, hrv_ms)
                          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                          ON CONFLICT(owner_id, date) DO UPDATE SET
                            updated = excluded.updated, readiness_score = excluded.readiness_score,
                            sleep_score = excluded.sleep_score, activity_score = excluded.activity_score,
                            total_sleep_hrs = excluded.total_sleep_hrs, rhr_bpm = excluded.rhr_bpm,
                            hrv_ms = excluded.hrv_ms`)
            .bind(id, now, now, userId, date,
                  row.readiness_score ?? null, row.sleep_score ?? null, row.activity_score ?? null,
                  row.total_sleep_hrs ?? null, row.rhr_bpm ?? null, row.hrv_ms ?? null).run()
        upserts++
    }
    return upserts
}

app.post('/api/health/oura/sync', async (c) => {
    const u = await getUserFromBearer(c) || await getCurrentUser(c)
    if (!u) return c.json({error: 'not authenticated'}, 401)
    const row = await db(c).prepare(`SELECT oura_access_token FROM users WHERE id = ?`).bind(u.id).first<{oura_access_token: string | null}>()
    const pat = row?.oura_access_token
    if (!pat) return c.json({error: 'no Oura PAT set on /profile'}, 400)
    try {
        const upserts = await syncOuraForUser(db(c), u.id, pat)
        return c.json({ok: true, days_upserted: upserts})
    } catch (e: any) {
        return c.json({error: e.message || String(e)}, 500)
    }
})

// ─────────────────────── Statement upload (first-class) ─────────────────
// Multipart form POST. Stores PDF in R2, inserts documents row pending parsing.
app.post('/documents/upload', async (c) => {
    const u = await requireUser(c); if (u instanceof Response) return u
    const bucket = bucket(c)
    if (!bucket) return c.html(layout({title: 'Upload', user: u, path: '/', demoMode: !!c.env.DEMO_USER_ID, body: '<h1>Upload failed</h1><p class="err">R2 bucket not bound. Run <code>teeny deploy --local</code> after adding the binding.</p>'}), 500)

    const form = await c.req.parseBody()
    const file = form.file as File | undefined
    if (!file) return c.redirect('/finance?upload=missing')
    if (!file.name.toLowerCase().endsWith('.pdf')) return c.redirect('/finance?upload=not_pdf')

    const docId = crypto.randomUUID().replace(/-/g, '').slice(0, 22)
    const r2Key = `documents/${u.id}/${docId}/${file.name}`
    await bucket.put(r2Key, file.stream(), {httpMetadata: {contentType: 'application/pdf'}})

    const category = (form.category as string) || 'statement'
    const nowIso = new Date().toISOString()
    await db(c)
        .prepare(`INSERT INTO documents (id, created, updated, owner_id, category, label, file, file_name, file_size_bytes, processing_status)
                  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .bind(docId, nowIso, nowIso, u.id, category, form.label || file.name, r2Key, file.name, file.size,
              category === 'statement' ? 'pending' : null)
        .run()

    return c.redirect('/finance?upload=ok')
})

// GET / → Home (projects dashboard with BECOME scores)
app.get('/', async (c) => {
    const u = await requireUser(c); if (u instanceof Response) return u
    const projs = await db(c)
        .prepare(`SELECT p.id, p.name, p.becoming_statement, p.category, p.status, p.priority, p.be_score, p.due_date,
                         (SELECT COUNT(*) FROM tasks WHERE project_id = p.id AND status NOT IN ('done','cancelled')) AS open_tasks
                  FROM projects p WHERE p.owner_id = ? AND p.status = 'active' ORDER BY p.be_score DESC, p.created DESC`)
        .bind(u.id).all<any>()
    const rows = projs.results || []
    const projCards = rows.length === 0
        ? `<p class="muted">No active projects yet. Use the <code>personalos-add-project</code> skill or the form below to create one.</p>`
        : `<div class="grid grid-2">${rows.map((p: any) => `
            <div class="card">
                <div style="display:flex;justify-content:space-between;align-items:baseline">
                    <strong>${esc(p.name)}</strong>
                    <span class="muted" style="font-size:0.8rem">${esc(p.category || '')}</span>
                </div>
                ${p.becoming_statement ? `<p class="muted" style="margin:0.5rem 0;font-style:italic">"${esc(p.becoming_statement)}"</p>` : ''}
                <div style="display:flex;gap:1rem;margin-top:0.75rem;font-size:0.85rem">
                    <span>Be <strong style="color:var(--accent)">${(p.be_score || 0).toFixed(1)}</strong></span>
                    <span class="muted">${p.open_tasks || 0} open task${p.open_tasks === 1 ? '' : 's'}</span>
                    ${p.due_date ? `<span class="muted">due ${esc(p.due_date)}</span>` : ''}
                </div>
                <div style="margin-top:0.75rem;display:flex;gap:0.5rem">
                    <a href="/tasks?project=${encodeURIComponent(p.id)}" style="font-size:0.85rem">View tasks →</a>
                    <form method="post" action="/projects/${p.id}/archive" style="display:inline;max-width:none"><button type="submit" class="ghost" style="font-size:0.8rem;padding:0.25rem 0.5rem">Archive</button></form>
                </div>
            </div>`).join('')}</div>`

    const addForm = `<form method="post" action="/projects/new" style="max-width:520px">
        <input name="name" placeholder="Project name" required>
        <textarea name="becoming_statement" placeholder="Becoming statement (who does this make you?)" rows="2"></textarea>
        <textarea name="description" placeholder="Definition of done (one sentence)" rows="2"></textarea>
        <input name="category" placeholder="Category (business/health/finance/...)">
        <input name="due_date" type="date">
        <button type="submit">Add project</button>
    </form>`

    return c.html(layout({title: 'Home', user: u, path: '/', demoMode: !!c.env.DEMO_USER_ID, body: `<h1>Projects</h1>${projCards}<h2>Add a project</h2>${addForm}`}))
})

app.post('/projects/new', async (c) => {
    const u = await requireUser(c); if (u instanceof Response) return u
    const f = await c.req.parseBody()
    const id = crypto.randomUUID().replace(/-/g, '').slice(0, 22)
    const now = new Date().toISOString()
    await db(c)
        .prepare(`INSERT INTO projects (id, created, updated, owner_id, name, becoming_statement, description, category, status, priority, due_date)
                  VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active', 'medium', ?)`)
        .bind(id, now, now, u.id, f.name, f.becoming_statement || null, f.description || null, f.category || null, f.due_date || null)
        .run()
    return c.redirect('/')
})

app.post('/projects/:id/archive', async (c) => {
    const u = await requireUser(c); if (u instanceof Response) return u
    await db(c).prepare(`UPDATE projects SET status = 'archived' WHERE id = ? AND owner_id = ?`).bind(c.req.param('id'), u.id).run()
    return c.redirect('/')
})

// GET /tasks → flat task list across all projects, optionally filtered by project_id
app.get('/tasks', async (c) => {
    const u = await requireUser(c); if (u instanceof Response) return u
    const projectFilter = c.req.query('project')
    const where = projectFilter ? `t.owner_id = ? AND t.project_id = ?` : `t.owner_id = ?`
    const bind = projectFilter ? [u.id, projectFilter] : [u.id]
    const tasks = await db(c)
        .prepare(`SELECT t.id, t.name, t.status, t.priority, t.impact, t.due_date, t.completed_at, t.project_id, p.name AS project_name
                  FROM tasks t JOIN projects p ON p.id = t.project_id WHERE ${where}
                  ORDER BY CASE t.status WHEN 'in_progress' THEN 0 WHEN 'todo' THEN 1 WHEN 'done' THEN 2 ELSE 3 END,
                           t.impact DESC NULLS LAST, t.due_date ASC NULLS LAST`)
        .bind(...bind).all<any>()
    const rows = tasks.results || []
    const projs = await db(c)
        .prepare(`SELECT id, name FROM projects WHERE owner_id = ? AND status = 'active' ORDER BY name`)
        .bind(u.id).all<any>()
    const projOptions = (projs.results || []).map((p: any) => `<option value="${esc(p.id)}"${p.id === projectFilter ? ' selected' : ''}>${esc(p.name)}</option>`).join('')

    const rowsHtml = rows.length === 0
        ? '<p class="muted">No tasks yet.</p>'
        : `<table><thead><tr><th>Task</th><th>Project</th><th>Status</th><th>Impact</th><th>Due</th><th></th></tr></thead><tbody>
            ${rows.map((t: any) => `<tr>
                <td>${esc(t.name)}</td>
                <td class="muted">${esc(t.project_name)}</td>
                <td><form method="post" action="/tasks/${t.id}/status" style="display:inline;max-width:none">
                    <select name="status" onchange="this.form.submit()">
                        ${['todo','in_progress','done','cancelled'].map(s => `<option value="${s}"${t.status === s ? ' selected' : ''}>${s}</option>`).join('')}
                    </select>
                </form></td>
                <td>${t.impact != null ? `<strong>${t.impact}</strong>` : '<span class="muted">—</span>'}</td>
                <td class="muted">${esc(t.due_date || '—')}</td>
                <td><form method="post" action="/tasks/${t.id}/delete" style="display:inline;max-width:none"><button type="submit" class="ghost" style="font-size:0.75rem;padding:0.2rem 0.5rem">×</button></form></td>
            </tr>`).join('')}</tbody></table>`

    const addForm = `<form method="post" action="/tasks/new" style="max-width:520px">
        <select name="project_id" required><option value="">Project…</option>${projOptions.replace(/ selected/g, '')}</select>
        <input name="name" placeholder="Task name" required>
        <div style="display:flex;gap:0.5rem">
            <select name="impact" style="flex:1"><option value="">Impact…</option>
                <option value="5">5 Foundation</option><option value="4">4 Leverage</option>
                <option value="3">3 Progress</option><option value="2">2 Support</option><option value="1">1 Maintenance</option>
            </select>
            <select name="priority" style="flex:1"><option value="medium">medium</option><option value="critical">critical</option><option value="high">high</option><option value="low">low</option></select>
            <input name="due_date" type="date" style="flex:1">
        </div>
        <button type="submit">Add task</button>
    </form>`

    const filterBar = `<form method="get" action="/tasks" style="flex-direction:row;align-items:center;gap:0.75rem;max-width:none">
        <label class="muted">Project:</label>
        <select name="project" onchange="this.form.submit()"><option value="">All</option>${projOptions}</select>
    </form>`

    return c.html(layout({title: 'Tasks', user: u, path: '/tasks', demoMode: !!c.env.DEMO_USER_ID, body: `<h1>Tasks</h1>${filterBar}${rowsHtml}<h2>Add a task</h2>${addForm}`}))
})

app.post('/tasks/new', async (c) => {
    const u = await requireUser(c); if (u instanceof Response) return u
    const f = await c.req.parseBody()
    if (!f.project_id || !f.name) return c.redirect('/tasks')
    const id = crypto.randomUUID().replace(/-/g, '').slice(0, 22)
    const now = new Date().toISOString()
    await db(c)
        .prepare(`INSERT INTO tasks (id, created, updated, owner_id, project_id, name, status, priority, impact, due_date)
                  VALUES (?, ?, ?, ?, ?, ?, 'todo', ?, ?, ?)`)
        .bind(id, now, now, u.id, f.project_id, f.name,
              f.priority || 'medium', f.impact ? Number(f.impact) : null, f.due_date || null)
        .run()
    return c.redirect('/tasks')
})

app.post('/tasks/:id/status', async (c) => {
    const u = await requireUser(c); if (u instanceof Response) return u
    const f = await c.req.parseBody()
    await db(c).prepare(`UPDATE tasks SET status = ?, updated = ? WHERE id = ? AND owner_id = ?`)
        .bind(f.status as string, new Date().toISOString(), c.req.param('id'), u.id).run()
    return c.redirect(c.req.header('referer') || '/tasks')
})

app.post('/tasks/:id/delete', async (c) => {
    const u = await requireUser(c); if (u instanceof Response) return u
    await db(c).prepare(`DELETE FROM tasks WHERE id = ? AND owner_id = ?`).bind(c.req.param('id'), u.id).run()
    return c.redirect(c.req.header('referer') || '/tasks')
})

// GET /reflections → list + add textarea
app.get('/reflections', async (c) => {
    const u = await requireUser(c); if (u instanceof Response) return u
    const refs = await db(c)
        .prepare(`SELECT id, content, created FROM reflections WHERE owner_id = ? ORDER BY created DESC LIMIT 50`)
        .bind(u.id).all<any>()
    const rows = refs.results || []
    const list = rows.length === 0
        ? '<p class="muted">No reflections yet.</p>'
        : rows.map((r: any) => `<div class="card">
            <div class="muted" style="font-size:0.85rem">${esc(r.created)}</div>
            <div style="white-space:pre-wrap;margin-top:0.5rem">${esc(r.content)}</div>
            <form method="post" action="/reflections/${r.id}/delete" style="margin-top:0.5rem;max-width:none"><button type="submit" class="ghost" style="font-size:0.75rem;padding:0.2rem 0.5rem">delete</button></form>
        </div>`).join('')

    const form = `<form method="post" action="/reflections/new" style="max-width:none">
        <textarea name="content" rows="8" placeholder="What's the day asking of you?" required></textarea>
        <button type="submit" style="align-self:flex-start">Save reflection</button>
    </form>`
    return c.html(layout({title: 'Reflections', user: u, path: '/reflections', demoMode: !!c.env.DEMO_USER_ID, body: `<h1>Reflections</h1>${form}<h2>Recent</h2>${list}`}))
})

app.post('/reflections/new', async (c) => {
    const u = await requireUser(c); if (u instanceof Response) return u
    const f = await c.req.parseBody()
    if (!f.content) return c.redirect('/reflections')
    const id = crypto.randomUUID().replace(/-/g, '').slice(0, 22)
    const now = new Date().toISOString()
    await db(c)
        .prepare(`INSERT INTO reflections (id, created, updated, owner_id, content) VALUES (?, ?, ?, ?, ?)`)
        .bind(id, now, now, u.id, f.content).run()
    return c.redirect('/reflections')
})

app.post('/reflections/:id/delete', async (c) => {
    const u = await requireUser(c); if (u instanceof Response) return u
    await db(c).prepare(`DELETE FROM reflections WHERE id = ? AND owner_id = ?`).bind(c.req.param('id'), u.id).run()
    return c.redirect('/reflections')
})

// GET /soul → habits list with one-tap "did it today" form
app.get('/soul', async (c) => {
    const u = await requireUser(c); if (u instanceof Response) return u
    const today = new Date().toISOString().slice(0, 10)
    const items = await db(c)
        .prepare(`SELECT s.id, s.name, s.becoming_connection, s.frequency, s.time_of_day, s.streak, s.best_streak, s.status,
                         (SELECT COUNT(*) FROM soul_logs WHERE soul_item_id = s.id AND completed_at = ?) AS done_today
                  FROM soul_items s WHERE s.owner_id = ? AND s.status = 'active'
                  ORDER BY s.created DESC`)
        .bind(today, u.id).all<any>()
    const rows = items.results || []
    const list = rows.length === 0
        ? '<p class="muted">No habits yet. Use <code>personalos-add-habit</code> or the form below.</p>'
        : `<div class="grid grid-2">${rows.map((s: any) => `<div class="card">
            <div style="display:flex;justify-content:space-between;align-items:baseline">
                <strong>${esc(s.name)}</strong>
                <span class="muted" style="font-size:0.8rem">${esc(s.frequency || '')} ${esc(s.time_of_day || '')}</span>
            </div>
            ${s.becoming_connection ? `<p class="muted" style="margin:0.5rem 0;font-style:italic">${esc(s.becoming_connection)}</p>` : ''}
            <div style="display:flex;gap:1rem;margin-top:0.75rem;font-size:0.85rem">
                <span>Streak <strong style="color:var(--accent)">${s.streak || 0}</strong></span>
                <span class="muted">Best ${s.best_streak || 0}</span>
            </div>
            <form method="post" action="/soul/${s.id}/checkin" style="margin-top:0.75rem;max-width:none">
                <button type="submit" ${s.done_today ? 'disabled' : ''} style="${s.done_today ? 'background:#10b981;color:#fff' : ''}">${s.done_today ? 'Done today ✓' : 'Mark today done'}</button>
            </form>
        </div>`).join('')}</div>`

    const addForm = `<form method="post" action="/soul/new" style="max-width:520px">
        <input name="name" placeholder="Habit name" required>
        <textarea name="becoming_connection" placeholder="What does this prove about who you are?" rows="2"></textarea>
        <input name="frequency" placeholder="Frequency (daily/weekly/...)">
        <input name="time_of_day" placeholder="Time of day (morning/evening/...)">
        <button type="submit">Add habit</button>
    </form>`
    return c.html(layout({title: 'Soul', user: u, path: '/soul', demoMode: !!c.env.DEMO_USER_ID, body: `<h1>Soul</h1>${list}<h2>Add a habit</h2>${addForm}`}))
})

app.post('/soul/new', async (c) => {
    const u = await requireUser(c); if (u instanceof Response) return u
    const f = await c.req.parseBody()
    if (!f.name) return c.redirect('/soul')
    const id = crypto.randomUUID().replace(/-/g, '').slice(0, 22)
    const now = new Date().toISOString()
    await db(c)
        .prepare(`INSERT INTO soul_items (id, created, updated, owner_id, type, name, becoming_connection, frequency, time_of_day, status, streak, best_streak)
                  VALUES (?, ?, ?, ?, 'habit', ?, ?, ?, ?, 'active', 0, 0)`)
        .bind(id, now, now, u.id, f.name, f.becoming_connection || null, f.frequency || null, f.time_of_day || null)
        .run()
    return c.redirect('/soul')
})

app.post('/soul/:id/checkin', async (c) => {
    const u = await requireUser(c); if (u instanceof Response) return u
    const today = new Date().toISOString().slice(0, 10)
    const itemId = c.req.param('id')
    const logId = crypto.randomUUID().replace(/-/g, '').slice(0, 22)
    const now = new Date().toISOString()
    try {
        await db(c)
            .prepare(`INSERT INTO soul_logs (id, created, updated, owner_id, soul_item_id, completed_at) VALUES (?, ?, ?, ?, ?, ?)`)
            .bind(logId, now, now, u.id, itemId, today).run()
        // Bump streak (simple incremental; doesn't account for missed days)
        await db(c)
            .prepare(`UPDATE soul_items SET streak = streak + 1, best_streak = MAX(best_streak, streak + 1) WHERE id = ? AND owner_id = ?`)
            .bind(itemId, u.id).run()
    } catch (_) { /* already checked in today (unique constraint) */ }
    return c.redirect('/soul')
})

// GET /finance → Finance dashboard (was at /)
app.get('/finance', async (c) => {
    const u = await requireUser(c); if (u instanceof Response) return u

    const txn = await db(c)
        .prepare(`SELECT date, amount, name, merchant_name, ai_category, source FROM transactions WHERE owner_id = ? ORDER BY date DESC LIMIT 50`)
        .bind(u.id).all<any>()
    const transactions = txn.results || []

    const totals = await db(c)
        .prepare(`SELECT
            COALESCE(SUM(CASE WHEN amount > 0 THEN amount ELSE 0 END), 0) as expenses,
            COALESCE(SUM(CASE WHEN amount < 0 THEN -amount ELSE 0 END), 0) as income,
            COUNT(*) as count
            FROM transactions WHERE owner_id = ?
            AND date >= date('now', 'start of month')`)
        .bind(u.id).first<any>()

    const accts = await db(c)
        .prepare(`SELECT id, name, custom_name, type, balance_current, mask FROM bank_accounts WHERE owner_id = ?`)
        .bind(u.id).all<any>()

    const stmts = await db(c)
        .prepare(`SELECT processing_status, COUNT(*) as n FROM documents WHERE owner_id = ? AND category = 'statement' GROUP BY processing_status`)
        .bind(u.id).all<any>()
    const stmtCounts: Record<string, number> = {}
    for (const row of stmts.results || []) stmtCounts[row.processing_status || 'pending'] = row.n

    const uploadParam = c.req.query('upload')
    const uploadBanner = uploadParam === 'ok'
        ? '<p style="color:#10b981">Statement uploaded. Run the statement-importer skill to parse it into transactions.</p>'
        : uploadParam === 'missing' ? '<p class="err">No file selected.</p>'
        : uploadParam === 'not_pdf' ? '<p class="err">Only PDF files supported.</p>' : ''

    const hasAccounts = (accts.results || []).length > 0
    const connectBtn = `<button id="plaid-connect" type="button">Connect a bank account</button>
        <span id="plaid-status" class="muted" style="margin-left:1rem"></span>
        <script src="https://cdn.plaid.com/link/v2/stable/link-initialize.js"></script>
        <script>
        document.getElementById('plaid-connect').addEventListener('click', async () => {
            const btn = document.getElementById('plaid-connect')
            const status = document.getElementById('plaid-status')
            btn.disabled = true; status.textContent = 'Loading Plaid…'
            try {
                const r = await fetch('/api/plaid/link-token', {method: 'POST'})
                const j = await r.json()
                if (!r.ok) { status.textContent = 'Error: ' + (j.error || r.status); btn.disabled = false; return }
                const handler = Plaid.create({
                    token: j.link_token,
                    onSuccess: async (public_token) => {
                        status.textContent = 'Linking bank, syncing transactions…'
                        const ex = await fetch('/api/plaid/exchange', {
                            method: 'POST', headers: {'Content-Type': 'application/json'},
                            body: JSON.stringify({public_token})
                        })
                        const exj = await ex.json()
                        if (!ex.ok) { status.textContent = 'Exchange failed: ' + (exj.error || ex.status); btn.disabled = false; return }
                        status.textContent = 'Connected ' + (exj.institution || 'bank') + '. ' + exj.transactions_added + ' transactions imported.'
                        setTimeout(() => location.reload(), 800)
                    },
                    onExit: (err) => { if (err) status.textContent = 'Cancelled: ' + err.error_message; btn.disabled = false },
                })
                handler.open()
            } catch (e) {
                status.textContent = 'Error: ' + e.message; btn.disabled = false
            }
        })
        </script>`
    const accountsHtml = hasAccounts
        ? `<div class="grid grid-3">${(accts.results || []).map((a: any) => `<div class="card"><div class="kpi-label">${esc(a.custom_name || a.name)} ${a.mask ? `<span class="muted">···${esc(a.mask)}</span>` : ''}</div><div class="kpi">${a.balance_current != null ? fmtUSD(a.balance_current) : '—'}</div></div>`).join('')}</div><div style="margin-top:1rem">${connectBtn}</div>`
        : `<p class="muted">No accounts connected yet.</p>${connectBtn}`

    const txnHtml = transactions.length === 0
        ? '<p class="muted">No transactions yet.</p>'
        : `<table><thead><tr><th>Date</th><th>Merchant</th><th>Category</th><th>Source</th><th style="text-align:right">Amount</th></tr></thead><tbody>${transactions.map((t: any) => `<tr><td class="muted">${esc(t.date)}</td><td>${esc(t.merchant_name || t.name || '—')}</td><td>${t.ai_category ? esc(t.ai_category) : '<span class="muted">—</span>'}</td><td><span class="muted">${esc(t.source)}</span></td><td style="text-align:right" class="${t.amount > 0 ? 'amount-out' : 'amount-in'}">${fmtUSD(t.amount)}</td></tr>`).join('')}</tbody></table>`

    const stmtSummary = Object.keys(stmtCounts).length === 0
        ? '<p class="muted">No statements uploaded yet.</p>'
        : `<p class="muted">${(stmtCounts.pending || 0)} pending, ${(stmtCounts.completed || 0)} completed${stmtCounts.failed ? `, <span style="color:#ef4444">${stmtCounts.failed} failed</span>` : ''}.</p>`

    const uploadForm = `<form method="post" action="/documents/upload" enctype="multipart/form-data" style="flex-direction:row;align-items:center;gap:0.75rem;max-width:none">
        <input type="file" name="file" accept=".pdf" required style="flex:1">
        <button type="submit">Upload statement</button>
    </form>
    <p class="muted" style="font-size:0.85rem;margin-top:0.5rem">PDF goes to your vault as <code>category=statement</code>, <code>processing_status=pending</code>. Run the <code>statement-importer</code> skill (or ask Claude) to parse pending statements into transactions.</p>`

    return c.html(layout({
        title: 'Finance', user: u, path: '/', demoMode: !!c.env.DEMO_USER_ID,
        body: `<h1>Finance</h1>
            ${uploadBanner}
            <div class="grid grid-3">
                <div class="card"><div class="kpi-label">Income (MTD)</div><div class="kpi">${fmtUSD(totals?.income || 0)}</div></div>
                <div class="card"><div class="kpi-label">Expenses (MTD)</div><div class="kpi">${fmtUSD(totals?.expenses || 0)}</div></div>
                <div class="card"><div class="kpi-label">Transactions (MTD)</div><div class="kpi">${totals?.count || 0}</div></div>
            </div>
            <h2>Statements</h2>${stmtSummary}${uploadForm}
            <h2>Accounts</h2>${accountsHtml}
            <h2>Recent transactions</h2>${txnHtml}`,
    }))
})

app.get('/legal', async (c) => {
    const u = await requireUser(c); if (u instanceof Response) return u
    const cases = await db(c)
        .prepare(`SELECT id, case_name, category, status, status_detail, next_action, next_action_date, person FROM legal_cases WHERE owner_id = ? ORDER BY priority DESC, next_action_date ASC`)
        .bind(u.id).all<any>()
    const rows = cases.results || []
    const html = rows.length === 0
        ? '<p class="muted">No cases tracked yet.</p>'
        : `<table><thead><tr><th>Case</th><th>Category</th><th>Status</th><th>Next action</th><th>By</th><th></th></tr></thead><tbody>${rows.map((r: any) => `<tr><td>${esc(r.case_name)} <span class="muted">${esc(r.person)}</span></td><td>${esc(r.category)}</td><td>${esc(r.status || '—')} <span class="muted">${esc(r.status_detail || '')}</span></td><td>${esc(r.next_action || '—')}</td><td class="muted">${esc(r.next_action_date || '—')}</td><td><form method="post" action="/legal/${r.id}/delete" style="display:inline;max-width:none"><button type="submit" class="ghost" style="font-size:0.75rem;padding:0.2rem 0.5rem">×</button></form></td></tr>`).join('')}</tbody></table>`
    const form = `<form method="post" action="/legal/new" style="max-width:520px">
        <input name="case_name" placeholder="Case name (e.g. I-140 EB1A)" required>
        <div style="display:flex;gap:0.5rem">
            <select name="category" style="flex:1" required><option value="uscis">USCIS</option><option value="court">Court</option><option value="permit">Permit</option><option value="document">Document</option><option value="other">Other</option></select>
            <select name="person" style="flex:1"><option value="self">Self</option><option value="dependent">Dependent</option></select>
            <select name="priority" style="flex:1"><option value="medium">medium</option><option value="critical">critical</option><option value="high">high</option><option value="low">low</option></select>
        </div>
        <div style="display:flex;gap:0.5rem">
            <input name="receipt_number" placeholder="Receipt #" style="flex:1">
            <input name="filing_date" type="date" style="flex:1">
        </div>
        <input name="status" placeholder="Status (Pending / Approved / ...)">
        <input name="next_action" placeholder="Next action">
        <input name="next_action_date" type="date">
        <button type="submit">Add case</button>
    </form>`
    return c.html(layout({title: 'Legal', user: u, path: '/legal', demoMode: !!c.env.DEMO_USER_ID, body: `<h1>Legal</h1>${html}<h2>Add case</h2>${form}`}))
})

app.post('/legal/new', async (c) => {
    const u = await requireUser(c); if (u instanceof Response) return u
    const f = await c.req.parseBody()
    const id = crypto.randomUUID().replace(/-/g, '').slice(0, 22)
    const now = new Date().toISOString()
    await db(c)
        .prepare(`INSERT INTO legal_cases (id, created, updated, owner_id, person, category, case_name, receipt_number, filing_date, status, priority, next_action, next_action_date)
                  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .bind(id, now, now, u.id, f.person || 'self', f.category, f.case_name,
              f.receipt_number || null, f.filing_date || null, f.status || null,
              f.priority || 'medium', f.next_action || null, f.next_action_date || null)
        .run()
    return c.redirect('/legal')
})

app.post('/legal/:id/delete', async (c) => {
    const u = await requireUser(c); if (u instanceof Response) return u
    await db(c).prepare(`DELETE FROM legal_cases WHERE id = ? AND owner_id = ?`).bind(c.req.param('id'), u.id).run()
    return c.redirect('/legal')
})

app.get('/taxes', async (c) => {
    const u = await requireUser(c); if (u instanceof Response) return u
    const years = await db(c)
        .prepare(`SELECT id, tax_year, status, notes FROM tax_year_notes WHERE owner_id = ? ORDER BY tax_year DESC`)
        .bind(u.id).all<any>()
    const rows = years.results || []
    const html = rows.length === 0
        ? '<p class="muted">No tax years tracked yet.</p>'
        : `<table><thead><tr><th>Year</th><th>Status</th><th>Notes</th><th></th></tr></thead><tbody>${rows.map((r: any) => `<tr><td>${esc(r.tax_year)}</td><td>${esc(r.status || '—')}</td><td class="muted">${esc(r.notes || '')}</td><td><form method="post" action="/taxes/${r.id}/delete" style="display:inline;max-width:none"><button type="submit" class="ghost" style="font-size:0.75rem;padding:0.2rem 0.5rem">×</button></form></td></tr>`).join('')}</tbody></table>`
    const form = `<form method="post" action="/taxes/new" style="max-width:520px">
        <div style="display:flex;gap:0.5rem">
            <input name="tax_year" type="number" placeholder="Year" required style="flex:1">
            <select name="status" style="flex:2"><option value="not_started">not_started</option><option value="in_progress">in_progress</option><option value="filed">filed</option><option value="closed">closed</option></select>
        </div>
        <textarea name="notes" placeholder="Notes" rows="2"></textarea>
        <button type="submit">Add tax year</button>
    </form>`
    return c.html(layout({title: 'Taxes', user: u, path: '/taxes', demoMode: !!c.env.DEMO_USER_ID, body: `<h1>Taxes</h1>${html}<h2>Add year</h2>${form}`}))
})

app.post('/taxes/new', async (c) => {
    const u = await requireUser(c); if (u instanceof Response) return u
    const f = await c.req.parseBody()
    const id = crypto.randomUUID().replace(/-/g, '').slice(0, 22)
    const now = new Date().toISOString()
    await db(c)
        .prepare(`INSERT INTO tax_year_notes (id, created, updated, owner_id, tax_year, status, notes) VALUES (?, ?, ?, ?, ?, ?, ?)`)
        .bind(id, now, now, u.id, Number(f.tax_year), f.status || 'not_started', f.notes || null).run()
    return c.redirect('/taxes')
})

app.post('/taxes/:id/delete', async (c) => {
    const u = await requireUser(c); if (u instanceof Response) return u
    await db(c).prepare(`DELETE FROM tax_year_notes WHERE id = ? AND owner_id = ?`).bind(c.req.param('id'), u.id).run()
    return c.redirect('/taxes')
})

app.get('/entities', async (c) => {
    const u = await requireUser(c); if (u instanceof Response) return u
    const e = await db(c)
        .prepare(`SELECT id, name, ein, state, formed_on, notes FROM business_entities WHERE owner_id = ? ORDER BY formed_on DESC`)
        .bind(u.id).all<any>()
    const rows = e.results || []
    const html = rows.length === 0
        ? '<p class="muted">No entities tracked yet.</p>'
        : `<table><thead><tr><th>Name</th><th>EIN</th><th>State</th><th>Formed</th><th></th></tr></thead><tbody>${rows.map((r: any) => `<tr><td>${esc(r.name)}</td><td class="muted">${esc(r.ein || '—')}</td><td>${esc(r.state || '—')}</td><td class="muted">${esc(r.formed_on || '—')}</td><td><form method="post" action="/entities/${r.id}/delete" style="display:inline;max-width:none"><button type="submit" class="ghost" style="font-size:0.75rem;padding:0.2rem 0.5rem">×</button></form></td></tr>`).join('')}</tbody></table>`
    const form = `<form method="post" action="/entities/new" style="max-width:520px">
        <input name="name" placeholder="Entity name (e.g. Demo Holdings LLC)" required>
        <div style="display:flex;gap:0.5rem">
            <input name="ein" placeholder="EIN" style="flex:1">
            <input name="state" placeholder="State (DE/CA/...)" style="flex:1">
            <input name="formed_on" type="date" style="flex:1">
        </div>
        <textarea name="notes" placeholder="Notes" rows="2"></textarea>
        <button type="submit">Add entity</button>
    </form>`
    return c.html(layout({title: 'Entities', user: u, path: '/entities', demoMode: !!c.env.DEMO_USER_ID, body: `<h1>Business entities</h1>${html}<h2>Add entity</h2>${form}`}))
})

app.post('/entities/new', async (c) => {
    const u = await requireUser(c); if (u instanceof Response) return u
    const f = await c.req.parseBody()
    const id = crypto.randomUUID().replace(/-/g, '').slice(0, 22)
    const now = new Date().toISOString()
    await db(c)
        .prepare(`INSERT INTO business_entities (id, created, updated, owner_id, name, ein, state, formed_on, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .bind(id, now, now, u.id, f.name, f.ein || null, f.state || null, f.formed_on || null, f.notes || null).run()
    return c.redirect('/entities')
})

app.post('/entities/:id/delete', async (c) => {
    const u = await requireUser(c); if (u instanceof Response) return u
    await db(c).prepare(`DELETE FROM business_entities WHERE id = ? AND owner_id = ?`).bind(c.req.param('id'), u.id).run()
    return c.redirect('/entities')
})

// Health dashboard. Mounted at /healthtab to avoid colliding with teenybase's /api/v1/health probe.
app.get('/healthtab', async (c) => {
    const u = await requireUser(c); if (u instanceof Response) return u
    const oura = await db(c)
        .prepare(`SELECT date, readiness_score, sleep_score, activity_score, total_sleep_hrs, rhr_bpm, hrv_ms FROM oura_daily WHERE owner_id = ? ORDER BY date DESC LIMIT 30`)
        .bind(u.id).all<any>()
    const apple = await db(c)
        .prepare(`SELECT date, rhr_bpm, steps, active_kcal, sleep_hours, weight_kg FROM apple_health_daily WHERE owner_id = ? ORDER BY date DESC LIMIT 30`)
        .bind(u.id).all<any>()
    const renderRows = (rows: any[], headers: string[], cols: string[]) =>
        rows.length === 0 ? '<p class="muted">No data yet.</p>'
        : `<table><thead><tr>${headers.map(h => `<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${rows.map(r => `<tr>${cols.map(col => `<td>${r[col] ?? '<span class="muted">—</span>'}</td>`).join('')}</tr>`).join('')}</tbody></table>`
    return c.html(layout({
        title: 'Health', user: u, path: '/healthtab', demoMode: !!c.env.DEMO_USER_ID,
        body: `<h1>Health</h1>
            <h2>Oura — last 30 days</h2>
            ${renderRows(oura.results || [], ['Date', 'Readiness', 'Sleep', 'Activity', 'Sleep hrs', 'RHR', 'HRV'], ['date', 'readiness_score', 'sleep_score', 'activity_score', 'total_sleep_hrs', 'rhr_bpm', 'hrv_ms'])}
            <h2>Apple Health — last 30 days</h2>
            ${renderRows(apple.results || [], ['Date', 'RHR', 'Steps', 'Active kcal', 'Sleep hrs', 'Weight kg'], ['date', 'rhr_bpm', 'steps', 'active_kcal', 'sleep_hours', 'weight_kg'])}
            <p class="muted" style="margin-top:2rem">Apple data lands via iOS Shortcut POSTs. Oura syncs daily via cron + your Personal Access Token (set in <a href="/profile">Profile</a>).</p>`,
    }))
})

app.get('/profile', async (c) => {
    const u = await requireUser(c); if (u instanceof Response) return u
    const me = await db(c)
        .prepare(`SELECT username, email, name, phone, citizenship, city, state, oura_access_token FROM users WHERE id = ?`)
        .bind(u.id).first<any>()
    return c.html(layout({
        title: 'Profile', user: u, path: '/profile', demoMode: !!c.env.DEMO_USER_ID,
        body: `<h1>Profile</h1>
            <div class="card">
                <p><strong>${esc(me?.name || me?.username)}</strong></p>
                <p class="muted">${esc(me?.email)}</p>
                <p>Phone: ${esc(me?.phone || '—')}</p>
                <p>Citizenship: ${esc(me?.citizenship || '—')}</p>
                <p>Location: ${esc([me?.city, me?.state].filter(Boolean).join(', ') || '—')}</p>
                <p>Oura PAT: ${me?.oura_access_token ? '<span style="color:#10b981">configured</span>' : '<span class="muted">not set</span>'}</p>
            </div>
            <p class="muted">Profile editing UI is on the v1.1 roadmap. For now edit via PocketUI at <a href="/api/v1/pocket/">/api/v1/pocket/</a>.</p>`,
    }))
})

app.get('/ask', async (c) => {
    const u = await requireUser(c); if (u instanceof Response) return u
    const q = c.req.query('q') || ''
    let answer = ''
    if (q) {
        const like = `%${q.toLowerCase()}%`
        const rows = await db(c)
            .prepare(`SELECT date, amount, merchant_name, name, ai_category FROM transactions WHERE owner_id = ? AND (
                LOWER(name) LIKE ? OR LOWER(merchant_name) LIKE ? OR LOWER(ai_category) LIKE ? OR LOWER(description) LIKE ?
            ) ORDER BY date DESC LIMIT 50`)
            .bind(u.id, like, like, like, like)
            .all<any>()
        const list = rows.results || []
        const total = list.reduce((s: number, r: any) => s + (r.amount || 0), 0)
        answer = `<p>Found <strong>${list.length}</strong> matching transactions, totaling <strong class="amount-out">${fmtUSD(total)}</strong>.</p>${list.length ? `<table><thead><tr><th>Date</th><th>Merchant</th><th>Category</th><th style="text-align:right">Amount</th></tr></thead><tbody>${list.map((r: any) => `<tr><td class="muted">${esc(r.date)}</td><td>${esc(r.merchant_name || r.name || '—')}</td><td>${esc(r.ai_category || '—')}</td><td style="text-align:right">${fmtUSD(r.amount)}</td></tr>`).join('')}</tbody></table>` : ''}`
    }
    return c.html(layout({
        title: 'Ask', user: u, path: '/ask', demoMode: !!c.env.DEMO_USER_ID,
        body: `<h1>Ask</h1>
            <p class="muted">v1: keyword search across your transactions (date, merchant, category, description). LLM-backed natural language is v2.</p>
            <form method="get" action="/ask" style="max-width:600px">
                <input name="q" placeholder="e.g. coffee, blue bottle, 2022" value="${esc(q)}" autofocus>
                <button type="submit">Search</button>
            </form>
            ${answer ? `<div style="margin-top:2rem">${answer}</div>` : ''}`,
    }))
})

// Cron handler — runs daily at 09:00 UTC per wrangler.jsonc triggers.crons.
// Pulls Oura data for every user that has set a PAT.
export default {
    fetch: app.fetch,
    async scheduled(_event: ScheduledEvent, env: CloudflareBindings, _ctx: ExecutionContext) {
        const users = await dbE(env)
            .prepare(`SELECT id, oura_access_token FROM users WHERE oura_access_token IS NOT NULL AND oura_access_token != ''`)
            .all<{id: string; oura_access_token: string}>()
        for (const u of users.results || []) {
            try {
                await syncOuraForUser(dbE(env), u.id, u.oura_access_token)
            } catch (e) {
                console.error(`Oura sync failed for user ${u.id}:`, e)
            }
        }
    },
}
