---
name: personalos-add-project
description: >
  BECOME-native project intake protocol for PersonalOS. Use this skill every time
  the user says "add a project", "create a project", "new project", "I want to start
  a project", or any similar request to add something to the PersonalOS project system.
  This skill guides an interview across 4 layers (Being, Doing, Becoming, Foundation)
  before touching Supabase. Supports both standalone projects and sub-projects nested
  under a parent. Never skip the interview — always complete all 4 layers.
---

# PersonalOS — Add Project Protocol

A new project isn't just a task list. It's a commitment to becoming someone. This protocol makes sure every project added to PersonalOS is worth adding — anchored in identity, defined clearly, and ready to execute.

Run the interview below, one layer at a time. Ask conversationally, not as a form dump. Wait for each answer before moving to the next layer. Reflect back what you hear to confirm understanding.

---

## Layer 0 — SCOPE CHECK
*Is this a standalone project or part of something bigger?*

Before the interview, ask one question:
- "Is this a standalone project, or does it belong under an existing project as a sub-project?"

If it's a **sub-project**: query Supabase for the current project list so the user can confirm which parent it belongs to. Save the parent's UUID as `parent_id` — include it in the INSERT. Sub-projects go through the full 4-layer interview. They inherit their parent's color unless the user specifies otherwise.

If it's **standalone**: `parent_id` is null. Proceed to Layer 1.

---

## Layer 1 — BEING
*Who does this project make you?*

Ask:
1. "What identity does this project build? When it's done, who are you — what's changed about how you see yourself or how the world sees you?"

The answer becomes the `becoming_statement`. Be score is NOT manually set — it is calculated automatically from the impact scores of all tasks added to the project. Every task added with a high impact raises Be; every low-impact task lowers it slightly. Be is a live reflection of the identity-depth of the work being chosen, not a self-declared number.

---

## Layer 2 — DOING
*What exactly are you shipping?*

Ask:
2. "What is the single clearest definition of done? One sentence — what exists in the world when this project is complete that doesn't exist today?"
3. "What's the time horizon? (This week / this month / this quarter / open-ended)"
4. "What category fits best? (business / health / finance / creative / personal / learning)"

The definition of done becomes `description`. If the user struggles to give one sentence, help them sharpen it — vague definitions lead to infinite projects.

---

## Layer 3 — BECOMING
*What does this transform?*

Ask:
5. "When this is done, what does it unlock? What becomes possible that isn't possible today?"
6. "What's the single biggest threat that could kill this project before it ships — the most likely reason it doesn't get done?"

Question 5 reveals whether the project is truly generative or just a task. Question 6 surfaces the obstacle now so it can become a Foundation task.

---

## Layer 4 — FOUNDATION
*What's the first move?*

Ask:
7. "What's the single first task — the one thing that, if it isn't done, nothing else can start? Not a list. Just one."

This becomes the first task inserted alongside the project, with impact = 5 (Foundation).

---

## Confirmation

Summarize back to the user before inserting:
- Project name (+ parent project name if sub-project)
- Becoming statement
- Definition of done
- Category + time horizon
- What it unlocks
- Biggest threat
- First Foundation task

Say: "Here's what I've captured — does this look right before I add it?"

---

## Step 1 — Insert into Supabase

Once confirmed, for a **standalone project**:

```sql
INSERT INTO projects (name, description, becoming_statement, category, status, priority, color, notes)
VALUES (
  '[name]',
  '[definition of done]',
  '[becoming_statement]',
  '[category]',
  'active',
  'high',
  '[color from guide below]',
  '[notes: what it unlocks + biggest threat + any other context from the interview]'
)
RETURNING id;
```

For a **sub-project** (include parent_id):

```sql
INSERT INTO projects (name, description, becoming_statement, category, status, priority, color, notes, parent_id)
VALUES (
  '[name]',
  '[definition of done]',
  '[becoming_statement]',
  '[category]',
  'active',
  'high',
  '[color — inherit from parent or new]',
  '[notes]',
  '[parent_project_uuid]'
)
RETURNING id;
```

Note: do NOT set be_score manually. It is auto-calculated by a Supabase trigger from task impact scores. It starts at 0 and rises as tasks are added.

Save the returned `id` — you need it for the task insert and the memory file.

---

## Step 2 — Save project memory file

After inserting, create a memory file at:
`~/.claude/projects/PersonalOS/memory/project_[slug].md`

Where `[slug]` is the project name lowercased with spaces replaced by underscores (e.g., `project_fitness.md`, `project_taxes.md`).

Use this exact format:

```markdown
---
name: Project Context — [Project Name]
description: Full context for [Project Name] — becoming statement, goals, constraints, and key decisions
type: project
---

## What this project is
[1-2 sentences: the definition of done]

## Who it makes the user
[The becoming_statement verbatim]

## Parent project (if sub-project)
[Parent project name + UUID, or "Standalone"]

## What it unlocks
[From Layer 3, question 5]

## Biggest threat
[From Layer 3, question 6 — the most likely failure mode]

## Category & time horizon
[category] — [time horizon]

## Key context & decisions
[Any other relevant context from the interview — constraints, dependencies, what's been decided, what's still open]

## Supabase project ID
[The UUID returned from the INSERT]
```

Then add a line to `~/.claude/projects/PersonalOS/memory/MEMORY.md`:
```
- [Project Context — [Name]](project_[slug].md) — [becoming_statement in one line]
```

---

## Step 3 — Insert Foundation task

Use the **personalos-add-task** protocol for the Foundation task identified in Layer 4. Since you already have full project context from the interview, skip straight to the insert step — state the reasoning (impact = 5, it's the first unblocking task) and insert:

```sql
INSERT INTO tasks (project_id, name, status, priority, impact)
VALUES ('[project_id]', '[foundation task name]', 'todo', 'critical', 5);
```

---

## Confirm completion

Report back:
- ✅ Project name + Supabase ID (+ parent project if sub-project)
- ✅ Memory file saved at `project_[slug].md`
- ✅ First Foundation task added (impact 5)

---

## Color guide
- business → #6366f1 (indigo)
- health → #22c55e (green)
- finance → #f59e0b (amber)
- creative → #ec4899 (pink)
- personal → #8b5cf6 (purple)
- learning → #06b6d4 (cyan)
