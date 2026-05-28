---
name: statement-importer
description: Process bank statement PDFs uploaded to the Personal OS vault — extract transactions, categorize with AI, and import into the finance database. Use this skill whenever the user wants to import transactions from statements, check processing status, run the statement batch processor, see how many statements are pending, retry failed imports, or asks anything about statement-to-transaction pipeline progress.
---

# Statement Transaction Importer (teenybase)

This skill processes statement PDFs that were uploaded to the Personal OS vault via the Finance tab's "Upload statement" button. It downloads each PDF, extracts every transaction, categorizes each one with Claude, and bulk-inserts them into the `transactions` table.

## Data model

| Resource | Detail |
|---|---|
| Pending source | `documents` rows where `category='statement'` and `processing_status='pending'` |
| PDF location | R2 bucket `PRIMARY_BUCKET`, fetched via `/api/v1/files/documents/{id}/{name}` |
| Script | `scripts/process_statements.py` in this skill folder |
| Transactions table | `transactions` — target, with `source='statement'`, dedup via `plaid_transaction_id = stmt_<md5>` |

## Required env vars

```bash
export PERSONAL_OS_URL="http://localhost:8787"          # or your deployed URL
export PERSONAL_OS_TOKEN="<your JWT>"                    # paste from browser cookie or login response
export ANTHROPIC_API_KEY="sk-ant-..."                    # for parsing unknown banks + categorization
```

Get `PERSONAL_OS_TOKEN`:
- Sign in at the deployed URL in your browser, open devtools → Application → Cookies → copy `personal_os_auth`
- Or `curl -X POST $PERSONAL_OS_URL/api/v1/table/users/auth/login-password -H 'Content-Type: application/json' -d '{"identity":"you@email.com","password":"..."}'` and grab `token` from the JSON

Owner_id is derived from the JWT, so all queries scope to your own user automatically.

## On Trigger — Check Status First

Always start with status to understand state:

```bash
cd ~/.claude/skills/statement-importer
python scripts/process_statements.py status
```

Then present to the user:

```
📊 Statement Processing Status
  ✅ completed    47
  ⏳ pending     607
  ❌ failed        3
  Total statements: 657
```

## Actions

### Run a batch

Process the next N pending statements. Start small to verify, then scale up:

```bash
# Dry run — parse but don't insert
python scripts/process_statements.py run --limit 5 --dry-run

# Real run
python scripts/process_statements.py run --limit 20

# Large batch (when confident)
python scripts/process_statements.py run --limit 100
```

Performance: ~30-60 seconds per statement (download + parse + categorize).
- 10 statements ≈ 5-10 min
- 100 statements ≈ 1 hour
- All 654 statements ≈ 6-10 hours (split across sessions)

### Retry failed

```bash
python scripts/process_statements.py retry
```

Resets all failed statements back to pending. Then run again — most failures are transient (network, rate limits).

### Check what was imported

```sql
-- Run via /api/v1/exec (admin) or PocketUI
SELECT ba.custom_name, ba.name,
       COUNT(t.id) AS tx_count,
       MIN(t.date) AS earliest,
       MAX(t.date) AS latest,
       SUM(t.amount) AS total_spent
FROM transactions t
LEFT JOIN bank_accounts ba ON ba.id = t.bank_account_id
WHERE t.source = 'statement'
GROUP BY ba.id, ba.custom_name, ba.name
ORDER BY tx_count DESC;
```

## How it works

1. User uploads a PDF via the Finance tab's "Upload statement" button (or via PocketUI)
2. Worker stores it in R2 and creates a `documents` row with `category='statement'`, `processing_status='pending'`
3. This script polls for pending statements, downloads each, extracts text with pdfplumber
4. Bank-specific regex parsers handle Chase, Amex, BofA; Claude handles unknowns
5. Claude Haiku categorizes transactions in batches of 50
6. Deduplication via MD5 hash of `doc_id + date + amount + description` stored in `plaid_transaction_id` (unique column)
7. The `documents` row is updated with `processing_status` and counts (`processing_found_count`, `processing_inserted_count`, `processing_skipped_count`)

## Notes vs the Supabase original

- `statement_processing_jobs` table collapsed into `documents` (processing_status, processing_found_count, etc.)
- Storage moved from Supabase Storage bucket `statements` to teenybase R2 file field on `documents`
- All queries via teenybase REST instead of PostgREST. Query syntax differs (`?where=field == 'val'` instead of `?field=eq.val`)
- Owner scoping is mandatory (multi-user ready); the script derives owner_id from the JWT

## Setup

```bash
pip install requests pdfplumber anthropic
```

Then set the env vars above and you're ready.
