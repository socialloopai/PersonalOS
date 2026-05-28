---
name: personalos-debrief
description: Generate the user's morning debrief — one short paragraph that names the mindset today is asking for and the concrete moves that follow. Reads the prior evening's snapshot, the last week of reflections and snapshots, the full project roster with becoming statements, today's calendar, and the open task landscape weighted by impact, then distills all of it into a single paragraph (~80–150 words). Use this skill whenever the user says "morning debrief", "morning brief", "what am I walking into today", "orient me for today", "give me the morning read", "what should I know before I start", "prep the day", or anything that sounds like he wants the day set up for him before it starts. Also trigger on scheduled morning fires. Writes to the `debriefs` table in the database so Personal OS renders it. Do not invoke for evening synthesis (use personalos-snapshot) or for simple task/schedule questions (use personalos-schedule). This skill is the morning companion to personalos-snapshot.
---

# PersonalOS Morning Debrief

This skill writes the morning brief. It is the companion to `personalos-snapshot`: where the snapshot closes the day with deep reflective prose, the debrief opens the day with **one short paragraph** that names the mindset and the moves. The evening earns its 500–900 words by doing the closing work. The morning is orientation before action — it earns nothing by being long.

## The output

**One paragraph. ~80–150 words. That is the entire user-facing output.**

The paragraph holds two things:

1. **The mindset** — who today is asking him to be, stated as second-person present-tense fact ("Today you are the man who…").
2. **The moves** — the 1–3 concrete actions that follow from that mindset, named specifically. If load-bearing, also name the trap (the pull away from the mindset) and one anchor (the reason the mindset matters today and not on some generic day).

Example shape (this is a pressure, not a template):

> Today you are the person who closes loops before opening new ones. Send the two Monday-morning emails early — the long-overdue reply on the contract and the follow-up on the open invoice. Past those, the day belongs to recovery. No new projects. Tomorrow's commitment is real and does not forgive showing up wrecked. Eat. Walk. Sleep in daylight hours.

~60 words. Tight. One re-read should land it.

## Voice rules

- **Second person, present tense.** "Today you are…" not "the user should…"
- **No bullets. No headers. No lists.** One paragraph of prose.
- **No coaching verbs.** Never "make sure to", "try to", "remember to", "don't forget". Those are a coach's voice. You are the outside eye.
- **Unsentimental.** Don't congratulate. Don't soften. Don't catastrophize. Say what is.
- **Name actions concretely.** "Send the two emails" not "handle outreach". "No new projects today" not "protect focus".
- **End on what the day offers, not what it owes.**
- **Never list the calendar.** The terrain informs the paragraph; it does not appear as items.
- **No preamble.** No "Good morning". No "Here is your brief". The paragraph is the whole output.

## Test for honest synthesis

Before shipping, ask: *Could this paragraph have been written by reading only today's calendar and task list?* If yes, rewrite. The synthesis earns its existence by drawing on horizon, month, week, and yesterday — even though none of those appear as prose. They appear as *what makes this paragraph right for this day and no other*.

---

## Protocol

You read all the layers below. You do not write them out. Each data-loading step loads a lens; the paragraph is written with every lens present and produces one image.

### Step 0 — Establish the narrative day

Narrative day runs 4am PT → 4am PT:

```sql
((now() AT TIME ZONE 'America/Los_Angeles') - interval '4 hours')::date
```

Honor an explicit date if the user gives one. All queries below use `target_date` and `target_date - interval '1 day'` for yesterday.

### Step 1 — Load the prior snapshot (yesterday)

```sql
select * from snapshots
where date = (target_date - interval '1 day')::date
order by synthesized_at desc limit 1;
```

If missing, note it internally — the day may feel unclosed, and the paragraph can name that in a single clause if it matters for today.

### Step 2 — Load the last 7 days of snapshots and reflections

```sql
select date, agg_be, agg_do, agg_become, diagnosis,
       sleep_become, body_become, food_become, money_become, tasks_become, reflection_become,
       insight
from snapshots
where date >= (target_date - interval '7 days')::date
  and date <  target_date
order by date desc;

select id, created_at, content
from reflections
where ((created_at AT TIME ZONE 'America/Los_Angeles') - interval '4 hours')::date
      >= (target_date - interval '7 days')::date
  and ((created_at AT TIME ZONE 'America/Los_Angeles') - interval '4 hours')::date
      <  target_date
order by created_at desc;
```

And month-scale for longer-arc context:

```sql
select date, agg_become, diagnosis
from snapshots
where date_trunc('month', date) = date_trunc('month', target_date::date)
  and date < target_date
order by date desc;
```

### Step 3 — Load the project horizon

```sql
select id, name, be_score, category, status, color, priority,
       becoming_statement, description, notes,
       start_date, due_date, created_at
from projects
where status = 'active'
order by be_score desc nulls last;

select project_id, name, impact, priority, status, due_date
from tasks
where status in ('todo','in_progress')
order by impact desc nulls last, priority asc, due_date asc nulls last
limit 40;
```

Also read the project memory files for the *why* behind each project — `becoming_statement` alone does not carry the context. The convention is one file per project at:

```
~/.claude/projects/PersonalOS/memory/project_<slug>.md
```

Where `<slug>` is the project name lowercased with spaces replaced by underscores. Read all that exist; tolerate missing ones.

### Step 4 — Load today's calendar terrain

Use the Google Calendar MCP (timezone America/Los_Angeles):

```
list_events(
  startTime = "<target_date>T04:00:00-07:00"   # -08:00 outside DST
  endTime   = "<target_date + 1 day>T04:00:00-07:00"
  timeZone  = "America/Los_Angeles"
)
```

Capture summary, start, end, location for each event. Store as `calendar_snapshot` (jsonb). Use it to understand the day's *shape* — empty, dense, one anchor, deposition, a single call, nothing scheduled — which informs the paragraph. It does not appear as a list.

If Calendar is not granted, still run — orient from tasks + projects.

### Step 5 — Distill

Before writing, ask three questions silently:

1. **What is the longest-arc thing that would be off about today if today went wrong?** That is the mindset.
2. **What are the 1–3 specific moves that make today right for that mindset?** Those are the actions.
3. **What is the pull that will try to take him off the mindset?** That is the trap, worth naming only if load-bearing.

Write the paragraph. Reread. Cut anything that doesn't earn its place. Target ~80–150 words. Over 200 is a yellow flag — compress. The paragraph you produce is both `orientation` and `full_text`. They are the same string.

### Step 6 — Write the debrief

```sql
insert into debriefs (
  date, schema_version,
  prior_snapshot_id, prior_snapshot_date,
  horizon_read, month_read, week_read,
  yesterday_read, today_terrain, orientation,
  full_text,
  horizon_snapshot, calendar_snapshot, tasks_snapshot,
  reflections_snapshot, snapshots_snapshot,
  generated_by, triggered_by
) values (
  '<target_date>', 2,
  <prior_snapshot_id_or_null>, <prior_snapshot_date_or_null>,
  null, null, null,
  null, null, <paragraph>,
  <paragraph>,
  <horizon_snapshot_jsonb>, <calendar_snapshot_jsonb>, <tasks_snapshot_jsonb>,
  <reflections_snapshot_jsonb>, <snapshots_snapshot_jsonb>,
  'claude_skill_debrief_v2',
  <triggered_by>   -- 'scheduled' or 'manual'
)
on conflict (date) do update set
  schema_version       = excluded.schema_version,
  prior_snapshot_id    = excluded.prior_snapshot_id,
  prior_snapshot_date  = excluded.prior_snapshot_date,
  horizon_read         = null,
  month_read           = null,
  week_read            = null,
  yesterday_read       = null,
  today_terrain        = null,
  orientation          = excluded.orientation,
  full_text            = excluded.full_text,
  horizon_snapshot     = excluded.horizon_snapshot,
  calendar_snapshot    = excluded.calendar_snapshot,
  tasks_snapshot       = excluded.tasks_snapshot,
  reflections_snapshot = excluded.reflections_snapshot,
  snapshots_snapshot   = excluded.snapshots_snapshot,
  generated_at         = now(),
  generated_by         = excluded.generated_by,
  triggered_by         = excluded.triggered_by;
```

`schema_version = 2` marks the shift from six-lens prose to single-paragraph output. The six prose columns (`horizon_read` … `today_terrain`) are kept nullable for schema continuity and left null.

### Step 7 — Report to the user

Return a short confirmation: the date and a link to the UI.

> Morning debrief for 2026-04-20 written. [Open PersonalOS →](https://...)

Nothing more. No quote, no preview. The paragraph is short enough that reprinting it in chat would effectively give him the debrief twice. Don't.

---

## Triggers

1. **Manual** — the user (or UI button) invokes the skill. `triggered_by='manual'`.
2. **Scheduled** — A scheduled task fires each morning. `triggered_by='scheduled'`. If a manual debrief already exists for the day, the scheduled run skips.

```sql
select triggered_by, generated_at from debriefs where date = <target_date>;
```

Manual wins. Scheduled defers.

---

## What not to do

- Do NOT write six paragraphs. One paragraph. The columns `horizon_read`, `month_read`, `week_read`, `yesterday_read`, `today_terrain` are schema-continuity placeholders; leave them null.
- Do NOT summarize the calendar. "You have 3 meetings today" is not orientation.
- Do NOT enumerate tasks. The UI shows tasks. Name which 1–3 moves today is really about.
- Do NOT congratulate him for yesterday.
- Do NOT use coaching phrases: "make sure", "remember", "try to", "don't forget".
- Do NOT include "Good morning, the user" or any preamble. The paragraph starts with the mindset.
- Do NOT mention the debrief itself ("This morning's debrief covers…"). Self-reference is filler.
- Do NOT quote project memory files verbatim. They exist to ground *your* read, not to be cited.

## When inputs are thin

- **No prior snapshot**: orient from projects + calendar alone. If the absence is load-bearing for today (unclosed loop), name it in a single clause — don't build the whole paragraph around it.
- **No prior reflections**: fine. The paragraph is written from project state and terrain.
- **No calendar access**: orient from tasks + projects.

Graceful degradation is better than fabrication.
