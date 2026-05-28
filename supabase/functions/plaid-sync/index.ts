// PersonalOS — Plaid sync edge function (skeleton)
//
// Pulls new transactions from Plaid for every plaid_items row that has
// a real access_token (not 'manual_*') and inserts them into the transactions
// table. Called from the dashboard's "Sync" button on the Finance tab.
//
// Contract:
//   POST /functions/v1/plaid-sync
//   Body: {} (no input — syncs every connected item)
//   Returns: { ok: true, items: N, new_transactions: M }
//
// Required environment variables (set via `supabase secrets set`):
//   PLAID_CLIENT_ID
//   PLAID_SECRET
//   PLAID_ENV          — 'sandbox' | 'development' | 'production'
//   SUPABASE_URL       — auto-injected by Supabase
//   SUPABASE_SERVICE_ROLE_KEY  — auto-injected; bypasses RLS for writes
//
// To deploy from the repo root:
//   supabase functions deploy plaid-sync
//
// This is a SKELETON. The Plaid API call shape and transaction normalization
// are left as TODOs because they depend on your Plaid product set
// (transactions, investments, liabilities, etc.).
//
// Production checklist before depending on this:
//   - Use /transactions/sync (cursor-based) not /transactions/get
//   - Persist the cursor on plaid_items.cursor
//   - Handle Plaid webhooks for INITIAL_UPDATE / DEFAULT_UPDATE
//   - Map Plaid categories to your ai_category taxonomy

import { createClient } from "npm:@supabase/supabase-js@2";

const PLAID_CLIENT_ID = Deno.env.get("PLAID_CLIENT_ID")!;
const PLAID_SECRET = Deno.env.get("PLAID_SECRET")!;
const PLAID_ENV = Deno.env.get("PLAID_ENV") ?? "sandbox";
const PLAID_BASE = `https://${PLAID_ENV}.plaid.com`;

const supa = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

Deno.serve(async (_req) => {
  if (!PLAID_CLIENT_ID || !PLAID_SECRET) {
    return json({ ok: false, error: "Plaid credentials not configured" }, 500);
  }

  const { data: items, error } = await supa
    .from("plaid_items")
    .select("id, access_token, cursor")
    .not("access_token", "like", "manual_%");
  if (error) return json({ ok: false, error: error.message }, 500);

  let newCount = 0;
  for (const item of items ?? []) {
    // TODO: call /transactions/sync with item.access_token + item.cursor
    // TODO: insert new transactions, mark removed, update cursor
    // const res = await fetch(`${PLAID_BASE}/transactions/sync`, {
    //   method: "POST",
    //   headers: { "Content-Type": "application/json" },
    //   body: JSON.stringify({
    //     client_id: PLAID_CLIENT_ID,
    //     secret: PLAID_SECRET,
    //     access_token: item.access_token,
    //     cursor: item.cursor ?? undefined,
    //   }),
    // });
    // ...
  }

  return json({ ok: true, items: items?.length ?? 0, new_transactions: newCount });
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
