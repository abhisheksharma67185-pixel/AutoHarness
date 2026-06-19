import { supabaseServer } from './supabase-server';
import { diagnoseFailure } from './llm';
import { clusterFailuresLocally } from './cluster';

interface Job {
  id: string;
  type: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  progress: number;
  created_at: string;
  finished_at?: string;
  error?: string;
}

// In-memory jobs store attached to global context to survive HMR in dev
const globalJobs = (global as any).jobs || {};
(global as any).jobs = globalJobs;

export function createJob(prefix: string): string {
  const jobId = `${prefix}-job-${Math.floor(100000 + Math.random() * 900000)}`;
  
  let type = 'unknown';
  if (prefix === 'diag') type = 'diagnose_failures';
  else if (prefix === 'cluster') type = 'recluster_failure_modes';
  else if (prefix === 'propose') type = 'propose_variants';

  globalJobs[jobId] = {
    id: jobId,
    type,
    status: 'pending',
    progress: 0.0,
    created_at: new Date().toISOString()
  };
  return jobId;
}

export function getJob(jobId: string): Job | undefined {
  return globalJobs[jobId];
}

export function updateJob(jobId: string, status: Job['status'], progress: number, error?: string) {
  const job = globalJobs[jobId];
  if (job) {
    job.status = status;
    job.progress = Math.min(1.0, Math.max(0.0, progress));
    if (error) job.error = error;
    if (status === 'completed' || status === 'failed') {
      job.finished_at = new Date().toISOString();
    }
  }
}

// Background diagnosis worker
export async function runBackgroundDiagnosis(jobId: string, runId: string) {
  try {
    updateJob(jobId, 'running', 0.05);

    // Fetch run
    const { data: run, error: runError } = await supabaseServer
      .from('runs')
      .select('id')
      .eq('id', runId)
      .maybeSingle();

    if (runError) throw runError;
    if (!run) {
      updateJob(jobId, 'failed', 0.0, 'Run not found');
      return;
    }

    // Fetch all failed tasks for the run
    const { data: failedTasks, error: tasksError } = await supabaseServer
      .from('run_tasks')
      .select(`
        id,
        run_id,
        benchmark_tasks!inner (
          id,
          task_id,
          title,
          category,
          difficulty,
          metadata
        )
      `)
      .eq('run_id', runId)
      .eq('status', 'FAIL');

    if (tasksError) throw tasksError;

    // Parse description from metadata JSON
    const failedTasksWithDesc = (failedTasks || []).map((t: any) => {
      let metaObj: any = {};
      const btMetadata = t.benchmark_tasks?.metadata;
      try {
        metaObj = typeof btMetadata === 'string' ? JSON.parse(btMetadata) : (btMetadata || {});
      } catch {}
      return {
        id: t.id,
        run_id: t.run_id,
        task_id: t.benchmark_tasks?.task_id,
        slug: t.benchmark_tasks?.title, // bt.title is task slug
        category: t.benchmark_tasks?.category,
        difficulty: t.benchmark_tasks?.difficulty,
        description: metaObj.description || ''
      };
    });

    if (failedTasksWithDesc.length === 0) {
      updateJob(jobId, 'completed', 1.0);
      return;
    }

    for (let i = 0; i < failedTasksWithDesc.length; i++) {
      const t = failedTasksWithDesc[i];
      
      // Fetch trace steps
      const { data: dbSteps, error: stepsError } = await supabaseServer
        .from('trace_steps')
        .select('id, run_task_id, step_index, step_type, content, metadata')
        .eq('run_task_id', t.id)
        .order('step_index', { ascending: true });

      if (stepsError) throw stepsError;

      const cleanSteps = (dbSteps || []).map(s => {
        let type = 'LOG';
        const st = (s.step_type || '').toUpperCase();
        if (st === 'ASSISTANT') type = 'agent';
        else if (st === 'USER') type = 'user';
        else if (st === 'SYSTEM') type = 'system';
        else if (st === 'TOOL_CALL' || st === 'COMMAND') type = 'tool_call';
        else if (st === 'TOOL_RESULT') type = 'tool_output';

        return {
          run_task_id: t.id,
          step_index: s.step_index,
          step_type: st,
          content: s.content,
          output: type === 'tool_output' ? s.content : null,
          type
        };
      });

      const diagnosis = await diagnoseFailure(t.description, t.slug, cleanSteps);

      // Map taxonomy label
      let mappedTaxonomy = 'OTHER';
      const incomingTaxonomy = (diagnosis.taxonomy_label || '').toUpperCase();
      if (['GAP', 'AMBIGUITY', 'TOOL_MISUSE', 'CODE_BUG', 'UPSTREAM', 'SAFETY', 'OTHER'].includes(incomingTaxonomy)) {
        mappedTaxonomy = incomingTaxonomy;
      } else if (incomingTaxonomy === 'SAFETY_VIOLATION') {
        mappedTaxonomy = 'SAFETY';
      }

      // Upsert failure label
      const { error: upsertError } = await supabaseServer
        .from('failure_labels')
        .upsert({
          run_task_id: t.id,
          is_failure: 1,
          source: 'LLM_JUDGE',
          score: null,
          diagnosis_text: diagnosis.diagnosis_text,
          taxonomy_primary: mappedTaxonomy,
          taxonomy_secondary: '[]'
        }, { onConflict: 'run_task_id' });

      if (upsertError) throw upsertError;

      // Update progress incrementally
      const progress = 0.05 + ((i + 1) / failedTasksWithDesc.length) * 0.90;
      updateJob(jobId, 'running', progress);
    }

    updateJob(jobId, 'completed', 1.0);
  } catch (err: any) {
    console.error('Background Diagnosis Error:', err);
    updateJob(jobId, 'failed', 0.0, err.message || 'Error occurred during failure diagnosis.');
  }
}

// Background reclustering worker
export async function runBackgroundReclustering(jobId: string, benchmarkId: number, runIds: string[]) {
  try {
    updateJob(jobId, 'running', 0.1);

    if (runIds.length === 0) {
      updateJob(jobId, 'completed', 1.0);
      return;
    }

    // Fetch all failed tasks with their failure labels for the target runs
    const { data: failedTasks, error: failedError } = await supabaseServer
      .from('run_tasks')
      .select(`
        id,
        run_id,
        benchmark_tasks!inner (
          id,
          task_id,
          title,
          category,
          difficulty,
          metadata
        ),
        failure_labels!inner (
          id,
          diagnosis_text,
          taxonomy_primary
        )
      `)
      .in('run_id', runIds);

    if (failedError) throw failedError;

    // Parse description from metadata JSON
    const failedTasksParsed = (failedTasks || []).map((t: any) => {
      let metaObj: any = {};
      const btMetadata = t.benchmark_tasks?.metadata;
      try {
        metaObj = typeof btMetadata === 'string' ? JSON.parse(btMetadata) : (btMetadata || {});
      } catch {}
      const fl = Array.isArray(t.failure_labels) ? t.failure_labels[0] : t.failure_labels;
      return {
        id: t.id,
        run_id: t.run_id,
        task_id: t.benchmark_tasks?.task_id,
        slug: t.benchmark_tasks?.title,
        category: t.benchmark_tasks?.category,
        difficulty: t.benchmark_tasks?.difficulty,
        description: metaObj.description || '',
        diagnosis_text: fl?.diagnosis_text || '',
        taxonomy_label: fl?.taxonomy_primary || 'OTHER',
        label_id: fl?.id
      };
    }).filter(t => t.label_id !== undefined);

    updateJob(jobId, 'running', 0.3);

    if (failedTasksParsed.length === 0) {
      updateJob(jobId, 'completed', 1.0);
      return;
    }

    // 1. Delete previous failure mode members and failure modes for this benchmark
    const { data: modesToDelete, error: selectModesError } = await supabaseServer
      .from('failure_modes')
      .select('id')
      .eq('benchmark_id', benchmarkId);

    if (selectModesError) throw selectModesError;

    const modeIds = (modesToDelete || []).map(m => m.id);

    if (modeIds.length > 0) {
      const { error: deleteMembersError } = await supabaseServer
        .from('failure_mode_members')
        .delete()
        .in('failure_mode_id', modeIds);
      if (deleteMembersError) throw deleteMembersError;
    }

    const { error: deleteModesError } = await supabaseServer
      .from('failure_modes')
      .delete()
      .eq('benchmark_id', benchmarkId);
    if (deleteModesError) throw deleteModesError;

    // 2. Perform clustering
    const clusters = clusterFailuresLocally(failedTasksParsed as any);

    // 3. Insert new FailureModes and FailureModeMembers
    for (const cluster of clusters) {
      const { data: fmRow, error: fmError } = await supabaseServer
        .from('failure_modes')
        .insert({
          benchmark_id: benchmarkId,
          name: cluster.title,
          description: cluster.description,
          taxonomy_primary: cluster.taxonomy_label,
          stats: '{}'
        })
        .select('id')
        .single();
      if (fmError) throw fmError;
      const failureModeId = fmRow.id;

      const membersData = [];
      for (const memberId of cluster.memberIds) {
        const taskObj = failedTasksParsed.find((f: any) => f.id === memberId);
        if (taskObj) {
          membersData.push({
            failure_mode_id: failureModeId,
            failure_label_id: taskObj.label_id,
            distance: 0.0
          });
        }
      }

      if (membersData.length > 0) {
        const { error: membersError } = await supabaseServer
          .from('failure_mode_members')
          .insert(membersData);
        if (membersError) throw membersError;
      }
    }

    updateJob(jobId, 'running', 0.9);
    updateJob(jobId, 'completed', 1.0);
  } catch (err: any) {
    console.error('Background Reclustering Error:', err);
    updateJob(jobId, 'failed', 0.0, err.message || 'Error occurred during reclustering.');
  }
}
