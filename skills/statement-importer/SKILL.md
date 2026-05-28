---
name: statement-importer
description: Process bank statement PDFs uploaded to Supabase Storage — extract transactions, categorize with AI, and import into the PersonalOS finance database. Use this skill whenever the user wants to import transactions from statements, check processing status, run the statement batch processor, see how many statements are pending, retry failed imports, or asks anything about statement-to-transaction pipeline progress.
---

# Statement Transaction Importer

This skill processes bank statement PDFs that have been uploaded to Supabase Storage, extracts every transaction, categorizes each one with Claude, and bulk-inserts them into the `transactions` table.

## Infrastructure

| Resource | Detail |
|---|---|
| Supabase project | `YOUR_SUPABASE_PROJECT_REF` |
| Storage bucket | `statements` |
| Jobs table | `statement_processing_jobs` — tracks status per statement |
| Script | `scripts/process_statements.py` in this skill folder |
| Transactions table | `transactions` — target, with `source='statement'` |

## How it works

1. Every uploaded statement gets a row in `statement_processing_jobs` (status: `pending`) — auto-triggered by DB trigger
2. The script downloads each PDF from Storage, extracts text with pdfplumber
3. Bank-specific regex parsers handle Chase, Amex, BofA; Claude handles unknowns
4. Claude Haiku categorizes transactions in batches of 50
5. Deduplication via MD5 hash of `statement_id + date + amount + description`
6. Results tracked per job: found / inserted / skipped (duplicates)

## On Trigger — Check Status First

Always start by running status to understand where things stand:

```bash
cd ~/.claude/skills/statement-importer
ANTHROPIC_API_KEY="$ANTHROPIC_API_KEY" python scripts/process_statements.py status
```

Then present the summary to the user:
```
📊 Statement Processing Status
  ✅ completed    47
  ⏳ pending     607
  ❌ failed        3
  Total jobs:    657
```

## Actions

### Run a batch

Process the next N pending statements. Start with a small batch (5-10) to verify, then scale up:

```bash
# Test run — parse but don't insert
ANTHROPIC_API_KEY="$ANTHROPIC_API_KEY" python scripts/process_statements.py run --limit 5 --dry-run

# Real run
ANTHROPIC_API_KEY="$ANTHROPIC_API_KEY" python scripts/process_statements.py run --limit 20

# Large batch (when confident)
ANTHROPIC_API_KEY="$ANTHROPIC_API_KEY" python scripts/process_statements.py run --limit 100
```

**Performance estimate:** ~30-60 seconds per statement (download + parse + categorize).
- 10 statements ≈ 5-10 min
- 100 statements ≈ 1 hour
- All 654 statements ≈ 6-10 hours (run in multiple sessions)

### Retry failed

```bash
ANTHROPIC_API_KEY="$ANTHROPIC_API_KEY" python scripts/process_statements.py retry
```
Then run again — most failures are transient (network, rate limits).

### Process specific account

```bash
ANTHROPIC_API_KEY="$ANTHROPIC_API_KEY" python scripts/process_statements.py run --limit 50 --account b1bb2698-4594-4503-853c-ea0973ead9e3
```

### Check what was imported

```sql
SELECT 
  ba.custom_name, ba.name,
  COUNT(t.id) as tx_count,
  MIN(t.date) as earliest,
  MAX(t.date) as latest,
  SUM(t.amount) as total_spent
FROM transactions t
JOIN bank_statements bs ON bs.id = t.statement_id
JOIN bank_accounts ba ON ba.id = bs.bank_account_id
WHERE t.source = 'statement'
GROUP BY ba.id, ba.custom_name, ba.name
ORDER BY tx_count DESC;
```

## ANTHROPIC_API_KEY

The script needs Claude for categorization and fallback parsing. Before running, set the key:
```bash
export ANTHROPIC_API_KEY="your-key-here"
```

Or ask the user for the key if not available in environment.

## Bank format notes

| Bank | Parser | Notes |
|---|---|---|
| Chase | Regex: `MM/DD description amount` | Reliable, year from statement header |
| Amex | Regex: `M/D/YY description $amount` | Some statements use different spacing |
| BofA | Regex: `MM/DD/YYYY description amount` | Includes full year |
| Unknown | Claude Haiku fallback | Slower, costs API credits |

## After a big batch

After processing many statements, tell the user:
- How many transactions imported
- Date range covered
- Any failures to retry
- Suggest refreshing Finance tab (it reads live from DB)

## Scanned PDFs

Statements where text extraction returns blank are marked `skipped`. These are image-based PDFs — they'd need OCR (Tesseract) to process. Flag them and offer to handle separately if needed.

## Auto-processing new uploads

The DB trigger `on_statement_uploaded` automatically creates a `pending` job whenever a new statement is uploaded via the Finance tab. To process new uploads, just run the skill — it picks up new pending jobs automatically.
