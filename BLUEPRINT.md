# Personal OS — Project + Task Architecture

A shareable blueprint for identity-anchored execution. Drop this into your own project, fill in the blanks, and you have the full triage and prioritization system.

---

## Core Idea

Every project is a commitment to becoming someone. Every task is a vote toward that identity. The system's job is to make the gap between who you are now and who you're becoming measurable, so the next right action is always visible.

**Three signals, two modes, one ritual.**

---

## The Context Stack

Any triage or prioritization call loads four layers together. Never one without the others — that's the whole point.

```
Layer                Source                      Answers
───────────────────  ──────────────────────────  ──────────────────────────────
1. Identity          projects.becoming_statement "Who does this make me?"
2. Current state     tasks WHERE project_id      "What's on my plate right now?"
3. Trajectory        project_snapshots (last 5)  "Am I accelerating or drifting?"
4. Memory            project_[slug].md file      "What do I already know?"
```

**Rule:** if any layer is missing, stop and repair it before triaging.

---

## Minimum Schema

```
Table               Column                  Type         Notes
──────────────────  ──────────────────────  ───────────  ─────────────────────
projects            id                      uuid PK
                    name                    text
                    description             text         Definition of done
                    becoming_statement      text         Identity target
                    category                text         business/health/etc.
                    status                  text         active / archived
                    priority                text
                    be_score                numeric      AUTO via trigger
                    color                   text         Per-category palette
                    parent_id               uuid FK      NULL = standalone
                    notes                   text         Unlocks + threat
                    start_date, due_date    date
                    created_at, updated_at  timestamptz

tasks               id                      uuid PK
                    project_id              uuid FK
                    name                    text
                    description             text
                    status                  text         todo/in_progress/done/cancelled
                    priority                text         critical/high/medium/low
                    impact                  smallint     1–5, drives Be
                    due_date                date         REQUIRED in practice
                    completed_at            timestamptz
                    created_at, updated_at  timestamptz

project_snapshots   id                      uuid PK
                    project_id              uuid FK
                    be_score                numeric
                    do_score                numeric
                    become_score            numeric
                    reason                  text         One-line why
                    created_at              timestamptz
```

---

## The SQL Trigger (automation spine)

Whenever a task changes, recompute Be for its project. Do this as a trigger, not in app code, or you'll get drift.

```
Be = (AVG(impact) filtered to status NOT IN ('done','cancelled')) / 5 * 10
```

This makes Be a live reflection of the identity-depth of active work. Deleting low-impact work does raise Be — that's a feature, not a bug, *if* impact is assigned honestly. The skill protocol enforces the honesty.

---

## The Three Signals

```
Signal   Formula                                 Range    Meaning
───────  ──────────────────────────────────────  ───────  ──────────────────────
Be       avg(impact of active tasks) / 5 × 10    0–10     Identity depth
Do       weighted completion ratio × 10          0–10     Execution pace
Become   Be × Do                                 0–100    Realized transformation
```

Three variations worth burning into the system:

```
Variation 2    Do = Become ÷ Be    "actions = future self ÷ present self"
Variation 18   Invest in whichever is lower (compounding truth)
Variation 11   Be = Do = Become (mastery)
```

---

## Impact Scale (drives Be, do not dilute)

```
Score  Label        Definition
─────  ───────────  ───────────────────────────────────────────────────────
5      Foundation   Nothing else moves without this
4      Leverage     Unlocks multiple downstream tasks
3      Progress     Meaningful forward movement, not blocking anything
2      Support      Helpful, deferrable
1      Maintenance  Polish, cleanup, admin
```

**Trap:** don't default to 3. Look at the existing task list first, then place the new task relative to it.

---

# Add Project — 4-Layer Interview

A project isn't just a task list — it's a commitment to becoming someone. Walk the four layers conversationally. Reflect answers back. Insert last.

## Layer 0 — SCOPE

> "Standalone project, or sub-project under an existing one?"

If sub-project: query existing projects, confirm parent, save `parent_id`.

## Layer 1 — BEING

> Q1: "What identity does this build? When it's done, who are you — what's changed about how you see yourself or how the world sees you?"

Becomes `becoming_statement`. **Do NOT set `be_score` manually** — the trigger handles it.

## Layer 2 — DOING

> Q2: "Single clearest definition of done — one sentence. What exists in the world when this is complete that doesn't exist today?"
>
> Q3: "Time horizon? (this week / month / quarter / open-ended)"
>
> Q4: "Category? (business / health / finance / creative / personal / learning)"

Q2 becomes `description`. Sharpen if vague.

## Layer 3 — BECOMING

> Q5: "When this is done, what does it unlock? What becomes possible?"
>
> Q6: "Single biggest threat that could kill this before it ships?"

Q5 tests whether the project is generative or just a task. Q6 becomes a Foundation task candidate.

## Layer 4 — FOUNDATION

> Q7: "Single first task — the one thing that, if it isn't done, nothing else can start. Not a list. Just one."

Becomes first task at impact = 5.

## Insert Sequence (atomic)

1. Summarize back, wait for confirmation.
2. `INSERT INTO projects (...) RETURNING id;`
3. Save `project_[slug].md` memory file with the full interview context.
4. `INSERT INTO tasks (project_id, name, status, priority, impact) VALUES (id, foundation_task, 'todo', 'critical', 5);`
5. Confirm: project id + memory path + first task.

## Memory File Template

```markdown
---
name: Project Context — [Name]
description: Full context for [Name]
type: project
---

## What this project is
[definition of done]

## Who it makes you
[becoming_statement verbatim]

## Parent project
[Parent name + UUID, or "Standalone"]

## What it unlocks
[from Q5]

## Biggest threat
[from Q6]

## Category & time horizon
[category] — [horizon]

## Key context & decisions
[constraints, dependencies, open questions]

## Supabase project ID
[UUID]
```

---

# Add Task — Two Modes

Detect mode from phrasing:

```
Add Mode       "add a task", "new task: [name]"
Suggest Mode   "what should I do", "what's next", "suggest tasks"
```

## Add Mode — user provides a specific task (5 steps, no skipping)

### Step 1 — Load project memory file

Read `/memory/project_[slug].md`. Gives: definition of done, becoming statement, biggest threat, decisions.

### Step 2 — Query current task state

```sql
SELECT name, status, impact, priority, due_date
FROM tasks WHERE project_id = :id
ORDER BY impact DESC NULLS LAST;
```

### Step 3 — Map the state

- Which Foundation tasks are complete?
- What's in_progress?
- What's blocked — what's the critical path right now?
- Does current state match what the becoming_statement requires?

### Step 4 — Score with reasoning (state BEFORE inserting)

> "Impact: 4 (Leverage) — becoming_statement depends on this unblocking X and Y."

### Step 5 — Insert and confirm

```sql
INSERT INTO tasks (project_id, name, status, priority, impact, due_date)
VALUES (:id, :name, 'todo', :priority, :impact, :due_date);
```

Report: name, impact + reasoning, predicted Do-direction, deadline.

---

## Suggest Mode — user asks what to do (5 steps via `Do = Become ÷ Be`)

### Step 1 — Load full project state

Memory file + SQL together:

```sql
SELECT p.name, p.becoming_statement, p.be_score, p.notes,
       t.name AS task, t.status, t.impact, t.due_date
FROM projects p
LEFT JOIN tasks t ON t.project_id = p.id
WHERE p.id = :id
ORDER BY t.impact DESC NULLS LAST;
```

Plus latest 5 snapshots for trajectory:

```sql
SELECT be_score, do_score, become_score, reason, created_at
FROM project_snapshots
WHERE project_id = :id
ORDER BY created_at DESC LIMIT 5;
```

### Step 2 — Diagnose the BECOME state

```
Be     = avg(active impacts)/5 * 10
Do     = weighted completion ratio * 10
Become = Be * Do
Status = which of 14 labels applies
Trend  = Become accelerating / plateauing / declining?
```

Apply **Variation 2**:
- Required Do at full becoming = `100 / Be`
- Do gap = `required - current`

Apply **Variation 18**:
- Invest in whichever is lower — Be or Do.

### Step 3 — Generate 3–5 task suggestions anchored to `becoming_statement`

Rules:
- Tied directly to the becoming_statement (not generic)
- Addresses what current status says to fix
- Specific enough to act on today

Status → suggestion type:

```
Visionary       → ship what's queued, unblock waiting work
Grinding        → add Foundation/Leverage tied to identity
Be Ceiling      → raise identity engagement
Do Plateau      → break the freeze, unblock the one task
Stalling        → restart momentum
Losing Identity → one Foundation task that re-anchors
Fading Out      → emergency restart — prove the project is alive
On Track        → compound momentum, highest-leverage next step
Crushing It     → amplify both Be and Do simultaneously
```

### Step 3.5 — Paint the journey map BEFORE showing suggestions

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  [Project] — Journey to Becoming
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  Becoming: "[becoming_statement]"

  Be   [████████░░] 8.0  ↑   (identity depth)
  Do   [███░░░░░░░] 3.0  →   (execution)
  Become  24 / 100   — 24% realized

  You are here:   [current status label]
  Next threshold: [next waypoint] (what it takes)
  Full becoming:  Crushing It (Be ≥ 7, Do ≥ 7)

  Fastest path:   [Be|Do] is the bottleneck.
  (Var. 18: invest in [Be|Do] until they match.)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

Waypoints:

```
Fading Out → Building:    Be or Do > 3
Building   → On Track:     Be ≥ 5 AND Do ≥ 4
On Track   → Aligned:      |Be − Do| < 1.5, both ≥ 5
Aligned    → Crushing It:  both ≥ 7
Crushing   → Mastery:      Be = Do = Become
```

### Step 4 — Present suggestions with map-shift per item

```
━━━━ Suggested next moves ━━━━

1. [Task name]
   Impact: 5 (Foundation)
   Why: [one sentence tied to becoming + what it unblocks]
   Map shift: Do +X → Become moves 24 → ~35

2. [Task name]
   Impact: 4 (Leverage)
   Why: [one sentence]
   Map shift: Do +X → Become moves 24 → ~29
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

Then ask: *"Which do you want to add? Pick one, several, or all — or tell me what you want to work on and I'll score it."*

### Step 5 — Insert selected tasks

Run Add Mode Steps 4–5 per selection. Context is already loaded.

---

## Live Status Labels (14)

```
Label               Condition
──────────────────  ────────────────────────────────────────────────────────
Crushing It         Be ≥ 7, Do ≥ 7
Aligned             Be ≈ Do, Be ≥ 5
Mastery             Be = Do = Become
Arrived             Do ≥ 9, Be ≥ 8
Accelerating        Become rate increasing
Decelerating        Become rate decreasing
Be Ceiling          Be fixed, Do growing
Do Plateau          Do fixed, Be growing
Visionary           Be − Do > 2.5     (thinking > shipping)
Grinding            Do − Be > 2.5     (shipping > identity)
Losing Identity     Be < 3
Stalling            Do < 3
Fading Out          both near zero
Identity Void       Be = 0
```

---

## The Full Loop (how context compounds over time)

```
┌─────────────────────┐
│   Add Project       │── 4-layer interview → identity + memory file
└──────────┬──────────┘
           │
           ▼
┌─────────────────────┐
│   Add Task          │── impact scored against current state
└──────────┬──────────┘
           │
           ▼
┌─────────────────────┐
│   SQL Trigger       │── recomputes Be live
└──────────┬──────────┘
           │
           ▼
┌─────────────────────┐
│   Daily Ritual      │── snapshot writes Be/Do/Become row
└──────────┬──────────┘
           │
           ▼
┌─────────────────────┐
│   Suggest Mode      │── reads snapshots → shows trajectory
└──────────┬──────────┘
           │
           └─────────► next task's impact is chosen
                       against the whole trajectory,
                       not in isolation
```

---

## Common Traps (encode these into your protocols)

- Don't assign impact 5 just because it sounds important. 5 means nothing else moves without it.
- Don't default to 3. Review the existing list first.
- Cancelled tasks are excluded from Be and Do — not deleted.
- Adding low-impact tasks to a "Losing Identity" project makes it worse — flag before inserting.
- Suggestions must be anchored to the `becoming_statement` — never generic busywork.
- Every task should carry a `due_date`. Without one, triage is blind to urgency even if impact is right.
- One source of truth for Be (trigger). Never compute it in app code.

---

*The loop compounds value the longer it runs — `project_snapshots` grows into a trajectory record that makes Suggest Mode's advice increasingly specific.*
