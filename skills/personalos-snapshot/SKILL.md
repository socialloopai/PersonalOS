---
name: personalos-snapshot
description: Generate the user's daily BECOME snapshot — reads his reflection narrative + domain data, scores Be (inner work) and Do (outer work) across Sleep/Body/Food/Money/Tasks/Reflection, writes a characterization of his inner work, synthesizes Be × Do = Become per domain, aggregates with weighted arithmetic mean, computes day-over-day deltas, and writes to Supabase so PersonalOS renders it. Use this skill whenever the user says "yo let's go", "run the snapshot", "synthesize today", "do today's snapshot", "make today's becoming", "snapshot my day", or anything that sounds like he wants the day assessed through the BECOME lens. Also use when he finishes a reflection and asks what today is telling him. Even if the phrasing is casual or implicit, trigger this skill any time he's asking for the daily read on where he is versus where he's becoming. Do not invoke for general life advice, standalone project questions, or tasks that aren't explicitly about the daily snapshot.
---

# PersonalOS Daily Snapshot (v2.3)

This skill generates the user's daily BECOME snapshot. It's the synthesis engine for PersonalOS — it reads his reflection narrative and the day's domain data, characterizes the inner work, scores him across six domains, aggregates with a weighted arithmetic mean at the whole-self level (domain-level `Be × Do = Become` is still strict), computes day-over-day deltas, and writes the result to Supabase so the dashboard can render it.

## The philosophy (why this matters)

BECOME is an ontological identity: **Be ≡ Do ≡ Become**. Not equality — identity. Three aspects of one unified reality, simultaneous, non-interchangeable. Like wavelength, frequency, and energy of light — change one, all three change at once.

Operationally: `Become = Be × Do` per domain. Be and Do are on 0–10. Become is on 0–100. No division by 10 — the quadratic scale is the point: doubling both quadruples Become.

Zero-collapse is honest at the **domain** level. A zero in Be or Do for a given domain collapses that domain's Become to zero — that's the truth of what happened *in that domain*. Don't soften it.

But a life is a mosaic, not a product. A day with a sleep-shaped gap does not erase a taxes-submitted win. So at the **aggregate** (whole-self) level we *sum* domain becomings with weights, not multiply them. Consequence: at aggregate, `agg_be × agg_do ≠ agg_become`. That's by design. Domain identity is strict; whole-self becoming is an accumulation.

Before scoring, if you haven't already, read `~/.claude/projects/PersonalOS/memory/reference_become_doc.md` — the full BECOME ontology. This is the source of truth.

## The six domains (daily snapshot)

1. **Sleep** — Oura readiness (Be) × Oura sleep score (Do)
2. **Body** — body-fat proximity to your target (Be) × workout/abs/check-in execution (Do). Set `BODY_FAT_TARGET` in your config; default 15%.
3. **Food** — protein ratio of intake (Be) × protein grams vs your target (Do). Set `PROTEIN_G_TARGET` in your config; default 150g.
4. **Money** — yesterday's income (Be) × today's income (Do). Frame: *make more money every single day.*
5. **Tasks** — planning quality from reflection (Be) × impact-weighted task closures (Do). Tasks always belong to projects, so Tasks.Do is the daily lens on project execution: every task closed today contributes its impact, regardless of which project it lives under. Projects as standalone entities have their own weekly arc (velocity, momentum, flourishing) — the daily snapshot sees projects *through* their tasks.
6. **Reflection** — depth/honesty of self-examination (Be) × substance of the reflection act itself (Do). This domain is weighted 2× in the aggregate because it is where `Be ≡ Do` holds most literally.

Domains Mind, Craft, Spirit, Relationships do not exist in the daily snapshot; they fold into the reflection narrative rather than getting their own tiles. Projects is the weekly-arc domain, not daily — it shows up here only through Tasks.Do. If he mentions something outside these six, note it in the insight but don't score a new domain.

## Protocol (steps 0–12, in order)

### 0. Set up — pick the narrative day

Use **Pacific time** (America/Los_Angeles) with a **4am cutoff**. Humans don't flip days at midnight — a reflection written at 2am PT narrating Friday's work belongs to Friday, not Saturday. Rule: shift the current PT timestamp back by 4 hours, then take the date. That's the *narrative day*.

Equivalent SQL expression used throughout: `((ts AT TIME ZONE 'America/Los_Angeles') - interval '4 hours')::date`.

Default to the narrative day derived from "now" PT. If the user names a specific date ("do the 17th"), honor that and snapshot against it — he knows what he's attributing to what. Always confirm the date before writing if there's any ambiguity (e.g. a late-night/early-morning reflection that could belong to either side of the cutoff).

Supabase project id: `YOUR_SUPABASE_PROJECT_REF`. Use the Supabase MCP (`<your-supabase-mcp>__execute_sql`) for reads and `apply_migration` is **not** needed — only `execute_sql`.

Schema version written: `schema_version = 2`.

### 1. Fetch the narrative day's reflection(s) — concatenate, don't pick

Reflections are bucketed by **narrative day** (PT with 4am cutoff), not raw PT date:

```sql
SELECT id, content, created_at, updated_at
FROM reflections
WHERE ((created_at AT TIME ZONE 'America/Los_Angeles') - interval '4 hours')::date = '<narrative_day>'
ORDER BY created_at ASC;
```

The `reflections` table has no `date` column — the day a reflection belongs to is derived from `created_at` shifted into Pacific time, minus 4 hours. So an entry written at 11pm PT on Monday is Monday's, and an entry written at 2am PT on Saturday narrating Friday is *also* Friday's.

If **no reflection** exists for the narrative day, stop. Tell the user: "No reflection for today yet — write the entry first, then I'll synthesize." Be without a voice is undefined; do not fabricate a Be.

If one or more reflections exist, **concatenate them in chronological order** (separated by blank lines) to form the day's inner work as one body. Store all their ids in `reflection_ids[]` on the snapshot.

### 2. Fetch domain data (today + yesterday for money + most-recent snapshot for delta)

Run these reads via `execute_sql`:

- `SELECT * FROM oura_daily WHERE date = '<today>' LIMIT 1;`
- `SELECT * FROM nutrition_log WHERE date = '<today>';`
- `SELECT * FROM workouts WHERE date = '<today>';`
- `SELECT * FROM daily_checkin WHERE date = '<today>' LIMIT 1;`
- `SELECT * FROM transactions WHERE date IN ('<today>', '<yesterday>');`
- `SELECT id, name, project_id, impact, status, completed_at, created_at, updated_at FROM tasks WHERE (status = 'done' AND ((completed_at AT TIME ZONE 'America/Los_Angeles') - interval '4 hours')::date = '<narrative_day>') OR (status != 'done' AND ((created_at AT TIME ZONE 'America/Los_Angeles') - interval '4 hours')::date >= ('<narrative_day>'::date - interval '7 days'));`
- `SELECT * FROM snapshots WHERE date < '<narrative_day>' ORDER BY date DESC LIMIT 1;` — the most recent prior snapshot for delta comparison (may be any date, not necessarily yesterday)

Schema notes: the `tasks` table uses `name` (not `title`), `project_id` (uuid FK, not `project`), and `impact` (not `impact_score`). `completed_at` is a timestamptz maintained by a trigger — it's set to `now()` on transition into `status='done'` and cleared on transition out, so it's a clean signal of when a task actually finished.

### 3. Characterize the reflection (before scoring)

Before producing any numbers, write a **characterization**: one or two sentences that describe what this reflection *is* — **not a summary of what it says**. the user already wrote the reflection; it's rendered in full right below this card. Your job isn't to paraphrase it back to him.

Characterization is **observation about the act of reflecting**, not the content of the reflection. Think of yourself as standing outside the text looking at it — what kind of inner work is this? Where does the energy sit? What's present, what's absent, where does it turn honest, where does it flinch?

The cheap failure mode: "A reflection about finishing 18 tasks across 6 projects while skipping the gym." That's a summary — the reader has just read that. Don't do this.

The real work (do this):
- *"A shallow activity log until the last paragraph, where the underlying fear finally surfaces."* — names a shape the reader might have missed
- *"Sustained examination connecting sleep to training to the lawyer call — integration that isn't possible without sitting with the day."* — names a quality of the thinking itself
- *"Honest and short. You named what you avoided without explaining it away."* — names a posture toward the self
- *"Pride-inflected but not performed. What's absent is the body, the rest, and why you're still at this at 2am."* — names what's **missing** from the self-seeing

Test: if the characterization could have been written by reading only the reflection (no outside eye), it's a summary, not a characterization. Rewrite it.

This characterization is the grounding for Reflection.Be and Reflection.Do. It is **stored and displayed** in the snapshot so the scoring has an audit trail. If the user disagrees with a score, he can see why.

### 4. Score Reflection (Be and Do on the same act)

The reflection act is simultaneously outer work (an action performed) and inner work (its content). Both readings happen on the same text.

**Reflection.Do** — the substance of the reflection as an act:
- Did he write? Was it more than activity log?
- Principles: quantity-of-substance (not word count), specificity (named moments, named feelings), wrestling with tension, integration across domains

**Reflection.Be** — the identity-work expressed in the reflection:
- How clearly did he see himself?
- Principles: depth (examination vs listing), honesty (reckoning vs performance), specificity, willingness to hold contradiction

Score each 0–10 based on the characterization. Do not fit to anchors; let the reading produce the number. If he didn't write at all, both are 0 and Reflection.Become zero-collapses honestly.

### 5. Score Be for the five outer domains

For Sleep, Body, Food, Money, and Tasks, score Be 0–10 based on what the reflection reveals about his identity/capacity in that domain today.

- Default **5** (neutral) if the reflection doesn't mention the domain — absence of signal is not collapse
- **0–3** if the reflection shows collapse, abandonment, disconnection in that domain
- **5–7** if he's showing up as the person he wants to be, intentionally
- **8–10** if full embodiment, no gap between identity and becoming in that domain

Do not pump Be. A truthful 3 is more valuable than a dishonest 6. If he barely mentioned sleep, Be for Sleep is 5, not 8. If he said "I'm exhausted and I don't care about my body", Body.Be is 2, not 5.

**Tasks.Be** specifically reflects *planning quality and intentionality*, not just presence. If he articulated what mattered today and why, Tasks.Be is high. If the reflection reads like a to-do dump with no prioritization, it's ~5.

**Money.Be** — exception: use yesterday's income (same formula as Money.Do, applied to yesterday). The reflection's narrative about money feeds the insight, not the Be score.

### 6. Compute Do for the five outer domains (deterministic, no LLM judgment)

These formulas must match the frontend exactly.

**Sleep.Do** = `round(sleep_score / 10)` from today's `oura_daily` row.

**Body.Do** = `min(10, workout_points + abs_points + checkin_points)` where:
- workout_points = 6 if any workout row today, else 0
- abs_points = 2 if any workout row has workout_type containing "abs" or "core"
- checkin_points = 2 if daily_checkin row exists today

**Food.Do** = `round(min(protein_g / PROTEIN_G_TARGET, 1) * 10)` summed over today's nutrition_log.

**Money.Do** = income score for today. Income = transactions with `amount < 0` AND `ai_category` not containing "transfer". Sum `abs(amount)`. Score = `round(min(10, total / 100))`.

**Tasks.Do** = `round(min(10, sum(impact for tasks with ((completed_at AT TIME ZONE 'America/Los_Angeles') - interval '4 hours')::date = narrative_day) / 5))`. Tasks missing `impact` contribute 0 (not 1) — this enforces the discipline. Bucket by narrative day so a task closed at 1am that capped off the prior day's push counts on that day.

### 7. Compute Become per domain

`become_i = be_i × do_i` — on the 0–100 scale, not divided by 10. Zero in either = 0.

### 8. Set data_flags

For each outer domain, flag data availability:
- `"sleep": "no_data"` if no oura_daily row (Sleep.Be and Sleep.Do both default to 5/5 neutral — **not zero-collapse**; the sync failed, not the day)
- `"food": "no_data"` if no nutrition_log rows (Food.Do defaults to 5)
- `"body": "no_data"` if no checkin and no workout (Body.Do defaults to 5)
- `"money": "no_data"` only if no transactions at all for today AND yesterday
- `"tasks": "no_data"` never — no tasks shipped is a real zero, not missing data

The neutral-with-flag rule applies to `.Do` (the measurement half). Be is always derived from reflection, so it's never "no_data" — only neutral default (5) for unmentioned domains.

The `reflection` domain never uses no_data — absence of reflection zero-collapses it honestly.

### 9. Aggregate with weighted arithmetic mean

Weights (sum to 1):
- Reflection: 2/7 ≈ 0.2857
- Sleep, Body, Food, Money, Tasks: 1/7 ≈ 0.1429 each

Formula (weighted arithmetic mean):
```
agg_be     = Σ w_i × be_i
agg_do     = Σ w_i × do_i
agg_become = Σ w_i × become_i
```

**Why arithmetic, not geometric.** Domain-level `Be × Do = Become` is strict and zero-collapses honestly — if Body.Do = 0, Body.Become = 0, because no becoming happened *in that domain*. But at the whole-self level, a zero in one domain must not erase real becoming in another. A life is a mosaic, not a product: a no-gym day does not undo 18 tasks shipped across six projects, a clean lawyer call, and a deep reflection. Sum domain becomings with weights; let the shape speak for itself.

**Consequence.** At aggregate, `agg_be × agg_do ≠ agg_become` (except by coincidence). That's intentional. The agg_be and agg_do columns are the whole-self center-of-mass of presence and execution; agg_become is the weighted sum of what actually became real across domains. Different quantities, different semantics.

**Zero-collapse stays at the domain level.** The `domains` JSONB and denormalized `*_become` columns still zero-collapse per-domain. What changed is only the roll-up.

Round agg_be and agg_do to 1 decimal, agg_become to 1 decimal.

### 10. Diagnose the day

Based on aggregate Be/Do:

- **aligned** — all six domains with Be and Do both ≥ 5
- **identity** — agg_be ≥ 6, agg_do < 5. Vision exceeds output. Risk: comfort.
- **grind** — agg_do ≥ 6, agg_be < 5. Execution without presence. Risk: burnout.
- **collapsed** — both agg_be < 5 and agg_do < 5. Honor it and name it. No pep talk.
- **split** — some domains aligned, others collapsed. Name which.

Store one of these five strings in `diagnosis`.

### 11. Compute day-over-day delta

If a prior snapshot exists (any date before today), compute:

- `delta_be = agg_be_today - agg_be_prior`
- `delta_do = agg_do_today - agg_do_prior`
- `delta_become = agg_become_today - agg_become_prior`
- `delta_identity_component = agg_do_today × delta_be` — growth attributable to identity shift
- `delta_execution_component = agg_be_today × delta_do` — growth attributable to execution shift
- `delta_compared_to = prior.date`

(The decomposition follows `d(Become) = Do·dBe + Be·dDo` from the document.)

If no prior snapshot exists, leave all delta fields NULL.

### 12. Compute resonance, write insight, surface warnings

**Resonance** (0–10): how closely what he said matches what he did. If he said "I crushed training" and Body.Do is 9+, resonance is high. If he said he locked in on money and Money.Do is 0, resonance is low. Weight by how many domains he actually discussed.

**Warnings** to surface in the insight or domain observations:
- Any domain with Be < 3 **and** Do > 5 → "You're acting beyond who you are in [domain]. Do is outrunning Be. Fix: deepen Be."
- Any domain with Be < 1 → "Identity collapse in [domain]. Any Do here is sterile."
- aligned day with high scores → surface quadratic leverage: *"Both at 8 → Become 64. Both at 10 → Become 100. You're one domain from full integration."*

**Synthesis** — this is the centerpiece of the snapshot. Not a one-liner. Not a to-do list. Write a real, unhurried read of the whole day — 4 to 7 paragraphs, ~300–600 words — that the user can actually sit with. The reflection lives right below the snapshot for him to re-read; the synthesis is the outside eye that *holds his words together with the data* and says back what a careful, honest friend would notice.

Structure (don't label the sections, but cover this ground in roughly this order):

1. **The shape of the day.** Not "you closed 18 tasks." Name the *kind* of day this was — the throughline, the tension, the posture. What was this day actually doing? Where did its energy go? What is this day a *move toward* and a *move away from*?

2. **Reflection vs. data — where they agree, where they diverge.** What did he say that the numbers back up? What did he say that the numbers contradict? And critically: **what did the data record that the reflection didn't name?** (E.g., reflection omits sleep entirely but sleep data shows a hit — that silence is itself information.) What did the reflection name that the data can't capture — a moment, a dread, a small choice? Honor that too.

3. **How the six domains are speaking to each other today.** Don't re-list the scores — they're in the grid above. Instead: name which domain carried the day, which one gave way, and how they're connected in *his* life (not generically). E.g., "Tasks carried, but at the cost of Body — and the 2am timestamp on the reflection is where those two meet." Or: "Sleep and Food moved together — when one went, the other followed." Find the real mechanism.

4. **The identity question — who was he today?** Where Be and Do matched, where they didn't. What did it cost, what did it give? This is where zero-collapse at the domain level gets *named* as a felt thing, not just a number. A Body.Become of 0 isn't a failure to report; it's a day the body didn't get a seat at the table. Say it that way.

5. **What the day, sustained, becomes.** Not "tomorrow do X." The forward vector, the longer arc. If this day repeated 30 times, what is he? If this day were the one he looked back on in a year, what would it have been the opening move of?

6. **The one thing worth naming that the day itself wouldn't have noticed.** A small moment, a turn of phrase in the reflection, a thing that almost happened, a question he didn't sit with. The texture that the scores can't hold.

**Voice rules:**

- Second person ("you"), present tense where possible. Direct, warm, unsentimental.
- Never restate what he wrote. If a sentence of yours could have been written by him re-reading his own journal, it's a restatement — cut it. You're the *outside* reader.
- Quote him sparingly and precisely (one or two short phrases max) when the quote *does* something — reveals a tension, carries a weight. Don't narrate quotes back at him.
- No coaching verbs ("make sure you," "remember to," "try to"). If you want to point somewhere, observe where the day is already pointing and name that.
- No bullet lists. This is prose. Paragraphs, linked thought, breathing room.
- Integrate warnings (Be < 3 and Do > 5; Be < 1; quadratic-leverage nudges when aligned) *into the prose*, not as a bulleted appendix. If a warning doesn't apply, don't force it.
- End on something the day *offered*, not something the day *owed*. Even a hard day has a gift; find the honest one.

The synthesis goes into the `insight` column. If it wants to run longer than the column allows, save the full text and trust that the frontend will scroll.

### 13. Write to Supabase

Upsert to `snapshots`:

```sql
INSERT INTO snapshots (
  date, schema_version, reflection_ids,
  agg_be, agg_do, agg_become, diagnosis, resonance,
  sleep_be, sleep_do, sleep_become,
  body_be, body_do, body_become,
  food_be, food_do, food_become,
  money_be, money_do, money_become,
  tasks_be, tasks_do, tasks_become,
  reflection_be, reflection_do, reflection_become,
  data_flags,
  delta_be, delta_do, delta_become,
  delta_identity_component, delta_execution_component, delta_compared_to,
  domains, reflection_characterization, insight, data_snapshot,
  synthesized_at, synthesized_by
) VALUES (...)
ON CONFLICT (date) DO UPDATE SET
  schema_version = EXCLUDED.schema_version,
  reflection_ids = EXCLUDED.reflection_ids,
  agg_be = EXCLUDED.agg_be, agg_do = EXCLUDED.agg_do, agg_become = EXCLUDED.agg_become,
  diagnosis = EXCLUDED.diagnosis, resonance = EXCLUDED.resonance,
  sleep_be = EXCLUDED.sleep_be, sleep_do = EXCLUDED.sleep_do, sleep_become = EXCLUDED.sleep_become,
  body_be = EXCLUDED.body_be, body_do = EXCLUDED.body_do, body_become = EXCLUDED.body_become,
  food_be = EXCLUDED.food_be, food_do = EXCLUDED.food_do, food_become = EXCLUDED.food_become,
  money_be = EXCLUDED.money_be, money_do = EXCLUDED.money_do, money_become = EXCLUDED.money_become,
  tasks_be = EXCLUDED.tasks_be, tasks_do = EXCLUDED.tasks_do, tasks_become = EXCLUDED.tasks_become,
  reflection_be = EXCLUDED.reflection_be, reflection_do = EXCLUDED.reflection_do, reflection_become = EXCLUDED.reflection_become,
  data_flags = EXCLUDED.data_flags,
  delta_be = EXCLUDED.delta_be, delta_do = EXCLUDED.delta_do, delta_become = EXCLUDED.delta_become,
  delta_identity_component = EXCLUDED.delta_identity_component,
  delta_execution_component = EXCLUDED.delta_execution_component,
  delta_compared_to = EXCLUDED.delta_compared_to,
  domains = EXCLUDED.domains,
  reflection_characterization = EXCLUDED.reflection_characterization,
  insight = EXCLUDED.insight,
  data_snapshot = EXCLUDED.data_snapshot,
  synthesized_at = EXCLUDED.synthesized_at,
  synthesized_by = EXCLUDED.synthesized_by;
```

`domains` JSONB shape:
```json
{
  "sleep":      {"be": 7, "do": 8, "become": 56, "detail": "Oura readiness 72, sleep 78", "observation": "..."},
  "body":       {"be": 4, "do": 0, "become": 0,  "detail": "BF 14%, no workout", "observation": "..."},
  "food":       {"be": 6, "do": 7, "become": 42, "detail": "protein 130g / target", "observation": "..."},
  "money":      {"be": 3, "do": 5, "become": 15, "detail": "yesterday $300 → today $500", "observation": "..."},
  "tasks":      {"be": 6, "do": 4, "become": 24, "detail": "2.0 impact shipped", "observation": "..."},
  "reflection": {"be": 7, "do": 6, "become": 42, "detail": "concatenated 2 entries, 1200 words", "observation": "..."}
}
```

`data_snapshot` JSONB — preserve raw inputs for audit:
```json
{
  "oura": {"readiness_score": 72, "sleep_score": 78, "total_sleep_hrs": 7.2, "hrv_ms": 45},
  "nutrition": {"protein_g": 130, "calories": 2100, "meals_count": 3},
  "workouts_count": 0, "checkin": true,
  "income_today_usd": 500, "income_yesterday_usd": 300,
  "tasks_completed_impact": 2.0, "tasks_open_count": 5,
  "reflection_word_count": 1200
}
```

**Then insert a run log** into `snapshot_runs`:

```sql
INSERT INTO snapshot_runs (snapshot_id, date, schema_version, resulted_in_change, notes)
VALUES ('<snapshot_id>', '<today>', 2, true, '<brief note>');
```

### 14. Report back to the user

Tight, human-readable summary in chat:

```
Snapshot saved for <date> (schema v2).

Aggregate: Be 5.2 · Do 4.8 → Become 25.0 (grind day)
(domain-level: Be × Do = Become strict; aggregate Become is the weighted sum)
Δ vs <prior date>: ΔBecome +3.2 (identity +1.4 · execution +1.8)

Sleep        Be 7 × Do 8 →  56   Oura readiness 72, sleep 78
Body         Be 4 × Do 0 →   0   no workout logged
Food         Be 6 × Do 7 →  42   protein 130g vs target
Money        Be 3 × Do 5 →  15   yesterday $300 → today $500
Tasks        Be 6 × Do 4 →  24   2.0 impact shipped
Reflection*  Be 7 × Do 6 →  42   (* 2× weight)

Resonance: 7.0/10 — your read mostly lined up with the data.

Characterization: <your one-line observation on the reflection>

<1-3 sentence insight>

Open the dashboard: https://your-personalos-deployment.example.com
```

## Guardrails (the things that break this skill if ignored)

**Never fabricate numbers.** If Oura didn't sync, use neutral 5/5 and flag it. Do not estimate from narrative.

**Never pump Be.** Temptation to soften a low Be because it makes Become look sad. Resist. Truthful 3 > dishonest 6.

**Never skip the Supabase write.** The dashboard reads from `snapshots`. Writing to both denormalized columns and the `domains` JSONB is mandatory.

**Never skip `snapshot_runs`.** The audit log is how we debug regressions later.

**Zero-collapse is sacred at the domain level for Be=0 or Do=0 when genuinely zero.** Only override to neutral-5 when the cause is missing data (Oura down, no meals logged). Distinguish sync failure from genuine zero. At the aggregate level, zeros do *not* collapse the whole day — becoming accumulates.

**Narrative day, not raw midnight.** Pacific time with a 4am cutoff. A reflection written at 2am PT on Saturday narrating Friday belongs to Friday. Everything — reflection fetch, task completion bucketing, snapshot date — uses `((ts AT TIME ZONE 'America/Los_Angeles') - interval '4 hours')::date`.

**Idempotent re-runs.** Upsert on date, append to snapshot_runs.

**Never use anchors for Reflection scoring.** Characterize first, let principles (depth, honesty, specificity, integration) produce the number. Store the characterization.

**Tasks without impact are 0, not 1.** Enforces the discipline.

**If reflection is absent, refuse.** Tell him to write first.

**Preserve the reflection text.** The frontend reads `reflection_ids[]` and displays the full reflection text. Never discard it, never truncate it in storage.

## When NOT to trigger

- General BECOME philosophy questions → consult `reference_become_doc.md` directly
- Adding a task → `personalos-add-task`
- Adding a project → `personalos-add-project`
- Scheduling → `personalos-schedule`
- "How am I doing this week" → day-scoped skill. Offer to snapshot today; week-view is future work.
