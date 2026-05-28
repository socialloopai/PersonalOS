-- ─────────────────────────────────────────────────────────────────────────────
--  PersonalOS — Supabase schema skeleton
--  Derived from queries in index.html and skills/*/SKILL.md.
--  Run this in a fresh Supabase project: psql < schema.sql
--  (or paste sections into the Supabase SQL editor)
--
--  This is a STARTING POINT. Types and lengths are inferred from how the app
--  reads/writes each column. Verify against your real usage before depending
--  on it. PRs welcome.
--
--  ⚠️  ON ROW LEVEL SECURITY ⚠️
--  This schema enables RLS on every table but leaves policies PERMISSIVE for
--  the `anon` role — matching the single-user model PersonalOS was built for.
--  That means: anyone with your Supabase URL + anon key can read and write
--  everything. Your security is "keep the URL and key private."
--
--  For multi-user or production use:
--    1. Add Supabase Auth (signInWithPassword) to the frontend
--    2. Add `owner_id uuid REFERENCES auth.users(id)` to every table
--    3. Replace the policies below with `USING (auth.uid() = owner_id)`
--  ─────────────────────────────────────────────────────────────────────────────

-- Extensions
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ─────────────────────────────────────────────────────────────────────────────
--  Helpers
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
--  IDENTITY
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE profile (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name       text,
  email           text,
  phone           text,
  citizenship     text,
  date_of_birth   date,
  address_line1   text,
  address_line2   text,
  city            text,
  state           text,
  zip             text,
  ssn_last4       text,        -- last 4 only; full SSN never stored client-side
  ssn_encrypted   text,        -- if you encrypt server-side, store ciphertext here
  signature_path  text,        -- storage path to signature image
  resting_hr_bpm  integer,     -- fallback when no health data
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER profile_updated BEFORE UPDATE ON profile
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE identity_documents (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_type   text NOT NULL,   -- 'signature' | 'passport' | 'ssn_card' | 'id' | 'other'
  label           text,
  file_name       text,
  file_path       text NOT NULL,   -- storage path (bucket: 'identity-docs')
  uploaded_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX identity_documents_type_idx ON identity_documents(document_type);

-- ─────────────────────────────────────────────────────────────────────────────
--  PROJECTS + TASKS (the BECOME core)
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE projects (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id           uuid REFERENCES projects(id) ON DELETE SET NULL,
  name                text NOT NULL,
  description         text,
  becoming_statement  text,
  category            text,                 -- 'business' | 'health' | 'finance' | 'creative' | 'personal' | 'learning'
  status              text NOT NULL DEFAULT 'active',  -- 'active' | 'completed' | 'archived'
  priority            text DEFAULT 'medium',           -- 'critical' | 'high' | 'medium' | 'low'
  color               text,
  notes               text,
  start_date          date,
  due_date            date,
  be_score            numeric(4,2) DEFAULT 0,  -- auto-computed by trigger below
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX projects_status_idx ON projects(status);
CREATE INDEX projects_parent_idx ON projects(parent_id);
CREATE TRIGGER projects_updated BEFORE UPDATE ON projects
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE tasks (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id    uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name          text NOT NULL,
  description   text,
  status        text NOT NULL DEFAULT 'todo',  -- 'todo' | 'in_progress' | 'done' | 'cancelled'
  priority      text DEFAULT 'medium',         -- 'critical' | 'high' | 'medium' | 'low'
  impact        smallint,                       -- 1 (Maintenance) .. 5 (Foundation)
  due_date      date,
  completed_at  timestamptz,                    -- maintained by trigger below
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX tasks_project_idx ON tasks(project_id);
CREATE INDEX tasks_status_idx ON tasks(status);
CREATE TRIGGER tasks_updated BEFORE UPDATE ON tasks
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- completed_at trigger: set when transitioning to 'done', clear otherwise
CREATE OR REPLACE FUNCTION tasks_completed_at() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status = 'done' AND (OLD.status IS DISTINCT FROM 'done') THEN
    NEW.completed_at := now();
  ELSIF NEW.status <> 'done' AND OLD.status = 'done' THEN
    NEW.completed_at := NULL;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER tasks_completed_at_trg BEFORE UPDATE ON tasks
  FOR EACH ROW EXECUTE FUNCTION tasks_completed_at();

-- Be score trigger: Be = avg(impact of active tasks) / 5 × 10, clamped 0..10
CREATE OR REPLACE FUNCTION projects_recompute_be() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_project_id uuid;
  v_be numeric;
BEGIN
  v_project_id := COALESCE(NEW.project_id, OLD.project_id);
  SELECT COALESCE(AVG(impact)::numeric / 5 * 10, 0) INTO v_be
    FROM tasks
   WHERE project_id = v_project_id
     AND status NOT IN ('done', 'cancelled')
     AND impact IS NOT NULL;
  UPDATE projects SET be_score = LEAST(10, GREATEST(0, v_be)) WHERE id = v_project_id;
  RETURN NULL;
END;
$$;
CREATE TRIGGER tasks_be_recompute
  AFTER INSERT OR UPDATE OR DELETE ON tasks
  FOR EACH ROW EXECUTE FUNCTION projects_recompute_be();

CREATE TABLE project_snapshots (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id    uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  be_score      numeric(4,2),
  do_score      numeric(4,2),
  become_score  numeric(5,2),  -- 0..100
  reason        text,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX project_snapshots_project_idx ON project_snapshots(project_id, created_at DESC);

-- ─────────────────────────────────────────────────────────────────────────────
--  REFLECTIONS + SNAPSHOTS + DEBRIEFS (the synthesis engine)
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE reflections (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  content     text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX reflections_created_idx ON reflections(created_at DESC);
CREATE TRIGGER reflections_updated BEFORE UPDATE ON reflections
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE snapshots (
  id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  date                        date NOT NULL UNIQUE,    -- narrative day (PT, 4am cutoff)
  schema_version              smallint NOT NULL DEFAULT 2,
  reflection_ids              uuid[],
  agg_be                      numeric(4,2),
  agg_do                      numeric(4,2),
  agg_become                  numeric(5,2),
  diagnosis                   text,                    -- 'aligned'|'identity'|'grind'|'collapsed'|'split'
  resonance                   numeric(4,2),
  sleep_be      numeric(4,2), sleep_do      numeric(4,2), sleep_become      numeric(5,2),
  body_be       numeric(4,2), body_do       numeric(4,2), body_become       numeric(5,2),
  food_be       numeric(4,2), food_do       numeric(4,2), food_become       numeric(5,2),
  money_be      numeric(4,2), money_do      numeric(4,2), money_become      numeric(5,2),
  tasks_be      numeric(4,2), tasks_do      numeric(4,2), tasks_become      numeric(5,2),
  reflection_be numeric(4,2), reflection_do numeric(4,2), reflection_become numeric(5,2),
  data_flags                  jsonb,
  delta_be                    numeric(4,2),
  delta_do                    numeric(4,2),
  delta_become                numeric(5,2),
  delta_identity_component    numeric(6,2),
  delta_execution_component   numeric(6,2),
  delta_compared_to           date,
  domains                     jsonb,
  reflection_characterization text,
  insight                     text,
  data_snapshot               jsonb,
  synthesized_at              timestamptz NOT NULL DEFAULT now(),
  synthesized_by              text
);
CREATE INDEX snapshots_date_idx ON snapshots(date DESC);

CREATE TABLE snapshot_runs (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  snapshot_id         uuid REFERENCES snapshots(id) ON DELETE CASCADE,
  date                date NOT NULL,
  schema_version      smallint NOT NULL DEFAULT 2,
  resulted_in_change  boolean NOT NULL DEFAULT true,
  notes               text,
  created_at          timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE debriefs (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  date                  date NOT NULL UNIQUE,
  schema_version        smallint NOT NULL DEFAULT 2,
  prior_snapshot_id     uuid REFERENCES snapshots(id) ON DELETE SET NULL,
  prior_snapshot_date   date,
  horizon_read          text,           -- legacy v1 column, kept nullable
  month_read            text,
  week_read             text,
  yesterday_read        text,
  today_terrain         text,
  orientation           text NOT NULL,  -- the one paragraph (v2)
  full_text             text NOT NULL,
  horizon_snapshot      jsonb,
  calendar_snapshot     jsonb,
  tasks_snapshot        jsonb,
  reflections_snapshot  jsonb,
  snapshots_snapshot    jsonb,
  generated_at          timestamptz NOT NULL DEFAULT now(),
  generated_by          text,
  triggered_by          text             -- 'manual' | 'scheduled'
);

-- ─────────────────────────────────────────────────────────────────────────────
--  SOUL TAB (habits + steps)
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE soul_items (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  type                  text NOT NULL DEFAULT 'habit',  -- 'habit' | 'routine'
  name                  text NOT NULL,
  becoming_connection   text,
  frequency             text,
  time_of_day           text,
  project_id            uuid REFERENCES projects(id) ON DELETE SET NULL,
  minimum_version       text,
  status                text NOT NULL DEFAULT 'active',  -- 'active' | 'archived'
  streak                integer NOT NULL DEFAULT 0,
  best_streak           integer NOT NULL DEFAULT 0,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER soul_items_updated BEFORE UPDATE ON soul_items
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE soul_logs (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  soul_item_id    uuid NOT NULL REFERENCES soul_items(id) ON DELETE CASCADE,
  completed_at    date NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (soul_item_id, completed_at)
);

CREATE TABLE soul_item_steps (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  soul_item_id    uuid NOT NULL REFERENCES soul_items(id) ON DELETE CASCADE,
  order_index     smallint,
  name            text NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE soul_step_logs (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  soul_item_step_id   uuid NOT NULL REFERENCES soul_item_steps(id) ON DELETE CASCADE,
  date                date NOT NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (soul_item_step_id, date)
);

-- ─────────────────────────────────────────────────────────────────────────────
--  LEGAL (USCIS, court, permits, documents)
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE legal_cases (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  person                text NOT NULL DEFAULT 'self',   -- 'self' | 'dependent'
  category              text NOT NULL,                  -- 'uscis' | 'court' | 'permit' | 'document' | 'other'
  case_type             text,
  case_name             text NOT NULL,
  receipt_number        text,
  filing_date           date,
  attorney              text,
  status                text,
  status_detail         text,
  status_last_checked   timestamptz,
  next_action           text,
  next_action_date      date,
  estimated_completion  text,
  priority              text DEFAULT 'medium',
  notes                 text,
  milestones            jsonb,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX legal_cases_person_idx ON legal_cases(person);
CREATE TRIGGER legal_cases_updated BEFORE UPDATE ON legal_cases
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ─────────────────────────────────────────────────────────────────────────────
--  FINANCE — Plaid + transactions + statements + liabilities
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE plaid_items (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id      text,
  institution_name    text,
  access_token        text,        -- 'manual_*' prefix denotes a non-Plaid manual item
  cursor              text,        -- for /transactions/sync incremental pulls
  last_synced_at      timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE bank_accounts (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plaid_item_id            uuid REFERENCES plaid_items(id) ON DELETE CASCADE,
  plaid_account_id         text,         -- the Plaid-side account id
  name                     text NOT NULL,
  custom_name              text,
  type                     text,         -- 'depository' | 'credit' | 'loan' | 'investment'
  subtype                  text,
  mask                     text,
  balance_current          numeric(14,2),
  balance_available        numeric(14,2),
  payment_due_date         date,
  minimum_payment_amount   numeric(14,2),
  last_statement_balance   numeric(14,2),
  last_payment_amount      numeric(14,2),
  last_payment_date        date,
  created_at               timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX bank_accounts_plaid_item_idx ON bank_accounts(plaid_item_id);

CREATE TABLE transactions (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bank_account_id     uuid REFERENCES bank_accounts(id) ON DELETE SET NULL,
  plaid_transaction_id text UNIQUE,
  date                date NOT NULL,
  amount              numeric(14,2) NOT NULL,   -- positive = expense, negative = income
  name                text,
  merchant_name       text,
  description         text,
  ai_category         text,                     -- the category PersonalOS uses
  pending             boolean DEFAULT false,
  source              text DEFAULT 'plaid',     -- 'plaid' | 'statement' | 'manual'
  statement_id        uuid,                     -- FK→bank_statements.id when source='statement'
  dedup_hash          text,                     -- for statement-importer dedup
  created_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX transactions_date_idx ON transactions(date DESC);
CREATE INDEX transactions_bank_account_idx ON transactions(bank_account_id);
CREATE INDEX transactions_dedup_idx ON transactions(dedup_hash);

CREATE TABLE bank_statements (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bank_account_id     uuid REFERENCES bank_accounts(id) ON DELETE SET NULL,
  file_name           text,
  file_path           text NOT NULL,      -- storage bucket: 'statements'
  file_size_bytes     bigint,
  statement_date      date,
  created_at          timestamptz NOT NULL DEFAULT now()
);

-- statement_processing_jobs is auto-populated by a DB trigger on bank_statements
CREATE TABLE statement_processing_jobs (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  statement_id          uuid NOT NULL REFERENCES bank_statements(id) ON DELETE CASCADE,
  status                text NOT NULL DEFAULT 'pending',  -- 'pending' | 'running' | 'completed' | 'failed'
  found_count           integer DEFAULT 0,
  inserted_count        integer DEFAULT 0,
  skipped_count         integer DEFAULT 0,
  error_message         text,
  started_at            timestamptz,
  completed_at          timestamptz,
  created_at            timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX statement_jobs_status_idx ON statement_processing_jobs(status);

CREATE TABLE liabilities (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL,
  amount      numeric(14,2) NOT NULL,
  status      text NOT NULL DEFAULT 'unpaid',   -- 'unpaid' | 'paid'
  due_date    date,
  paid_at     timestamptz,
  notes       text,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE business_entities (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL,
  ein         text,
  state       text,
  formed_on   date,
  notes       text,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE entity_documents (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_id   uuid NOT NULL REFERENCES business_entities(id) ON DELETE CASCADE,
  file_name   text,
  file_path   text NOT NULL,      -- storage bucket: 'entity-docs'
  uploaded_at timestamptz NOT NULL DEFAULT now()
);

-- ─────────────────────────────────────────────────────────────────────────────
--  TAXES
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE tax_year_notes (
  tax_year    integer PRIMARY KEY,
  status      text,           -- 'not_started' | 'in_progress' | 'filed' | 'closed'
  notes       text,
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE tax_documents (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tax_year        integer NOT NULL,
  document_type   text,             -- 'W-2' | '1099' | 'receipt' | 'return' | 'other'
  file_name       text,
  file_path       text NOT NULL,    -- storage bucket: 'tax-docs'
  file_size_bytes bigint,
  uploaded_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX tax_documents_year_idx ON tax_documents(tax_year);

-- ─────────────────────────────────────────────────────────────────────────────
--  HEALTH / BODY
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE apple_health_daily (
  date            date PRIMARY KEY,
  rhr_bpm         integer,
  hrv_ms          integer,
  steps           integer,
  active_kcal     integer,
  sleep_hours     numeric(4,2),
  body_fat_pct    numeric(4,2),
  weight_kg       numeric(5,2),
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE oura_daily (
  date              date PRIMARY KEY,
  readiness_score   smallint,
  sleep_score       smallint,
  activity_score    smallint,
  total_sleep_hrs   numeric(4,2),
  rhr_bpm           integer,
  hrv_ms            integer,
  created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE nutrition_log (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  date        date NOT NULL,
  meal_label  text,
  protein_g   numeric(6,2),
  calories    numeric(6,0),
  carbs_g     numeric(6,2),
  fat_g       numeric(6,2),
  notes       text,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX nutrition_log_date_idx ON nutrition_log(date);

CREATE TABLE workouts (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  date          date NOT NULL,
  workout_type  text,           -- 'push_a' | 'push_b' | 'pull_a' | 'pull_b' | 'legs' | 'abs' etc.
  duration_min  integer,
  notes         text,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX workouts_date_idx ON workouts(date);

CREATE TABLE daily_checkin (
  date        date PRIMARY KEY,
  mood        smallint,         -- 1..5
  energy      smallint,
  notes       text,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- ─────────────────────────────────────────────────────────────────────────────
--  ROW LEVEL SECURITY — permissive policies (single-user model)
--  Replace with auth.uid()-based policies if you wire up Supabase Auth.
-- ─────────────────────────────────────────────────────────────────────────────

DO $$
DECLARE
  t text;
  tables text[] := ARRAY[
    'profile','identity_documents',
    'projects','tasks','project_snapshots',
    'reflections','snapshots','snapshot_runs','debriefs',
    'soul_items','soul_logs','soul_item_steps','soul_step_logs',
    'legal_cases',
    'plaid_items','bank_accounts','transactions','bank_statements','statement_processing_jobs',
    'liabilities','business_entities','entity_documents',
    'tax_year_notes','tax_documents',
    'apple_health_daily','oura_daily','nutrition_log','workouts','daily_checkin'
  ];
BEGIN
  FOREACH t IN ARRAY tables LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY %I_anon_all ON %I FOR ALL TO anon USING (true) WITH CHECK (true)', t, t);
  END LOOP;
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
--  STORAGE BUCKETS — create these manually in the Supabase dashboard
--  (or via supabase storage CLI). Names referenced in the app:
--    identity-docs   — signatures, passports, IDs
--    statements      — bank statement PDFs (drives statement_processing_jobs)
--    tax-docs        — W-2s, 1099s, returns
--    entity-docs     — LLC / business documents
-- ─────────────────────────────────────────────────────────────────────────────
