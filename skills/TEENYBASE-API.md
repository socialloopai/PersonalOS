# Personal OS API — quick reference for skills

All PersonalOS skills talk to a teenybase backend (Cloudflare Workers + D1 SQLite). This file is the cheat sheet every skill in `skills/` references.

## Setup

```bash
export PERSONAL_OS_URL="http://localhost:8787"   # or your deployed URL
export PERSONAL_OS_TOKEN="<your JWT>"            # see "Getting a token" below
```

Owner scoping is automatic via JWT — every read/write happens as you.

## Getting a token

Two options:
1. **Browser cookie**: sign in at the URL, open devtools → Application → Cookies → copy the value of `personal_os_auth`.
2. **Login API**:
   ```bash
   curl -X POST $PERSONAL_OS_URL/api/v1/table/users/auth/login-password \
     -H 'Content-Type: application/json' \
     -d '{"identity":"you@example.com","password":"..."}' \
     | python3 -c "import json,sys;print(json.load(sys.stdin)['token'])"
   ```

## REST query patterns

| What | Endpoint | Notes |
|---|---|---|
| List rows | `GET /api/v1/table/{name}/list?where=...&order=...&limit=...` | Returns `{items, total}`. |
| Select rows | `GET /api/v1/table/{name}/select?where=...&order=...&limit=...` | Returns array. |
| View one | `GET /api/v1/table/{name}/view/{id}` | |
| Insert | `POST /api/v1/table/{name}/insert` with `{"values": {...}, "returning": "*"}` | |
| Edit one | `POST /api/v1/table/{name}/edit/{id}` with `{"field": "value"}` | |
| Update many | `POST /api/v1/table/{name}/update` with `{"where": "...", "setValues": {...}}` | |
| Delete | `POST /api/v1/table/{name}/delete` with `{"where": "..."}` | |
| Files | `GET /api/v1/files/{table}/{id}/{file_name}` | R2-backed downloads |

All requests need `Authorization: Bearer $PERSONAL_OS_TOKEN`.

## Where-expression syntax (NOT PostgREST)

teenybase uses JS-like expressions, not PostgREST's `field=eq.val`:

| Want | teenybase |
|---|---|
| equals | `status == 'pending'` |
| not equals | `status != 'done'` |
| in set | `status in ['todo','in_progress']` |
| compound | `status == 'pending' & owner_id == 'X'` |
| or | `(status == 'todo') \| (status == 'in_progress')` |
| null | `parent_id == null` |
| not null | `parent_id != null` |
| like | `name ~ '%coffee%'` |
| fts | `content @@ 'reflection'` |

URL-encode the whole `where` value.

## SQL differences from Postgres

The original PersonalOS was Postgres. teenybase is SQLite. Watch for:

- **No `AT TIME ZONE`**. Do TZ math in the client (Python/JS) before sending dates.
- **No `now()` function in `where`**. Use `CURRENT_TIMESTAMP` or pass an ISO string.
- **No `interval`**. Compute date arithmetic in client.
- **No `uuid[]` arrays**. JSON-stringified arrays in TEXT columns. Use `json_extract(reflection_ids, '$[0]')` if you need to drill in.
- **`jsonb` → `json`**. Same syntax mostly, `json_extract(col, '$.path')`.
- **No `gen_random_uuid()`**. teenybase auto-assigns IDs via `autoSetUid: true`.
- **Upsert syntax**: `INSERT INTO t (...) VALUES (...) ON CONFLICT(col) DO UPDATE SET col = excluded.col` (same as Postgres for the common case).

## Schema changes from the original PersonalOS

Mostly identical. Notable differences:

- **`profile` is folded into `users`** (extra cols: phone, citizenship, address, ssn_last4, signature_file, resting_hr_bpm, oura_access_token).
- **`identity_documents`, `entity_documents`, `tax_documents`, `bank_statements` are folded into `documents`** with a `category` enum (`identity` / `entity` / `tax` / `statement` / `other`) and polymorphic FK fields (`entity_id`, `legal_case_id`, `bank_account_id`, `tax_year`).
- **`statement_processing_jobs` is folded into `documents`** as `processing_status` / `processing_found_count` / `processing_inserted_count` / `processing_skipped_count` / `processing_error` fields.
- **All tables have `owner_id`** (FK to `users`). Always include in inserts.
- Everything else (`projects`, `tasks`, `project_snapshots`, `reflections`, `snapshots`, `snapshot_runs`, `debriefs`, `soul_items`, `soul_logs`, `soul_item_steps`, `soul_step_logs`, `legal_cases`, `business_entities`, `tax_year_notes`, `plaid_items`, `bank_accounts`, `transactions`, `liabilities`, `apple_health_daily`, `oura_daily`, `nutrition_log`, `workouts`, `daily_checkin`) preserves its original shape.

## Examples

**Load active projects with their tasks:**
```bash
PROJECTS=$(curl -s -H "Authorization: Bearer $PERSONAL_OS_TOKEN" \
  "$PERSONAL_OS_URL/api/v1/table/projects/list?where=status%20%3D%3D%20%27active%27&order=-created")
echo "$PROJECTS" | python3 -c "import json,sys;d=json.load(sys.stdin);print(len(d['items']),'projects')"
```

**Insert a task:**
```bash
curl -s -X POST -H "Authorization: Bearer $PERSONAL_OS_TOKEN" -H 'Content-Type: application/json' \
  "$PERSONAL_OS_URL/api/v1/table/tasks/insert" \
  -d '{"values":{"owner_id":"<your_id>","project_id":"<proj_id>","name":"Ship the thing","impact":5,"priority":"critical","due_date":"2026-06-01"}}'
```

**Bucket reflections by narrative day (PT, 4am cutoff) — TZ math in client:**
```python
# Compute narrative_day in Python, then query teenybase by exact match
from datetime import datetime, timedelta
import zoneinfo
pt = zoneinfo.ZoneInfo("America/Los_Angeles")
narrative_day = (datetime.now(pt) - timedelta(hours=4)).strftime("%Y-%m-%d")
# Then for each reflection from /api/v1/table/reflections/list, bucket its created date the same way in Python
```
