# Supabase setup

PersonalOS expects a Supabase Postgres project with the schema below and a few storage buckets.

## 1. Apply the schema

```bash
# from the repo root, using the Supabase CLI:
supabase db reset --linked
# then paste schema.sql in the SQL editor, OR:
psql "$(supabase status -o env | grep DB_URL | cut -d= -f2-)" -f supabase/schema.sql
```

Or just open `supabase/schema.sql` in the Supabase dashboard SQL editor and run it.

## 2. Create the storage buckets

In Supabase dashboard → Storage, create:

| Bucket name | Used by |
|---|---|
| `identity-docs` | Profile tab — signatures, passports, IDs |
| `statements` | Finance tab — bank statement PDFs |
| `tax-docs` | Taxes tab — W-2s, 1099s, returns |
| `entity-docs` | Finance tab — LLC / business documents |

All private. The frontend uploads with the anon key and reads via signed URLs or the `/storage/v1/object/authenticated/` endpoint.

## 3. Deploy the edge functions

```bash
supabase functions deploy plaid-sync
supabase secrets set PLAID_CLIENT_ID=... PLAID_SECRET=... PLAID_ENV=sandbox
```

`plaid-sync` is a **skeleton** — see [`functions/plaid-sync/index.ts`](./functions/plaid-sync/index.ts) for what to fill in. If you don't use Plaid, you can ignore this function and use the Finance tab's manual statement-importer flow instead.

## 4. Configure the frontend

Back at the repo root, copy `config.example.js` → `config.js` and fill in your project URL + anon key.

## Security note

The schema in `schema.sql` enables RLS on every table but leaves policies wide open for the `anon` role. This matches PersonalOS's single-user design: the security model is "keep your Supabase URL and anon key private." If you ever publish your `config.js` or expose your URL, anyone can read and write your entire database.

For a multi-user or production deployment:

1. Add Supabase Auth (`signInWithPassword`) to the frontend
2. Add `owner_id uuid REFERENCES auth.users(id)` to every table
3. Replace the permissive policies with `USING (auth.uid() = owner_id)`

That's a non-trivial refactor — happy to merge a PR that does it cleanly.
