#!/usr/bin/env python3
"""
Statement Transaction Importer
Processes bank statement PDFs from Supabase Storage,
extracts transactions, categorizes with Claude, inserts to DB.
"""
import os, re, json, time, hashlib, tempfile, sys, argparse
from datetime import datetime
from pathlib import Path

import requests
import pdfplumber

# ── Config ─────────────────────────────────────────────────────────────────
# Set these as environment variables before running.
SUPABASE_URL = os.environ.get("SUPABASE_URL", "")
SUPABASE_ANON = os.environ.get("SUPABASE_ANON", "")
ANTHROPIC_API_KEY = os.environ.get("ANTHROPIC_API_KEY", "")
if not SUPABASE_URL or not SUPABASE_ANON:
    sys.exit("Set SUPABASE_URL and SUPABASE_ANON env vars before running.")

HEADERS = {
    "apikey": SUPABASE_ANON,
    "Authorization": f"Bearer {SUPABASE_ANON}",
    "Content-Type": "application/json",
}

CATEGORIES = [
    "Rent/Housing", "Groceries", "Restaurants/Dining", "Coffee/Cafes",
    "Gas/Fuel", "Auto/Parking", "Public Transit/Rideshare",
    "Shopping/Retail", "Amazon/Online Shopping", "Clothing",
    "Entertainment/Subscriptions", "Health/Pharmacy/Medical",
    "Gym/Fitness", "Travel/Hotels/Airlines", "Utilities/Phone/Internet",
    "Business", "Software/Tech", "ATM/Cash",
    "Credit Card Payment", "Bank Transfer", "Income/Deposit",
    "Fees/Interest", "Insurance", "Education", "Gifts/Donations", "Other"
]

# ── DB helpers ──────────────────────────────────────────────────────────────
def sb_get(path, params=None):
    r = requests.get(f"{SUPABASE_URL}/rest/v1/{path}", headers=HEADERS, params=params)
    r.raise_for_status()
    return r.json()

def sb_post(path, data):
    r = requests.post(f"{SUPABASE_URL}/rest/v1/{path}", headers={**HEADERS, "Prefer": "return=minimal"}, json=data)
    r.raise_for_status()
    return r

def sb_patch(path, data, params=None):
    r = requests.patch(f"{SUPABASE_URL}/rest/v1/{path}", headers={**HEADERS, "Prefer": "return=minimal"}, json=data, params=params)
    r.raise_for_status()
    return r

def update_job(job_id, **kwargs):
    sb_patch("statement_processing_jobs", kwargs, params={"id": f"eq.{job_id}"})

# ── PDF Download ────────────────────────────────────────────────────────────
def download_pdf(file_path: str) -> bytes:
    url = f"{SUPABASE_URL}/storage/v1/object/statements/{file_path}"
    r = requests.get(url, headers={"Authorization": f"Bearer {SUPABASE_ANON}", "apikey": SUPABASE_ANON})
    r.raise_for_status()
    return r.content

# ── PDF Text Extraction ─────────────────────────────────────────────────────
def extract_text(pdf_bytes: bytes) -> str:
    with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False) as f:
        f.write(pdf_bytes)
        tmp = f.name
    try:
        text = ""
        with pdfplumber.open(tmp) as pdf:
            for page in pdf.pages:
                t = page.extract_text()
                if t:
                    text += t + "\n"
        return text
    finally:
        os.unlink(tmp)

# ── Bank-specific Transaction Parsers ───────────────────────────────────────
# Chase Checking / Freedom / Sapphire
CHASE_TX_RE = re.compile(
    r'^(\d{2}/\d{2})\s+(.+?)\s+(-?\$?[\d,]+\.\d{2})\s*$', re.MULTILINE
)
# Amex — date format M/D/YY or M/D/YYYY
AMEX_TX_RE = re.compile(
    r'^(\d{1,2}/\d{1,2}/\d{2,4})\s+(.+?)\s+\$?([\d,]+\.\d{2})\s*$', re.MULTILINE
)
# BofA
BOFA_TX_RE = re.compile(
    r'^(\d{2}/\d{2}/\d{4})\s+(.+?)\s+(-?[\d,]+\.\d{2})\s*$', re.MULTILINE
)

def detect_bank(text: str) -> str:
    t = text[:2000].lower()
    if "chase" in t or "jpmorgan" in t: return "chase"
    if "american express" in t or "amex" in t: return "amex"
    if "bank of america" in t: return "bofa"
    if "apple card" in t: return "apple"
    if "wells fargo" in t: return "wellsfargo"
    return "unknown"

def parse_year_from_text(text: str, statement_date: str) -> str:
    """Extract year from statement header or use statement_date year."""
    # Try to find "January 2024" or "01/2024" style
    m = re.search(r'(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{4})', text[:1000], re.IGNORECASE)
    if m: return m.group(2)
    if statement_date:
        return statement_date[:4]
    return str(datetime.now().year)

def normalize_amount(raw: str) -> float:
    """Convert string like '-$1,234.56' to float 1234.56 (positive = expense)."""
    raw = raw.replace("$", "").replace(",", "").strip()
    val = float(raw)
    return abs(val)  # store as positive, credits handled separately

def parse_chase(text: str, year: str) -> list[dict]:
    txns = []
    for m in CHASE_TX_RE.finditer(text):
        date_str, desc, amount_str = m.group(1), m.group(2).strip(), m.group(3)
        try:
            date = datetime.strptime(f"{date_str}/{year}", "%m/%d/%Y").strftime("%Y-%m-%d")
            amount = normalize_amount(amount_str)
            if desc and amount > 0:
                txns.append({"date": date, "description": desc, "amount": amount})
        except:
            continue
    return txns

def parse_amex(text: str) -> list[dict]:
    txns = []
    for m in AMEX_TX_RE.finditer(text):
        date_str, desc, amount_str = m.group(1), m.group(2).strip(), m.group(3)
        try:
            fmt = "%m/%d/%y" if len(date_str.split("/")[2]) == 2 else "%m/%d/%Y"
            date = datetime.strptime(date_str, fmt).strftime("%Y-%m-%d")
            amount = normalize_amount(amount_str)
            if desc and amount > 0:
                txns.append({"date": date, "description": desc, "amount": amount})
        except:
            continue
    return txns

def parse_bofa(text: str) -> list[dict]:
    txns = []
    for m in BOFA_TX_RE.finditer(text):
        date_str, desc, amount_str = m.group(1), m.group(2).strip(), m.group(3)
        try:
            date = datetime.strptime(date_str, "%m/%d/%Y").strftime("%Y-%m-%d")
            amount = normalize_amount(amount_str)
            if desc and amount > 0:
                txns.append({"date": date, "description": desc, "amount": amount})
        except:
            continue
    return txns

def claude_parse(text: str, bank: str, statement_date: str) -> list[dict]:
    """Fallback: ask Claude to extract transactions from raw text."""
    if not ANTHROPIC_API_KEY:
        return []
    import anthropic
    client = anthropic.Anthropic(api_key=ANTHROPIC_API_KEY)
    prompt = f"""Extract all transactions from this {bank} bank statement.
Return ONLY a JSON array, no explanation. Each item: {{"date":"YYYY-MM-DD","description":"merchant name","amount":123.45}}
Amount is always positive. Skip payments, credits, and balance lines.
Statement period around: {statement_date}

STATEMENT TEXT:
{text[:8000]}

JSON array:"""
    try:
        msg = client.messages.create(
            model="claude-haiku-4-5-20251001",
            max_tokens=4096,
            messages=[{"role": "user", "content": prompt}]
        )
        raw = msg.content[0].text.strip()
        start = raw.find("[")
        end = raw.rfind("]") + 1
        if start >= 0 and end > start:
            return json.loads(raw[start:end])
    except Exception as e:
        print(f"    Claude parse error: {e}")
    return []

def extract_transactions(text: str, bank: str, statement_date: str) -> list[dict]:
    year = parse_year_from_text(text, statement_date)
    if bank == "chase":
        txns = parse_chase(text, year)
    elif bank == "amex":
        txns = parse_amex(text)
    elif bank == "bofa":
        txns = parse_bofa(text)
    else:
        txns = []
    # Fallback to Claude if regex got nothing
    if not txns:
        txns = claude_parse(text, bank, statement_date)
    return txns

# ── Claude Categorization ───────────────────────────────────────────────────
def categorize_batch(transactions: list[dict]) -> list[str]:
    """Send a batch of transactions to Claude for categorization."""
    if not ANTHROPIC_API_KEY or not transactions:
        return ["Other"] * len(transactions)
    import anthropic
    client = anthropic.Anthropic(api_key=ANTHROPIC_API_KEY)
    items = "\n".join(
        f"{i+1}. {t['date']} | {t['description']} | ${t['amount']:.2f}"
        for i, t in enumerate(transactions)
    )
    cats = ", ".join(CATEGORIES)
    prompt = f"""Categorize each transaction below. Return ONLY a JSON array of strings (one category per transaction, same order).
Valid categories: {cats}

Transactions:
{items}

JSON array of categories:"""
    try:
        msg = client.messages.create(
            model="claude-haiku-4-5-20251001",
            max_tokens=2048,
            messages=[{"role": "user", "content": prompt}]
        )
        raw = msg.content[0].text.strip()
        start = raw.find("[")
        end = raw.rfind("]") + 1
        if start >= 0 and end > start:
            cats_list = json.loads(raw[start:end])
            return [str(c) for c in cats_list]
    except Exception as e:
        print(f"    Categorization error: {e}")
    return ["Other"] * len(transactions)

# ── Deduplication ───────────────────────────────────────────────────────────
def make_dedup_key(statement_id: str, date: str, amount: float, description: str) -> str:
    raw = f"{statement_id}|{date}|{amount:.2f}|{description[:50].lower()}"
    return f"stmt_{hashlib.md5(raw.encode()).hexdigest()[:16]}"

# ── Main Processing ─────────────────────────────────────────────────────────
def process_job(job: dict, dry_run: bool = False) -> dict:
    job_id = job["id"]
    stmt = sb_get("bank_statements", params={
        "id": f"eq.{job['statement_id']}",
        "select": "id,file_path,file_name,statement_date,bank_account_id"
    })
    if not stmt:
        update_job(job_id, status="failed", error_message="Statement not found")
        return {"status": "failed"}

    stmt = stmt[0]
    print(f"\n  📄 {stmt['file_name']} ({stmt.get('statement_date','?')})")
    update_job(job_id, status="processing", started_at=datetime.utcnow().isoformat())

    # 1. Download PDF
    try:
        pdf_bytes = download_pdf(stmt["file_path"])
        print(f"     Downloaded {len(pdf_bytes)//1024}KB")
    except Exception as e:
        update_job(job_id, status="failed", error_message=f"Download failed: {e}")
        return {"status": "failed", "error": str(e)}

    # 2. Extract text
    try:
        text = extract_text(pdf_bytes)
        if not text.strip():
            update_job(job_id, status="skipped", error_message="No text extracted (scanned PDF?)", completed_at=datetime.utcnow().isoformat())
            return {"status": "skipped"}
        print(f"     Extracted {len(text)} chars")
    except Exception as e:
        update_job(job_id, status="failed", error_message=f"PDF parse error: {e}")
        return {"status": "failed", "error": str(e)}

    # 3. Detect bank & parse transactions
    bank = detect_bank(text)
    txns = extract_transactions(text, bank, stmt.get("statement_date", ""))
    print(f"     Bank: {bank} | Transactions found: {len(txns)}")

    if not txns:
        update_job(job_id, status="completed", transactions_found=0, transactions_inserted=0, completed_at=datetime.utcnow().isoformat())
        return {"status": "completed", "found": 0}

    # 4. Categorize in batches of 50
    categories = []
    for i in range(0, len(txns), 50):
        batch = txns[i:i+50]
        cats = categorize_batch(batch)
        categories.extend(cats)
        print(f"     Categorized batch {i//50 + 1}/{(len(txns)-1)//50 + 1}")
        time.sleep(0.5)  # rate limit

    # 5. Insert transactions
    inserted = 0
    skipped = 0
    rows = []
    for i, (t, cat) in enumerate(zip(txns, categories)):
        dedup_key = make_dedup_key(stmt["id"], t["date"], t["amount"], t["description"])
        rows.append({
            "plaid_transaction_id": dedup_key,
            "date": t["date"],
            "name": t["description"],
            "merchant_name": t["description"],
            "amount": t["amount"],
            "currency": "USD",
            "category": [cat],
            "ai_category": cat,
            "pending": False,
            "source": "statement",
            "statement_id": stmt["id"],
            "raw_description": t["description"],
        })

    if not dry_run and rows:
        # Upsert in chunks of 100 to avoid payload limits
        for chunk_start in range(0, len(rows), 100):
            chunk = rows[chunk_start:chunk_start+100]
            try:
                r = requests.post(
                    f"{SUPABASE_URL}/rest/v1/transactions",
                    headers={**HEADERS, "Prefer": "resolution=ignore-duplicates,return=minimal"},
                    json=chunk
                )
                if r.status_code in (200, 201):
                    inserted += len(chunk)
                else:
                    print(f"     Insert error: {r.status_code} {r.text[:200]}")
                    skipped += len(chunk)
            except Exception as e:
                print(f"     Insert exception: {e}")
                skipped += len(chunk)

    update_job(job_id,
        status="completed",
        transactions_found=len(txns),
        transactions_inserted=inserted,
        transactions_skipped=skipped,
        completed_at=datetime.utcnow().isoformat()
    )
    print(f"     ✅ Inserted {inserted}, skipped {skipped}")
    return {"status": "completed", "found": len(txns), "inserted": inserted}

def run_batch(limit: int = 10, dry_run: bool = False, account_id: str = None):
    """Process a batch of pending jobs."""
    params = {"status": "eq.pending", "order": "created_at.asc", "limit": str(limit)}
    if account_id:
        params["bank_account_id"] = f"eq.{account_id}"
    jobs = sb_get("statement_processing_jobs", params=params)
    if not jobs:
        print("✅ No pending jobs.")
        return
    print(f"🚀 Processing {len(jobs)} statements (dry_run={dry_run})...")
    results = {"completed": 0, "failed": 0, "skipped": 0}
    for job in jobs:
        r = process_job(job, dry_run=dry_run)
        results[r.get("status", "failed")] = results.get(r.get("status", "failed"), 0) + 1
    print(f"\n📊 Batch complete: {results}")

def show_status():
    """Print current processing status."""
    rows = sb_get("statement_processing_jobs", params={"select": "status", "order": "status.asc"})
    counts = {}
    for r in rows:
        counts[r["status"]] = counts.get(r["status"], 0) + 1
    total_tx = sb_get("transactions", params={"select": "id", "source": "eq.statement", "limit": "1"})
    print("\n📊 Statement Processing Status")
    print("─" * 35)
    for status, count in sorted(counts.items()):
        emoji = {"pending": "⏳", "processing": "🔄", "completed": "✅", "failed": "❌", "skipped": "⏭️"}.get(status, "•")
        print(f"  {emoji} {status:12} {count:4}")
    print(f"  Total jobs: {len(rows)}")

def retry_failed():
    """Reset failed jobs back to pending."""
    r = sb_patch("statement_processing_jobs",
        {"status": "pending", "error_message": None, "started_at": None, "completed_at": None},
        params={"status": "eq.failed"})
    print(f"♻️  Reset failed jobs to pending")

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Statement Transaction Importer")
    parser.add_argument("command", choices=["status", "run", "retry"], help="Command to run")
    parser.add_argument("--limit", type=int, default=10, help="Max statements to process per run")
    parser.add_argument("--dry-run", action="store_true", help="Parse but don't insert")
    parser.add_argument("--account", help="Filter by bank_account_id")
    args = parser.parse_args()

    if args.command == "status":
        show_status()
    elif args.command == "run":
        run_batch(limit=args.limit, dry_run=args.dry_run, account_id=args.account)
    elif args.command == "retry":
        retry_failed()
