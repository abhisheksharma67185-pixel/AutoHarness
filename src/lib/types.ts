// Religned TS types matching Postgres Logical Schema

export interface Benchmark {
  id?: number;
  name: string;
  slug: string;
  description: string;
  source_url?: string | null;
}

export interface BenchmarkTask {
  id?: number;
  benchmark_id: number;
  task_id: string; // benchmark's own id
  title: string;
  category: string;
  difficulty: string;
  metadata: string; // JSON string
}

export interface HarnessVersion {
  id?: number;
  name: string;
  config: string; // JSON string
  created_at?: string;
  notes?: string | null;
}

export interface Run {
  id: string; // UUID or string id
  benchmark_id: number;
  agent_name: string;
  harness_version_id?: number | null;
  run_label: string;
  metrics: string; // JSON string
  raw_artifact_uri?: string | null;
  created_at?: string;
  global_score: number;
  // Joined / computed fields
  run_id?: string;
  agent?: string;
  benchmark?: string;
  harness_version?: string;
}

export interface RunTask {
  id?: string | number;
  run_id: string;
  benchmark_task_id: string | number;
  status: 'PASS' | 'FAIL' | 'TIMEOUT' | 'ERROR' | 'UNKNOWN' | string;
  score: number;
  raw_result?: string | null; // JSON string
  started_at?: string | null;
  finished_at?: string | null;
  // Joined fields for view rendering
  task_id?: string;
  task_slug?: string; // backend field name
  slug?: string; // mapping to task_id / slug
  title?: string;
  category?: string;
  difficulty?: string;
  description?: string; // maps to benchmark_task.metadata.description or title
  diagnosis_text?: string | null;
  taxonomy_primary?: string | null;
  failure_label_id?: string | number | null;
  taxonomy_label?: string | null;
}

export interface TraceStep {
  id?: string | number;
  run_task_id: string | number;
  step_index: number;
  step_type: 'SYSTEM' | 'USER' | 'ASSISTANT' | 'TOOL_CALL' | 'TOOL_RESULT' | 'COMMAND' | 'LOG' | string;
  content: string;
  metadata?: string | null; // JSON string
  created_at?: string;
  type?: string;
  output?: string | null;
}

export interface FailureLabel {
  id?: number;
  run_task_id: number;
  is_failure: number; // 0 or 1
  source: 'BENCHMARK' | 'LLM_JUDGE' | 'MANUAL' | string;
  score?: number | null;
  diagnosis_text: string;
  taxonomy_primary: 'GAP' | 'AMBIGUITY' | 'TOOL_MISUSE' | 'CODE_BUG' | 'UPSTREAM' | 'SAFETY' | 'OTHER' | string;
  taxonomy_secondary?: string | null; // JSON array string
  created_at?: string;
  updated_at?: string;
}

export interface FailureMode {
  id?: string | number;
  benchmark_id?: string | number;
  name: string;
  description: string;
  taxonomy_primary: string;
  embedding_centroid?: string | null; // JSON float array
  stats?: string | null; // JSON string
  created_at?: string;
  // Computed stats
  failure_count?: number;
  avg_score?: number;
  trend?: 'up' | 'down' | 'stable';
  title?: string;
  taxonomy_label?: string;
}

export interface FailureModeMember {
  failure_mode_id: number;
  failure_label_id: number;
  distance: number;
}

export interface EvalCase {
  id?: number;
  benchmark_task_id?: number | null;
  failure_label_id?: number | null;
  input_spec: string; // JSON string
  expected_spec: string; // JSON string
  scoring_config?: string | null; // JSON string
  created_by?: string | null;
  created_at?: string;
}

export interface EvalSuite {
  id?: string | number;
  name: string;
  benchmark_id?: string | number;
  description: string;
  created_at?: string;
  case_count?: number;
  scoring_strategy?: string;
  source_type?: string;
  benchmark_slug?: string;
}

export interface EvalSuiteMember {
  eval_suite_id: number;
  eval_case_id: number;
}

export interface EvalRun {
  id?: number;
  eval_suite_id: number;
  harness_version_id: number;
  run_id?: string | null;
  status: 'PENDING' | 'RUNNING' | 'COMPLETED' | 'FAILED' | string;
  metrics: string; // JSON string
  created_at?: string;
  finished_at?: string | null;
  suite_name?: string;
}

export interface EvalResult {
  id?: number;
  eval_run_id: number;
  eval_case_id: number;
  status: 'PASS' | 'FAIL' | 'TIMEOUT' | 'ERROR' | string;
  score: number;
  raw_output?: string | null;
  judge_metadata?: string | null;
}

export interface Experiment {
  id?: string | number;
  name: string;
  benchmark_id?: string | number;
  benchmark_slug?: string;
  base_harness_version_id?: string | number;
  base_harness_version?: string;
  target_description?: string | null;
  description?: string | null;
  config_template?: string | null; // JSON string
  regression_policy?: any; // JSON object or string
  targets?: any[]; // list of target objects
  target_modes?: any[]; // parsed targets for UI
  created_at?: string;
}

export interface ExperimentTarget {
  id?: number;
  experiment_id: number;
  target_type: 'FAILURE_MODE' | 'EVAL_SUITE' | string;
  target_id: number;
  desired_delta: number;
}

export interface ExperimentVariant {
  id?: number;
  experiment_id: number;
  harness_version_id: number;
  variant_label: string;
  config_diff?: string | null; // JSON or diff string
  exported_config_uri?: string | null;
  status: 'PLANNED' | 'RUNNING' | 'EVALUATED' | 'PROMOTED' | 'REJECTED' | string;
  // Joined fields for UI
  variant_name?: string;
  generated_config?: string;
  run_id?: string | null;
}

export interface ExperimentVariantEvalSummary {
  id?: number;
  experiment_variant_id: number;
  eval_suite_id: number;
  baseline_eval_run_id: number;
  variant_eval_run_id: number;
  delta_pass_rate: number;
  regression_flag: number; // 0 or 1
}

// Ingestion payload structure remains similar but maps back to normalized tables
export interface IngestionPayload {
  run_id: string;
  metadata: {
    benchmark: string;
    agent: string;
    harness_version: string;
    benchmark_slug?: string;
    benchmark_description?: string;
    benchmark_source_url?: string;
    harness_config?: Record<string, any>;
    harness_notes?: string;
    run_label?: string;
    raw_artifact_uri?: string;
  };
  tasks: Array<{
    task_id: string;
    slug: string;
    category: string;
    difficulty: string;
    description: string;
    success: boolean;
    score: number;
    started_at?: string;
    finished_at?: string;
    steps: Array<{
      step_index: number;
      type: string; // SYSTEM, USER, ASSISTANT, TOOL_CALL, TOOL_RESULT, etc.
      content: string;
      output?: string;
      metadata?: Record<string, any>;
    }>;
  }>;
}
