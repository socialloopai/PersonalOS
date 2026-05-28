import {$Database, $Env, OpenApiExtension, PocketUIExtension, D1Adapter, teenyHono} from 'teenybase/worker'
import {getCookie} from 'hono/cookie'
import type {Context} from 'hono'
import config from 'virtual:teenybase'

type Env = $Env & {Bindings: CloudflareBindings}

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
    const cookie = getCookie(c, 'personal_os_auth')
    if (!cookie) return null
    const payload = decodeJwtPayload(cookie)
    if (!payload?.id) return null
    if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) return null
    const row = await c.env.PRIMARY_DB
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

function layout(opts: {title: string; user: User | null; path: string; body: string}): string {
    const navItem = (href: string, label: string) =>
        `<a href="${href}" ${opts.path === href ? 'class="active"' : ''}>${label}</a>`
    const nav = opts.user
        ? `${navItem('/', 'Finance')}${navItem('/legal', 'Legal')}${navItem('/taxes', 'Taxes')}${navItem('/entities', 'Entities')}${navItem('/healthtab', 'Health')}${navItem('/ask', 'Ask')}${navItem('/profile', 'Profile')}`
        : ''
    const userBox = opts.user
        ? `<span class="muted">${esc(opts.user.name || opts.user.username)}</span>&nbsp;&middot;&nbsp;<a href="/auth/logout" onclick="event.preventDefault();document.getElementById('logout-form').submit();">Sign out</a><form id="logout-form" method="post" action="/auth/logout" style="display:none"></form>`
        : `<a href="/auth/sign-in">Sign in</a>`
    return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${esc(opts.title)} · Personal OS</title><meta name="viewport" content="width=device-width,initial-scale=1"><style>${CSS}</style></head><body><header><div><strong>Personal OS</strong> &nbsp;<nav style="display:inline">${nav}</nav></div><div>${userBox}</div></header><main>${opts.body}</main></body></html>`
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
    const db = new $Database(c, config, new D1Adapter(c.env.PRIMARY_DB))
    db.extensions.push(new OpenApiExtension(db, true))
    db.extensions.push(new PocketUIExtension(db))
    return db
})

// Auth pages
app.get('/auth/sign-in', (c) => c.html(signInPage()))
app.get('/auth/sign-up', (c) => c.html(signUpPage()))

// Auth forms post to the JSON API; we proxy through so we can redirect on success.
async function proxyAuth(c: Context<Env>, endpoint: string, body: any) {
    const url = new URL(c.req.url)
    const res = await fetch(`${url.origin}/api/v1/table/users/auth/${endpoint}`, {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify(body),
    })
    return res
}

function setAuthCookie(c: Context<Env>, token: string) {
    // Mirror teenybase's authCookie config: name=personal_os_auth, Path=/, HttpOnly, SameSite=Lax
    // Secure flag omitted in dev (http://); add `Secure` when serving over HTTPS in tier 2/3.
    const maxAge = 12 * 60 * 60 // 12 hours, matches jwtTokenDuration * maxTokenRefresh
    c.header('set-cookie', `personal_os_auth=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}`)
}

app.post('/auth/sign-up', async (c) => {
    const f = await c.req.parseBody()
    const res = await proxyAuth(c, 'sign-up', {
        username: f.username, email: f.email, name: f.name,
        password: f.password, passwordConfirm: f.passwordConfirm,
    })
    if (!res.ok) {
        const txt = await res.text()
        return c.html(signUpPage(txt.slice(0, 300)))
    }
    const data = await res.json<{token: string}>()
    setAuthCookie(c, data.token)
    return c.redirect('/')
})

app.post('/auth/sign-in', async (c) => {
    const f = await c.req.parseBody()
    const res = await proxyAuth(c, 'login-password', {identity: f.identity, password: f.password})
    if (!res.ok) {
        const txt = await res.text()
        return c.html(signInPage(txt.slice(0, 300)))
    }
    const data = await res.json<{token: string}>()
    setAuthCookie(c, data.token)
    return c.redirect('/')
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

// GET / → Finance dashboard
app.get('/', async (c) => {
    const u = await requireUser(c); if (u instanceof Response) return u

    const txn = await c.env.PRIMARY_DB
        .prepare(`SELECT date, amount, name, merchant_name, ai_category, source FROM transactions WHERE owner_id = ? ORDER BY date DESC LIMIT 50`)
        .bind(u.id).all<any>()
    const transactions = txn.results || []

    const totals = await c.env.PRIMARY_DB
        .prepare(`SELECT
            COALESCE(SUM(CASE WHEN amount > 0 THEN amount ELSE 0 END), 0) as expenses,
            COALESCE(SUM(CASE WHEN amount < 0 THEN -amount ELSE 0 END), 0) as income,
            COUNT(*) as count
            FROM transactions WHERE owner_id = ?
            AND date >= date('now', 'start of month')`)
        .bind(u.id).first<any>()

    const accts = await c.env.PRIMARY_DB
        .prepare(`SELECT id, name, custom_name, type, balance_current, mask FROM bank_accounts WHERE owner_id = ?`)
        .bind(u.id).all<any>()

    const accountsHtml = (accts.results || []).length === 0
        ? '<p class="muted">No accounts yet. Connect a bank via Plaid (coming) or use the statement-importer skill to add transactions.</p>'
        : (accts.results || []).map((a: any) => `<div class="card"><div class="kpi-label">${esc(a.custom_name || a.name)} ${a.mask ? `<span class="muted">···${esc(a.mask)}</span>` : ''}</div><div class="kpi">${a.balance_current != null ? fmtUSD(a.balance_current) : '—'}</div></div>`).join('')

    const txnHtml = transactions.length === 0
        ? '<p class="muted">No transactions yet.</p>'
        : `<table><thead><tr><th>Date</th><th>Merchant</th><th>Category</th><th>Source</th><th style="text-align:right">Amount</th></tr></thead><tbody>${transactions.map((t: any) => `<tr><td class="muted">${esc(t.date)}</td><td>${esc(t.merchant_name || t.name || '—')}</td><td>${t.ai_category ? esc(t.ai_category) : '<span class="muted">—</span>'}</td><td><span class="muted">${esc(t.source)}</span></td><td style="text-align:right" class="${t.amount > 0 ? 'amount-out' : 'amount-in'}">${fmtUSD(t.amount)}</td></tr>`).join('')}</tbody></table>`

    return c.html(layout({
        title: 'Finance', user: u, path: '/',
        body: `<h1>Finance</h1>
            <div class="grid grid-3">
                <div class="card"><div class="kpi-label">Income (MTD)</div><div class="kpi">${fmtUSD(totals?.income || 0)}</div></div>
                <div class="card"><div class="kpi-label">Expenses (MTD)</div><div class="kpi">${fmtUSD(totals?.expenses || 0)}</div></div>
                <div class="card"><div class="kpi-label">Transactions (MTD)</div><div class="kpi">${totals?.count || 0}</div></div>
            </div>
            <h2>Accounts</h2><div class="grid grid-3">${accountsHtml}</div>
            <h2>Recent transactions</h2>${txnHtml}`,
    }))
})

app.get('/legal', async (c) => {
    const u = await requireUser(c); if (u instanceof Response) return u
    const cases = await c.env.PRIMARY_DB
        .prepare(`SELECT id, case_name, category, status, status_detail, next_action, next_action_date, person FROM legal_cases WHERE owner_id = ? ORDER BY priority DESC, next_action_date ASC`)
        .bind(u.id).all<any>()
    const rows = cases.results || []
    const html = rows.length === 0
        ? '<p class="muted">No cases tracked yet.</p>'
        : `<table><thead><tr><th>Case</th><th>Category</th><th>Status</th><th>Next action</th><th>By</th></tr></thead><tbody>${rows.map((r: any) => `<tr><td>${esc(r.case_name)} <span class="muted">${esc(r.person)}</span></td><td>${esc(r.category)}</td><td>${esc(r.status || '—')} <span class="muted">${esc(r.status_detail || '')}</span></td><td>${esc(r.next_action || '—')}</td><td class="muted">${esc(r.next_action_date || '—')}</td></tr>`).join('')}</tbody></table>`
    return c.html(layout({title: 'Legal', user: u, path: '/legal', body: `<h1>Legal</h1>${html}`}))
})

app.get('/taxes', async (c) => {
    const u = await requireUser(c); if (u instanceof Response) return u
    const years = await c.env.PRIMARY_DB
        .prepare(`SELECT tax_year, status, notes FROM tax_year_notes WHERE owner_id = ? ORDER BY tax_year DESC`)
        .bind(u.id).all<any>()
    const rows = years.results || []
    const html = rows.length === 0
        ? '<p class="muted">No tax years tracked yet.</p>'
        : `<table><thead><tr><th>Year</th><th>Status</th><th>Notes</th></tr></thead><tbody>${rows.map((r: any) => `<tr><td>${esc(r.tax_year)}</td><td>${esc(r.status || '—')}</td><td class="muted">${esc(r.notes || '')}</td></tr>`).join('')}</tbody></table>`
    return c.html(layout({title: 'Taxes', user: u, path: '/taxes', body: `<h1>Taxes</h1>${html}`}))
})

app.get('/entities', async (c) => {
    const u = await requireUser(c); if (u instanceof Response) return u
    const e = await c.env.PRIMARY_DB
        .prepare(`SELECT id, name, ein, state, formed_on, notes FROM business_entities WHERE owner_id = ? ORDER BY formed_on DESC`)
        .bind(u.id).all<any>()
    const rows = e.results || []
    const html = rows.length === 0
        ? '<p class="muted">No entities tracked yet.</p>'
        : `<table><thead><tr><th>Name</th><th>EIN</th><th>State</th><th>Formed</th></tr></thead><tbody>${rows.map((r: any) => `<tr><td>${esc(r.name)}</td><td class="muted">${esc(r.ein || '—')}</td><td>${esc(r.state || '—')}</td><td class="muted">${esc(r.formed_on || '—')}</td></tr>`).join('')}</tbody></table>`
    return c.html(layout({title: 'Entities', user: u, path: '/entities', body: `<h1>Business entities</h1>${html}`}))
})

// Health dashboard. Mounted at /healthtab to avoid colliding with teenybase's /api/v1/health probe.
app.get('/healthtab', async (c) => {
    const u = await requireUser(c); if (u instanceof Response) return u
    const oura = await c.env.PRIMARY_DB
        .prepare(`SELECT date, readiness_score, sleep_score, activity_score, total_sleep_hrs, rhr_bpm, hrv_ms FROM oura_daily WHERE owner_id = ? ORDER BY date DESC LIMIT 30`)
        .bind(u.id).all<any>()
    const apple = await c.env.PRIMARY_DB
        .prepare(`SELECT date, rhr_bpm, steps, active_kcal, sleep_hours, weight_kg FROM apple_health_daily WHERE owner_id = ? ORDER BY date DESC LIMIT 30`)
        .bind(u.id).all<any>()
    const renderRows = (rows: any[], headers: string[], cols: string[]) =>
        rows.length === 0 ? '<p class="muted">No data yet.</p>'
        : `<table><thead><tr>${headers.map(h => `<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${rows.map(r => `<tr>${cols.map(col => `<td>${r[col] ?? '<span class="muted">—</span>'}</td>`).join('')}</tr>`).join('')}</tbody></table>`
    return c.html(layout({
        title: 'Health', user: u, path: '/healthtab',
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
    const me = await c.env.PRIMARY_DB
        .prepare(`SELECT username, email, name, phone, citizenship, city, state, oura_access_token FROM users WHERE id = ?`)
        .bind(u.id).first<any>()
    return c.html(layout({
        title: 'Profile', user: u, path: '/profile',
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
        const rows = await c.env.PRIMARY_DB
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
        title: 'Ask', user: u, path: '/ask',
        body: `<h1>Ask</h1>
            <p class="muted">v1: keyword search across your transactions (date, merchant, category, description). LLM-backed natural language is v2.</p>
            <form method="get" action="/ask" style="max-width:600px">
                <input name="q" placeholder="e.g. coffee, blue bottle, 2022" value="${esc(q)}" autofocus>
                <button type="submit">Search</button>
            </form>
            ${answer ? `<div style="margin-top:2rem">${answer}</div>` : ''}`,
    }))
})

export default app
