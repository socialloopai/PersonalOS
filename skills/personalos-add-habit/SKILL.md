---
name: personalos-add-habit
description: >
  Add habits to the PersonalOS Soul tab. Use whenever the user says "add a habit",
  "new habit", "I want to start doing X every day", "track X", or anything about
  building a recurring daily/weekly practice. Also trigger when he says "soul tab",
  "soul habits", or asks about habit tracking. This is the identity-layer companion
  to personalos-add-task — tasks are things you DO, habits are things you ARE.
  Always use this skill for any habit creation, never add habits as regular tasks.
---

# PersonalOS — Add Habit Protocol (Soul Tab)

Habits are the daily evidence of Being. A project has tasks you complete. A habit is something you sustain — recurring proof that you ARE the person your becoming statements describe.

The Soul tab is self-contained. It has its own score, its own tracking, and doesn't mathematically touch project Be/Do/Become.

## The 3-Layer Interview

Run all 3 layers conversationally. Don't dump them as a form.

### Layer 1 — Identity
"What does this habit prove about who you are?"

The answer becomes the `becoming_connection`. This is the soul of the habit — not what you do, but who it makes you.

Example: "Training every day proves I am disciplined and in control of my body."
Example: "Reviewing my task list every morning proves I am organized and nothing slips through."

### Layer 2 — Structure
Ask:
1. "How often? (daily / specific days like mon-wed-fri / weekly)"
2. "When in the day? (morning / afternoon / evening / anytime)"
3. "Does this anchor to a specific project, or is it pure identity?" (optional — e.g., "Train" anchors to Fitness, "Meditate" anchors to self)

### Layer 3 — Commitment
"What's the minimum viable version of this habit on your worst day?"

This is critical. The habit that survives bad days is the one that compounds. If the habit is "Train," the minimum might be "20 pushups at home." If it's "Read," the minimum might be "one page." This becomes the `minimum_version` field.

Say: "The minimum version is what keeps the streak alive when everything else falls apart. It's not the goal — it's the floor."

## Confirmation

Summarize back:
- Habit name
- Becoming connection
- Frequency + time of day
- Project anchor (or "self")
- Minimum version on worst day

"Does this look right before I add it to your Soul?"

## Insert

```sql
INSERT INTO soul_items (type, name, becoming_connection, frequency, time_of_day, project_id, minimum_version, status, streak, best_streak)
VALUES ('habit', '[name]', '[becoming_connection]', '[frequency]', '[time_of_day]', [project_id or NULL], '[minimum_version]', 'active', 0, 0)
RETURNING id;
```

Report back: habit name, becoming connection, frequency, and that the streak starts at 0.

## Logging a Completion (when user says "I did X" or taps on dashboard)

When the user reports completing a habit:

```sql
INSERT INTO soul_logs (soul_item_id, completed_at)
VALUES ('[habit_id]', CURRENT_DATE)
ON CONFLICT (soul_item_id, completed_at) DO NOTHING;
```

Then update the streak:
```sql
UPDATE soul_items SET
  streak = (
    SELECT COUNT(*) FROM (
      SELECT completed_at, completed_at - (ROW_NUMBER() OVER (ORDER BY completed_at DESC))::int AS grp
      FROM soul_logs WHERE soul_item_id = '[habit_id]'
    ) sub WHERE grp = (
      SELECT completed_at - (ROW_NUMBER() OVER (ORDER BY completed_at DESC))::int
      FROM soul_logs WHERE soul_item_id = '[habit_id]'
      ORDER BY completed_at DESC LIMIT 1
    )
  ),
  best_streak = GREATEST(best_streak, streak + 1),
  updated_at = now()
WHERE id = '[habit_id]';
```

(Or use a simpler approach: count consecutive days backward from today in soul_logs for that habit.)

## Soul Score

Soul Score = (habits completed today / total active habits) x 100 for daily view.
Weekly consistency = (total completions this week / total expected this week) x 100.

These are displayed on the Soul tab, separate from project scores.

## Quick-add mode

If the user gives everything in one sentence ("add a habit: train every day, it proves I'm disciplined, minimum is 20 pushups"), skip the interview and go straight to confirmation + insert. The interview exists for when the user just says "add a habit" without details.
