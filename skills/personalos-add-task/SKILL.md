---
name: personalos-add-task
description: >
  Impact-scored task intake protocol for PersonalOS. Use this skill every time
  the user says "add a task", "new task", "add tasks", "I need to add something to
  [project]", or any request to add a task to any PersonalOS project. ALSO use this
  skill when the user asks "what should I do", "what should I work on", "suggest tasks",
  "what's next on [project]", or any question about what to do next — this triggers
  Suggest Mode, which generates tasks from the BECOME formula (Variation 2: Do = Become ÷ Be).
  Never assign impact without context. Never skip this protocol.
---

# PersonalOS — Add Task Protocol

This skill has two modes. Detect which one applies from how the user phrases the request:

- **Add Mode** — user provides a specific task name → run the 5-step impact protocol
- **Suggest Mode** — user asks what to do, what's next, or wants task recommendations → run the Suggest Protocol below

---

## SUGGEST MODE — Do = Become ÷ Be

*Triggered by: "what should I do?", "what's next?", "suggest tasks", "what should I work on?"*

This uses Variation 2 from the BECOME document: **Do = Become ÷ Be**
*"Your required actions are literally the ratio between your future and present self."*

You know the target Become (the becoming_statement). You know the current Be (live from task impacts). The formula tells you what Do needs to be — and therefore what tasks would close the gap.

### Suggest Step 1 — Load full project state

Read the memory file AND query Supabase together:

```sql
SELECT
  p.name, p.description, p.becoming_statement, p.be_score, p.notes,
  t.name as task, t.status, t.impact
FROM projects p
LEFT JOIN tasks t ON t.project_id = p.id
WHERE p.name = '[project]'
ORDER BY t.impact DESC NULLS LAST;
```

Also fetch the latest 5 snapshots to understand trajectory:
```sql
SELECT be_score, do_score, become_score, reason, created_at
FROM project_snapshots
WHERE project_id = '[id]'
ORDER BY created_at DESC LIMIT 5;
```

### Suggest Step 2 — Diagnose the current BECOME state

Calculate live scores:
- **Be** = avg(active task impacts) / 5 × 10
- **Do** = weighted completion ratio × 10
- **Become** = Be × Do
- **Current status** = which status label applies (Visionary / Grinding / On Track / etc.)
- **Trend** = is Become accelerating, plateauing, or declining from snapshots?

Then apply Variation 2:
- **Required Do** = to fully realize the becoming_statement, we treat target Become as 100 (full transformation)
- **Do gap** = (100 / Be) − current Do (how far Do needs to travel)
- **Compounding truth** (Variation 18): always invest in whichever variable is currently lower — Be or Do

### Suggest Step 3 — Generate task suggestions

Based on the diagnosis, generate 3–5 concrete task suggestions. Each suggestion must:
- Be directly anchored to the `becoming_statement` — not generic, not invented, real
- Address what the current status says needs fixing
- Be specific enough to act on immediately (not "improve the product" — "build the creator profile page")

Use the current status to guide the type of tasks suggested:

| Current Status | Suggest tasks that... |
|---------------|----------------------|
| 👁️ Visionary — Ship More | Execute and ship — move things from in_progress to done, unblock waiting tasks |
| ⚠️ Grinding — Go Deeper | Deepen identity — add Foundation/Leverage tasks tied directly to the becoming_statement |
| 🔒 Be Ceiling | Raise identity engagement — add high-impact tasks that reconnect to the becoming_statement |
| 📊 Do Plateau | Break the action freeze — find the single blocked task and unblock it |
| ⏸️ Stalling | Find what's blocking execution — suggest the one task that restarts momentum |
| 🚨 Losing Identity | Stop adding low-impact work — suggest a Foundation task that re-anchors to becoming_statement |
| ✅ On Track | Compound momentum — suggest the highest-leverage next step to accelerate Become |
| 🔥 Crushing It | Keep the flywheel spinning — suggest what amplifies both Be and Do simultaneously |
| 🌑 Fading Out | Emergency restart — suggest one Foundation task that proves the project is alive |

### Suggest Step 3.5 — Paint the journey map

Before showing task suggestions, show the full map. This orients the user so suggestions have context.

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  [Project Name] — Journey to Becoming
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  Becoming: "[becoming_statement]"

  Be   [████████░░] 8.0   ↑   (identity depth)
  Do   [███░░░░░░░] 3.0   →   (execution)
  Become  24 / 100   — 24% realized

  You are here:  👁️ Visionary — Ship More
  Next threshold: ⚡ Aligned (Do needs to reach ~7.5)
  Full becoming:  🔥 Crushing It (Be ≥ 7, Do ≥ 7)

  Fastest path: Do is your bottleneck.
  Compounding truth (var. 18): invest in Do until Be = Do.
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

Map rules:
- **Become % = (Be × Do) / 100** — 100 is the full potential (Be=10, Do=10)
- **Progress bar** = filled blocks proportional to score out of 10 for Be and Do
- **Trend arrows** = derived from snapshot history (↑↑ ↑ → ↓ ↓↓)
- **You are here** = current status label from the status engine
- **Next threshold** = the next status state and what it takes to get there
- **Bottleneck** = whichever of Be or Do is lower — that's where to invest (Variation 18)
- **Fastest path** = one line saying what kind of tasks to add to compound fastest

Waypoint thresholds to calculate next milestone from:
- Fading Out → Building: either Be or Do breaks above 3
- Building → On Track: Be ≥ 5 AND Do ≥ 4
- On Track → Aligned: |Be − Do| < 1.5 with both ≥ 5
- Aligned → Crushing It: both ≥ 7
- Crushing It → Mastery: Be = Do = Become (all three equal)

If snapshots exist, add one line of trajectory:
> "At current pace (+X Become per task), you reach ⚡ Aligned in ~N tasks."

Estimate N = (Become needed for next threshold − current Become) / avg Become gain per snapshot.

---

### Suggest Step 4 — Present suggestions with impact scores

After the map, show 3–5 task suggestions anchored to the becoming_statement:

```
━━━━ Suggested next moves ━━━━

1. [Task name]
   Impact: 5 (Foundation)
   Why: [one sentence tied to becoming_statement and what it unblocks]
   Map shift: Do +X → Become moves from 24 → ~35

2. [Task name]
   Impact: 4 (Leverage)
   Why: [one sentence]
   Map shift: Do +X → Become moves from 24 → ~29

3. [Task name]
   Impact: 3 (Progress)
   Why: [one sentence]
   Map shift: Do +X → Become moves from 24 → ~27
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

Show the map shift for each suggestion — exactly where on the journey each task lands you.

Then ask: *"Which of these do you want to add? Pick one, several, or all — or tell me what you actually want to work on and I'll score it."*

### Suggest Step 5 — Add selected tasks

For each task the user selects, run the standard Add Mode Steps 4–5 (score confirmation + Supabase insert). The context from Step 2 means you can skip straight to insert — you already have the full picture.

---

## ADD MODE — User provides a specific task

*Triggered by: "add a task: [name]", "new task: [name]", "I need to add [task] to [project]"*

Run all 5 steps. No exceptions.

### Step 1 — Load project memory file

Read from: `~/.claude/projects/PersonalOS/memory/project_[slug].md`
If unsure of slug, check `~/.claude/projects/PersonalOS/memory/MEMORY.md`

The memory file gives you: definition of done, becoming_statement, biggest threat, key decisions, Supabase project ID.

### Step 2 — Query current task state

```sql
SELECT name, status, impact, priority
FROM tasks
WHERE project_id = '[project_id]'
ORDER BY impact DESC NULLS LAST;
```

### Step 3 — Map current state: done / in progress / blocked

- Which Foundation tasks are complete?
- What is in_progress?
- What is blocked — what's the critical path right now?
- Does the current task state match what the becoming_statement requires?

### Step 4 — Score with reasoning

Impact scale:
- **5 — Foundation**: nothing else moves without this
- **4 — Leverage**: unlocks multiple downstream tasks
- **3 — Progress**: meaningful forward movement, not blocking anything
- **2 — Support**: helpful, deferrable
- **1 — Maintenance**: polish, cleanup, admin

State score + reasoning before inserting:
> "Impact: 4 (Leverage) — [becoming_statement] depends on this unblocking X and Y"

### Step 5 — Insert and confirm

```sql
INSERT INTO tasks (project_id, name, status, priority, impact)
VALUES ('[project_id]', '[task name]', 'todo', '[critical/high/medium/low]', [impact]);
```

Report back: task name, impact score, one-line reasoning, Do score direction.

---

## If no memory file exists for the project

Query Supabase directly for the full project record and use it as context. After adding, offer to create the memory file retroactively.

---

## How Be is calculated

Be is auto-calculated by Supabase trigger on every task change:
`Be = (avg impact of active tasks / 5) × 10`

Be zones: 7–10 deep engagement · 4–6 execution phase · 1–3 identity drift warning · 0 void

## Status reference

| Status | Condition | BECOME Variation |
|--------|-----------|-----------------|
| 🔥 Crushing It | Be ≥ 7, Do ≥ 7 | 24 |
| ⚡ Aligned | Be ≈ Do, Be ≥ 5 | 8 |
| 🌟 Mastery State | Be = Do = Become | 11 |
| 🏁 Arrived — Sustain | Do ≥ 9, Be ≥ 8 | 9 |
| 🚀 Accelerating | Become rate increasing | 35 |
| 📉 Decelerating | Become rate slowing | 35 |
| 🔒 Be Ceiling | Be fixed, Do growing | 14 |
| 📊 Do Plateau | Do fixed, Be growing | 15 |
| 👁️ Visionary — Ship More | Be − Do > 2.5 | 22 |
| ⚠️ Grinding — Go Deeper | Do − Be > 2.5 | 23 |
| 🚨 Losing Identity | Be < 3 | 36 |
| ⏸️ Stalling | Do < 3 | 4 |
| 🌑 Fading Out | Both near zero | 7 |
| ⛔ Identity Void | Be = 0 | 5 |

## Common traps

- Don't assign 5 just because a task sounds important. 5 means nothing else moves without it.
- Don't assign 3 by default — review the task list first.
- Cancelled tasks excluded from Be and Do.
- Adding low-impact tasks to a "🚨 Losing Identity" project makes it worse — flag before inserting.
- Suggestions must be anchored to the becoming_statement — never generic busywork.
