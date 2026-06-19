-- 002_full_schema.sql
-- Complete schema for AutoHarness Studio on Supabase
--
-- Tables already created by 001_enable_rls.sql:
--   jobs, failure_label_embeddings (+ RLS on runs, run_tasks, trace_steps, failure_labels)
--
-- This migration creates ALL remaining tables idempotently and enables RLS on them.

-- ---------------------------------------------------------------------------
-- Lookup / reference tables
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.benchmarks (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    slug TEXT NOT NULL UNIQUE,
    description TEXT,
    source_url TEXT
);

CREATE TABLE IF NOT EXISTS public.harness_versions (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    config TEXT NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    notes TEXT
);

CREATE TABLE IF NOT EXISTS public.benchmark_tasks (
    id SERIAL PRIMARY KEY,
    benchmark_id INTEGER NOT NULL REFERENCES public.benchmarks(id) ON DELETE CASCADE,
    task_id TEXT NOT NULL,
    title TEXT NOT NULL,
    category TEXT NOT NULL,
    difficulty TEXT NOT NULL,
    metadata TEXT NOT NULL DEFAULT '{}',
    UNIQUE(benchmark_id, task_id)
);

-- ---------------------------------------------------------------------------
-- Patch existing tables with missing columns (idempotent via DO blocks)
-- ---------------------------------------------------------------------------

DO $$ BEGIN
    ALTER TABLE public.runs ADD COLUMN IF NOT EXISTS benchmark_id INTEGER REFERENCES public.benchmarks(id);
EXCEPTION WHEN undefined_table THEN NULL;
END $$;

DO $$ BEGIN
    ALTER TABLE public.runs ADD COLUMN IF NOT EXISTS harness_version_id INTEGER REFERENCES public.harness_versions(id);
EXCEPTION WHEN undefined_table THEN NULL;
END $$;

DO $$ BEGIN
    ALTER TABLE public.run_tasks ADD COLUMN IF NOT EXISTS benchmark_task_id INTEGER REFERENCES public.benchmark_tasks(id);
EXCEPTION WHEN undefined_table THEN NULL;
END $$;

DO $$ BEGIN
    ALTER TABLE public.run_tasks ADD COLUMN IF NOT EXISTS raw_result JSONB;
EXCEPTION WHEN undefined_table THEN NULL;
END $$;

-- ---------------------------------------------------------------------------
-- Failure analysis tables
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.failure_modes (
    id SERIAL PRIMARY KEY,
    benchmark_id INTEGER NOT NULL REFERENCES public.benchmarks(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    description TEXT NOT NULL,
    taxonomy_primary TEXT,
    embedding_centroid TEXT,
    stats TEXT,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS ix_failure_modes_taxonomy_primary ON public.failure_modes (taxonomy_primary);

CREATE TABLE IF NOT EXISTS public.failure_mode_members (
    failure_mode_id INTEGER NOT NULL REFERENCES public.failure_modes(id) ON DELETE CASCADE,
    failure_label_id INTEGER NOT NULL REFERENCES public.failure_labels(id) ON DELETE CASCADE,
    distance DOUBLE PRECISION DEFAULT 0.0,
    PRIMARY KEY (failure_mode_id, failure_label_id)
);

-- ---------------------------------------------------------------------------
-- Experiment tables
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.experiments (
    id SERIAL PRIMARY KEY,
    benchmark_id INTEGER NOT NULL REFERENCES public.benchmarks(id),
    name TEXT NOT NULL,
    description TEXT NOT NULL,
    base_harness_version_id INTEGER NOT NULL REFERENCES public.harness_versions(id),
    target_description TEXT,
    config_template TEXT,
    regression_policy TEXT NOT NULL DEFAULT '{"mode":"strict","max_regression_pct":5.0}',
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS public.experiment_targets (
    id SERIAL PRIMARY KEY,
    experiment_id INTEGER NOT NULL REFERENCES public.experiments(id) ON DELETE CASCADE,
    target_type TEXT NOT NULL,
    target_id INTEGER NOT NULL,
    desired_delta DOUBLE PRECISION NOT NULL
);

CREATE TABLE IF NOT EXISTS public.experiment_variants (
    id SERIAL PRIMARY KEY,
    experiment_id INTEGER NOT NULL REFERENCES public.experiments(id) ON DELETE CASCADE,
    harness_version_id INTEGER NOT NULL REFERENCES public.harness_versions(id),
    variant_label TEXT NOT NULL,
    config_diff TEXT,
    exported_config_uri TEXT,
    status TEXT NOT NULL DEFAULT 'pending',
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS public.experiment_variant_eval_summaries (
    id SERIAL PRIMARY KEY,
    experiment_variant_id INTEGER NOT NULL,
    eval_suite_id TEXT NOT NULL,
    baseline_eval_run_id TEXT NOT NULL,
    variant_eval_run_id TEXT NOT NULL,
    delta_pass_rate DOUBLE PRECISION NOT NULL DEFAULT 0.0,
    regression_flag INTEGER NOT NULL DEFAULT 0
);

-- ---------------------------------------------------------------------------
-- Eval suite / case / run tables
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.eval_suites (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    benchmark_id INTEGER NOT NULL REFERENCES public.benchmarks(id),
    description TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS public.eval_cases (
    id TEXT PRIMARY KEY,
    benchmark_task_id INTEGER REFERENCES public.benchmark_tasks(id) ON DELETE SET NULL,
    failure_label_id INTEGER REFERENCES public.failure_labels(id) ON DELETE SET NULL,
    input_spec TEXT NOT NULL DEFAULT '{}',
    expected_spec TEXT NOT NULL DEFAULT '{}',
    scoring_config TEXT,
    created_by TEXT,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS public.eval_suite_members (
    eval_suite_id TEXT NOT NULL REFERENCES public.eval_suites(id) ON DELETE CASCADE,
    eval_case_id TEXT NOT NULL REFERENCES public.eval_cases(id) ON DELETE CASCADE,
    PRIMARY KEY (eval_suite_id, eval_case_id)
);

CREATE TABLE IF NOT EXISTS public.eval_runs (
    id TEXT PRIMARY KEY,
    eval_suite_id TEXT NOT NULL REFERENCES public.eval_suites(id) ON DELETE CASCADE,
    harness_version_id INTEGER NOT NULL REFERENCES public.harness_versions(id),
    run_id TEXT,
    status TEXT NOT NULL,
    metrics TEXT NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    finished_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS public.eval_results (
    id SERIAL PRIMARY KEY,
    eval_run_id TEXT NOT NULL REFERENCES public.eval_runs(id) ON DELETE CASCADE,
    eval_case_id TEXT NOT NULL REFERENCES public.eval_cases(id) ON DELETE CASCADE,
    status TEXT NOT NULL,
    score DOUBLE PRECISION NOT NULL,
    raw_output TEXT,
    judge_metadata TEXT
);

-- ---------------------------------------------------------------------------
-- Enable Row Level Security on ALL tables (idempotent)
-- ---------------------------------------------------------------------------

ALTER TABLE IF EXISTS public.benchmarks ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.harness_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.benchmark_tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.failure_modes ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.failure_mode_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.experiments ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.experiment_targets ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.experiment_variants ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.experiment_variant_eval_summaries ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.eval_suites ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.eval_cases ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.eval_suite_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.eval_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.eval_results ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- Read-only policies for anon / authenticated users (service_role bypasses RLS)
-- ---------------------------------------------------------------------------

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'benchmarks' AND policyname = 'Allow public read access on benchmarks') THEN
        CREATE POLICY "Allow public read access on benchmarks" ON public.benchmarks
            FOR SELECT TO anon, authenticated USING (true);
    END IF;
END $$;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'harness_versions' AND policyname = 'Allow public read access on harness_versions') THEN
        CREATE POLICY "Allow public read access on harness_versions" ON public.harness_versions
            FOR SELECT TO anon, authenticated USING (true);
    END IF;
END $$;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'benchmark_tasks' AND policyname = 'Allow public read access on benchmark_tasks') THEN
        CREATE POLICY "Allow public read access on benchmark_tasks" ON public.benchmark_tasks
            FOR SELECT TO anon, authenticated USING (true);
    END IF;
END $$;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'failure_modes' AND policyname = 'Allow public read access on failure_modes') THEN
        CREATE POLICY "Allow public read access on failure_modes" ON public.failure_modes
            FOR SELECT TO anon, authenticated USING (true);
    END IF;
END $$;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'failure_mode_members' AND policyname = 'Allow public read access on failure_mode_members') THEN
        CREATE POLICY "Allow public read access on failure_mode_members" ON public.failure_mode_members
            FOR SELECT TO anon, authenticated USING (true);
    END IF;
END $$;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'experiments' AND policyname = 'Allow public read access on experiments') THEN
        CREATE POLICY "Allow public read access on experiments" ON public.experiments
            FOR SELECT TO anon, authenticated USING (true);
    END IF;
END $$;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'experiment_targets' AND policyname = 'Allow public read access on experiment_targets') THEN
        CREATE POLICY "Allow public read access on experiment_targets" ON public.experiment_targets
            FOR SELECT TO anon, authenticated USING (true);
    END IF;
END $$;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'experiment_variants' AND policyname = 'Allow public read access on experiment_variants') THEN
        CREATE POLICY "Allow public read access on experiment_variants" ON public.experiment_variants
            FOR SELECT TO anon, authenticated USING (true);
    END IF;
END $$;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'experiment_variant_eval_summaries' AND policyname = 'Allow public read access on experiment_variant_eval_summaries') THEN
        CREATE POLICY "Allow public read access on experiment_variant_eval_summaries" ON public.experiment_variant_eval_summaries
            FOR SELECT TO anon, authenticated USING (true);
    END IF;
END $$;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'eval_suites' AND policyname = 'Allow public read access on eval_suites') THEN
        CREATE POLICY "Allow public read access on eval_suites" ON public.eval_suites
            FOR SELECT TO anon, authenticated USING (true);
    END IF;
END $$;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'eval_cases' AND policyname = 'Allow public read access on eval_cases') THEN
        CREATE POLICY "Allow public read access on eval_cases" ON public.eval_cases
            FOR SELECT TO anon, authenticated USING (true);
    END IF;
END $$;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'eval_suite_members' AND policyname = 'Allow public read access on eval_suite_members') THEN
        CREATE POLICY "Allow public read access on eval_suite_members" ON public.eval_suite_members
            FOR SELECT TO anon, authenticated USING (true);
    END IF;
END $$;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'eval_runs' AND policyname = 'Allow public read access on eval_runs') THEN
        CREATE POLICY "Allow public read access on eval_runs" ON public.eval_runs
            FOR SELECT TO anon, authenticated USING (true);
    END IF;
END $$;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'eval_results' AND policyname = 'Allow public read access on eval_results') THEN
        CREATE POLICY "Allow public read access on eval_results" ON public.eval_results
            FOR SELECT TO anon, authenticated USING (true);
    END IF;
END $$;
