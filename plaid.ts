// Minimal Plaid REST client. No SDK so it runs cleanly on Workers.
// Sandbox by default. Override PLAID_ENV in .dev.vars to "development" or "production".

type PlaidEnv = 'sandbox' | 'development' | 'production'

const HOSTS: Record<PlaidEnv, string> = {
    sandbox: 'https://sandbox.plaid.com',
    development: 'https://development.plaid.com',
    production: 'https://production.plaid.com',
}

export interface PlaidCreds {
    clientId: string
    secret: string
    env: PlaidEnv
}

async function plaid<T = any>(creds: PlaidCreds, path: string, body: any): Promise<T> {
    const res = await fetch(`${HOSTS[creds.env]}${path}`, {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({client_id: creds.clientId, secret: creds.secret, ...body}),
    })
    const text = await res.text()
    if (!res.ok) throw new Error(`plaid ${path} ${res.status}: ${text}`)
    return JSON.parse(text) as T
}

export const createLinkToken = (creds: PlaidCreds, userId: string) =>
    plaid<{link_token: string; expiration: string}>(creds, '/link/token/create', {
        client_name: 'Personal OS',
        user: {client_user_id: userId},
        products: ['transactions'],
        country_codes: ['US'],
        language: 'en',
    })

export const exchangePublicToken = (creds: PlaidCreds, public_token: string) =>
    plaid<{access_token: string; item_id: string}>(creds, '/item/public_token/exchange', {public_token})

export const itemInfo = (creds: PlaidCreds, access_token: string) =>
    plaid<{item: {institution_id: string | null}}>(creds, '/item/get', {access_token})

export const institutionGet = (creds: PlaidCreds, institution_id: string) =>
    plaid<{institution: {name: string}}>(creds, '/institutions/get_by_id', {
        institution_id, country_codes: ['US'],
    })

export const accountsGet = (creds: PlaidCreds, access_token: string) =>
    plaid<{accounts: PlaidAccount[]}>(creds, '/accounts/get', {access_token})

export const transactionsSync = (creds: PlaidCreds, access_token: string, cursor?: string) =>
    plaid<TransactionsSyncResponse>(creds, '/transactions/sync', {
        access_token, cursor: cursor || undefined,
    })

export interface PlaidAccount {
    account_id: string
    name: string
    official_name: string | null
    mask: string | null
    type: string
    subtype: string | null
    balances: {current: number | null; available: number | null}
}

export interface PlaidTransaction {
    transaction_id: string
    account_id: string
    date: string
    amount: number
    name: string
    merchant_name: string | null
    pending: boolean
    personal_finance_category: {primary: string; detailed: string} | null
}

export interface TransactionsSyncResponse {
    added: PlaidTransaction[]
    modified: PlaidTransaction[]
    removed: {transaction_id: string}[]
    next_cursor: string
    has_more: boolean
}
