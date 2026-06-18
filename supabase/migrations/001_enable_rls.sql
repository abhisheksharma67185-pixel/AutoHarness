-- Create missing jobs table if not exists
CREATE TABLE IF NOT EXISTS public.jobs (
    id TEXT PRIMARY KEY,
    type TEXT,
    status TEXT,
    progress REAL DEFAULT 0.0,
    payload_json JSONB,
    result_json JSONB,
    error TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    finished_at TIMESTAMP WITH TIME ZONE
);
CREATE INDEX IF NOT EXISTS ix_jobs_id ON public.jobs (id);
CREATE INDEX IF NOT EXISTS ix_jobs_type ON public.jobs (type);
CREATE INDEX IF NOT EXISTS ix_jobs_status ON public.jobs (status);

-- Create missing failure_label_embeddings table if not exists
CREATE TABLE IF NOT EXISTS public.failure_label_embeddings (
    failure_label_id INTEGER PRIMARY KEY REFERENCES public.failure_labels(id) ON DELETE CASCADE,
    embedding JSONB NOT NULL,
    model TEXT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Enable Row Level Security (RLS) on all 5 tables + embeddings table
ALTER TABLE public.runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.run_tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.trace_steps ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.failure_labels ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.failure_label_embeddings ENABLE ROW LEVEL SECURITY;

-- Enable public read-only (SELECT) access for anon and authenticated users on data tables
CREATE POLICY "Allow public read access on runs" ON public.runs
    FOR SELECT TO anon, authenticated USING (true);

CREATE POLICY "Allow public read access on run_tasks" ON public.run_tasks
    FOR SELECT TO anon, authenticated USING (true);

CREATE POLICY "Allow public read access on trace_steps" ON public.trace_steps
    FOR SELECT TO anon, authenticated USING (true);

CREATE POLICY "Allow public read access on failure_labels" ON public.failure_labels
    FOR SELECT TO anon, authenticated USING (true);

CREATE POLICY "Allow public read access on failure_label_embeddings" ON public.failure_label_embeddings
    FOR SELECT TO anon, authenticated USING (true);

-- Deny all client access to the jobs table by default (enforced by RLS with no policies)
-- The service_role bypasses RLS and will have full read/write access.
