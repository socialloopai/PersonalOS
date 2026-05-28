#!/usr/bin/env python3
"""
Statement Transaction Importer (teenybase port).

Pulls pending statement PDFs from the personal-os vault (documents where
category='statement' and processing_status='pending'), parses each one,
categorizes with Claude, inserts to the transactions table, marks the
document completed.

Env vars:
  PERSONAL_OS_URL    base URL of the deployment (e.g. http://localhost:8787)
  PERSONAL_OS_TOKEN  user JWT (from cookie or login response). Owner_id is
                     decoded from the token.
  ANTHROPIC_API_KEY  for Claude parsing + categorization
"""
import os, re, json, time, hashlib, tempfile, sys, argparse, base64, urllib.parse
from datetime import datetime
import requests
import pdfplumber

# ── Config ──────────────────────────────────────────────────────────────────
PERSONAL_OS_URL = os.environ.get("PERSONAL_OS_URL", "http://localhost:8787").rstrip("/")
PERSONAL_OS_TOKEN = os.environ.get("PERSONAL_OS_TOKEN", "")
ANTHROPIC_API_KEY = os.environ.get("ANTHROPIC_API_KEY", "")
if not PERSONAL_OS_TOKEN:
    sys.exit("Set PERSONAL_OS_TOKEN (a user JWT) before running.")

HEADERS = {"Authorization": f"Bearer {PERSONAL_OS_TOKEN}", "Content-Type": "application/json"}

def _decode_user_id() -> str:
    parts = PERSONAL_OS_TOKEN.split(".")
    if len(parts) != 3:
        sys.exit("PERSONAL_OS_TOKEN does not look like a JWT.")
    payload = parts[1] + "=" * ((4 - len(parts[1]) % 4) % 4)
    obj = json.loads(base64.urlsafe_b64decode(payload).decode())
    if not obj.get("id"):
        sys.exit("JWT payload missing 'id' field.")
    return obj["id"]

OWNER_ID = _decode_user_id()

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

# ── teenybase REST helpers (replaces sb_*) ─────────────────────────────────
def tb_list(table: str, where: str = None, order: str = None, limit: int = None) -> list[dict]:
    qs = {}
    if where: qs["where"] = where
    if order: qs["order"] = order
    if limit: qs["limit"] = str(limit)
    qstr = ("?" + urllib.parse.urlencode(qs)) if qs else ""
    r = requests.get(f"{PERSONAL_OS_URL}/api/v1/table/{table}/list{qstr}", headers=HEADERS)
    r.raise_for_status()
    return r.json().get("items", [])

def tb_view(table: str, rid: str) -> dict | None:
    r = requests.get(f"{PERSONAL_OS_URL}/api/v1/table/{table}/view/{rid}", headers=HEADERS)
    if r.status_code == 404: return None
    r.raise_for_status()
    return r.json()

def tb_insert(table: str, values: dict) -> dict | None:
    r = requests.post(f"{PERSONAL_OS_URL}/api/v1/table/{table}/insert",
                      headers=HEADERS, json={"values": values, "returning": "*"})
    if r.status_code not in (200, 201):
        return None
    data = r.json()
    return data[0] if isinstance(data, list) and data else None

def tb_edit(table: str, rid: str, patch: dict):
    r = requests.post(f"{PERSONAL_OS_URL}/api/v1/table/{table}/edit/{rid}",
                      headers=HEADERS, json=patch)
    r.raise_for_status()

def tb_update_doc_status(doc_id: str, **fields):
    tb_edit("documents", doc_id, fields)

# ── PDF Download ────────────────────────────────────────────────────────────
def download_pdf(doc_id: str, file_path: str) -> bytes:
    # teenybase serves files at /api/v1/files/{table}/{rid}/{path}
    encoded = urllib.parse.quote(file_path.split("/")[-1])
    url = f"{PERSONAL_OS_URL}/api/v1/files/documents/{doc_id}/{encoded}"
    r = requests.get(url, headers={"Authorization": f"Bearer {PERSONAL_OS_TOKEN}"})
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
                if t: text += t + "\n"
        return text
    finally:
        os.unlink(tmp)

# ── Bank-specific Transaction Parsers (UNCHANGED from original) ─────────────
CHASE_TX_RE = re.compile(r'^(\d{2}/\d{2})\s+(.+?)\s+(-?\$?[\d,]+\.\d{2})\s*$', re.MULTILINE)
AMEX_TX_RE = re.compile(r'^(\d{1,2}/\d{1,2}/\d{2,4})\s+(.+?)\s+\$?([\d,]+\.\d{2})\s*$', re.MULTILINE)
BOFA_TX_RE = re.compile(r'^(\d{2}/\d{2}/\d{4})\s+(.+?)\s+(-?[\d,]+\.\d{2})\s*$', re.MULTILINE)

def detect_bank(text: str) -> str:
    t = text[:2000].lower()
    if "chase" in t or "jpmorgan" in t: return "chase"
    if "american express" in t or "amex" in t: return "amex"
    if "bank of america" in t: return "bofa"
    if "apple card" in t: return "apple"
    if "wells fargo" in t: return "wellsfargo"
    return "unknown"

def parse_year_from_text(text: str, statement_date: str) -> str:
    m = re.search(r'(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{4})', text[:1000], re.IGNORECASE)
    if m: return m.group(2)
    if statement_date: return statement_date[:4]
    return str(datetime.now().year)

def normalize_amount(raw: str) -> float:
    raw = raw.replace("$", "").replace(",", "").strip()
    return abs(float(raw))

def parse_chase(text: str, year: str) -> list[dict]:
    txns = []
    for m in CHASE_TX_RE.finditer(text):
        try:
            date = datetime.strptime(f"{m.group(1)}/{year}", "%m/%d/%Y").strftime("%Y-%m-%d")
            amount = normalize_amount(m.group(3))
            desc = m.group(2).strip()
            if desc and amount > 0: txns.append({"date": date, "description": desc, "amount": amount})
        except: continue
    return txns

def parse_amex(text: str) -> list[dict]:
    txns = []
    for m in AMEX_TX_RE.finditer(text):
        try:
            date_str = m.group(1)
            fmt = "%m/%d/%y" if len(date_str.split("/")[2]) == 2 else "%m/%d/%Y"
            date = datetime.strptime(date_str, fmt).strftime("%Y-%m-%d")
            amount = normalize_amount(m.group(3))
            desc = m.group(2).strip()
            if desc and amount > 0: txns.append({"date": date, "description": desc, "amount": amount})
        except: continue
    return txns

def parse_bofa(text: str) -> list[dict]:
    txns = []
    for m in BOFA_TX_RE.finditer(text):
        try:
            date = datetime.strptime(m.group(1), "%m/%d/%Y").strftime("%Y-%m-%d")
            amount = normalize_amount(m.group(3))
            desc = m.group(2).strip()
            if desc and amount > 0: txns.append({"date": date, "description": desc, "amount": amount})
        except: continue
    return txns

def claude_parse(text: str, bank: str, statement_date: str) -> list[dict]:
    if not ANTHROPIC_API_KEY: return []
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
        msg = client.messages.create(model="claude-haiku-4-5-20251001", max_tokens=4096,
                                     messages=[{"role": "user", "content": prompt}])
        raw = msg.content[0].text.strip()
        start, end = raw.find("["), raw.rfind("]") + 1
        if start >= 0 and end > start: return json.loads(raw[start:end])
    except Exception as e:
        print(f"    Claude parse error: {e}")
    return []

def extract_transactions(text: str, bank: str, statement_date: str) -> list[dict]:
    year = parse_year_from_text(text, statement_date)
    txns = {"chase": parse_chase(text, year), "amex": parse_amex(text), "bofa": parse_bofa(text)}.get(bank, [])
    if not txns:
        txns = claude_parse(text, bank, statement_date)
    return txns

# ── Claude Categorization ───────────────────────────────────────────────────
def categorize_batch(transactions: list[dict]) -> list[str]:
    if not ANTHROPIC_API_KEY or not transactions: return ["Other"] * len(transactions)
    import anthropic
    client = anthropic.Anthropic(api_key=ANTHROPIC_API_KEY)
    items = "\n".join(f"{i+1}. {t['date']} | {t['description']} | ${t['amount']:.2f}" for i, t in enumerate(transactions))
    cats = ", ".join(CATEGORIES)
    prompt = f"""Categorize each transaction below. Return ONLY a JSON array of strings (one category per transaction, same order).
Valid categories: {cats}

Transactions:
{items}

JSON array of categories:"""
    try:
        msg = client.messages.create(model="claude-haiku-4-5-20251001", max_tokens=2048,
                                     messages=[{"role": "user", "content": prompt}])
        raw = msg.content[0].text.strip()
        start, end = raw.find("["), raw.rfind("]") + 1
        if start >= 0 and end > start:
            return [str(c) for c in json.loads(raw[start:end])]
    except Exception as e:
        print(f"    Categorization error: {e}")
    return ["Other"] * len(transactions)

# ── Deduplication ───────────────────────────────────────────────────────────
def make_dedup_key(doc_id: str, date: str, amount: float, description: str) -> str:
    raw = f"{doc_id}|{date}|{amount:.2f}|{description[:50].lower()}"
    return f"stmt_{hashlib.md5(raw.encode()).hexdigest()[:16]}"

# ── Main Processing ─────────────────────────────────────────────────────────
def process_doc(doc: dict, dry_run: bool = False) -> dict:
    doc_id = doc["id"]
    print(f"\n  📄 {doc.get('file_name', '?')} ({doc.get('statement_date','?')})")
    tb_update_doc_status(doc_id, processing_status="running")

    try:
        pdf_bytes = download_pdf(doc_id, doc["file"])
        print(f"     Downloaded {len(pdf_bytes)//1024}KB")
    except Exception as e:
        tb_update_doc_status(doc_id, processing_status="failed", processing_error=f"Download failed: {e}")
        return {"status": "failed"}

    try:
        text = extract_text(pdf_bytes)
        if not text.strip():
            tb_update_doc_status(doc_id, processing_status="completed", processing_error="No text extracted (scanned PDF?)")
            return {"status": "skipped"}
        print(f"     Extracted {len(text)} chars")
    except Exception as e:
        tb_update_doc_status(doc_id, processing_status="failed", processing_error=f"PDF parse error: {e}")
        return {"status": "failed"}

    bank = detect_bank(text)
    txns = extract_transactions(text, bank, doc.get("statement_date", ""))
    print(f"     Bank: {bank} | Transactions found: {len(txns)}")

    if not txns:
        tb_update_doc_status(doc_id, processing_status="completed", processing_found_count=0, processing_inserted_count=0)
        return {"status": "completed", "found": 0}

    # Categorize in batches of 50
    categories = []
    for i in range(0, len(txns), 50):
        batch = txns[i:i+50]
        categories.extend(categorize_batch(batch))
        print(f"     Categorized batch {i//50 + 1}/{(len(txns)-1)//50 + 1}")
        time.sleep(0.5)

    # Insert transactions one at a time (teenybase REST insert is single-row).
    # Dedup via plaid_transaction_id (unique constraint catches duplicates).
    inserted, skipped = 0, 0
    if not dry_run:
        for t, cat in zip(txns, categories):
            dedup_key = make_dedup_key(doc_id, t["date"], t["amount"], t["description"])
            try:
                r = tb_insert("transactions", {
                    "owner_id": OWNER_ID,
                    "bank_account_id": doc.get("bank_account_id"),
                    "plaid_transaction_id": dedup_key,
                    "date": t["date"],
                    "amount": t["amount"],
                    "name": t["description"],
                    "merchant_name": t["description"],
                    "ai_category": cat,
                    "pending": False,
                    "source": "statement",
                    "statement_id": doc_id,
                    "dedup_hash": dedup_key,
                })
                if r: inserted += 1
                else: skipped += 1
            except Exception:
                skipped += 1

    tb_update_doc_status(doc_id, processing_status="completed",
                         processing_found_count=len(txns),
                         processing_inserted_count=inserted,
                         processing_skipped_count=skipped)
    print(f"     ✅ Inserted {inserted}, skipped {skipped}")
    return {"status": "completed", "found": len(txns), "inserted": inserted}

def run_batch(limit: int = 10, dry_run: bool = False):
    docs = tb_list("documents",
                   where=f"category == 'statement' & processing_status == 'pending' & owner_id == '{OWNER_ID}'",
                   order="created", limit=limit)
    if not docs:
        print("✅ No pending statements.")
        return
    print(f"🚀 Processing {len(docs)} statements (dry_run={dry_run})...")
    results = {"completed": 0, "failed": 0, "skipped": 0}
    for doc in docs:
        r = process_doc(doc, dry_run=dry_run)
        key = r.get("status", "failed")
        results[key] = results.get(key, 0) + 1
    print(f"\n📊 Batch complete: {results}")

def show_status():
    docs = tb_list("documents", where=f"category == 'statement' & owner_id == '{OWNER_ID}'", limit=10000)
    counts = {}
    for d in docs:
        s = d.get("processing_status") or "pending"
        counts[s] = counts.get(s, 0) + 1
    print("\n📊 Statement Processing Status")
    print("─" * 35)
    for status in sorted(counts.keys()):
        emoji = {"pending": "⏳", "running": "🔄", "completed": "✅", "failed": "❌"}.get(status, "•")
        print(f"  {emoji} {status:12} {counts[status]:4}")
    print(f"  Total statements: {len(docs)}")

def retry_failed():
    docs = tb_list("documents", where=f"category == 'statement' & processing_status == 'failed' & owner_id == '{OWNER_ID}'", limit=10000)
    for d in docs:
        tb_update_doc_status(d["id"], processing_status="pending", processing_error=None)
    print(f"♻️  Reset {len(docs)} failed statements to pending")

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Statement Transaction Importer (teenybase)")
    parser.add_argument("command", choices=["status", "run", "retry"])
    parser.add_argument("--limit", type=int, default=10)
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()
    {"status": show_status, "run": lambda: run_batch(args.limit, args.dry_run), "retry": retry_failed}[args.command]()
