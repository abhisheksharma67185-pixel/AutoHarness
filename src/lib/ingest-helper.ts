import { supabaseServer } from './supabase-server';
import { IngestionPayload } from './types';
import { diagnoseFailure } from './llm';
import { clusterFailuresLocally } from './cluster';

export async function performIngestion(payload: IngestionPayload): Promise<{
  success: boolean;
  run_id: string;
  ingested_tasks: number;
}> {
  const { run_id, metadata, tasks } = payload;

  if (!run_id || !metadata || !tasks || !Array.isArray(tasks)) {
    throw new Error('Missing run_id, metadata, or tasks array in payload');
  }

  // Pre-fetch all async diagnoses outside the database transaction/operations
  const diagnosesMap = new Map<string, { diagnosis_text: string; taxonomy_label: string }>();

  for (const t of tasks) {
    const isPass = t.success === true || t.score >= 1.0;
    if (!isPass) {
      const cleanSteps = (t.steps || []).map(s => {
        let stepType = 'LOG';
        const originalType = (s.type || '').toLowerCase();
        if (originalType === 'agent') stepType = 'ASSISTANT';
        else if (originalType === 'user') stepType = 'USER';
        else if (originalType === 'system') stepType = 'SYSTEM';
        else if (originalType === 'tool_call' || originalType === 'command') stepType = 'TOOL_CALL';
        else if (originalType === 'tool_output' || originalType === 'stdout' || originalType === 'stderr') stepType = 'TOOL_RESULT';

        return {
          run_task_id: 0,
          step_index: s.step_index,
          step_type: stepType,
          content: s.content || s.output || '',
          metadata: '{}'
        };
      });

      const diagnosis = await diagnoseFailure(t.description, t.slug, cleanSteps);
      
      let mappedTaxonomy = 'OTHER';
      const incomingTaxonomy = (diagnosis.taxonomy_label || '').toUpperCase();
      if (['GAP', 'AMBIGUITY', 'TOOL_MISUSE', 'CODE_BUG', 'UPSTREAM', 'SAFETY', 'OTHER'].includes(incomingTaxonomy)) {
        mappedTaxonomy = incomingTaxonomy;
      } else if (incomingTaxonomy === 'SAFETY_VIOLATION') {
        mappedTaxonomy = 'SAFETY';
      }

      diagnosesMap.set(t.task_id, {
        diagnosis_text: diagnosis.diagnosis_text,
        taxonomy_label: mappedTaxonomy
      });
    }
  }

  // 1. Resolve or create benchmark record
  const benchSlug = metadata.benchmark_slug || 'terminal_bench_2';
  const benchName = metadata.benchmark || 'Terminal-Bench 2.0';
  const benchDesc = metadata.benchmark_description || 'Terminal operations benchmark for agent evaluation.';
  const benchUrl = metadata.benchmark_source_url || '';

  let benchmarkId: number;
  const { data: existingBench, error: benchSelectError } = await supabaseServer
    .from('benchmarks')
    .select('id')
    .eq('slug', benchSlug)
    .maybeSingle();
  if (benchSelectError) throw benchSelectError;

  if (existingBench) {
    benchmarkId = existingBench.id;
  } else {
    const { data: newBench, error: insertBenchError } = await supabaseServer
      .from('benchmarks')
      .insert({ name: benchName, slug: benchSlug, description: benchDesc, source_url: benchUrl })
      .select('id')
      .single();
    if (insertBenchError) throw insertBenchError;
    benchmarkId = newBench.id;
  }

  // 2. Resolve or create harness version
  const harnessName = metadata.harness_version || 'v1.0.0';
  const harnessConfig = JSON.stringify(metadata.harness_config || { agent_model: metadata.agent || 'SigmaAgent' });
  const harnessNotes = metadata.harness_notes || 'Auto-registered during ingestion';

  let harnessVersionId: number;
  const { data: existingHarness, error: harnessSelectError } = await supabaseServer
    .from('harness_versions')
    .select('id')
    .eq('name', harnessName)
    .maybeSingle();
  if (harnessSelectError) throw harnessSelectError;

  if (existingHarness) {
    harnessVersionId = existingHarness.id;
  } else {
    const { data: newHarness, error: insertHarnessError } = await supabaseServer
      .from('harness_versions')
      .insert({ name: harnessName, config: harnessConfig, notes: harnessNotes })
      .select('id')
      .single();
    if (insertHarnessError) throw insertHarnessError;
    harnessVersionId = newHarness.id;
  }

  // 3. Delete existing run to keep ingestion idempotent (clean cascading delete)
  const { error: deleteRunError } = await supabaseServer
    .from('runs')
    .delete()
    .eq('id', run_id);
  if (deleteRunError) throw deleteRunError;

  // 4. Insert runs baseline record
  const { error: insertRunError } = await supabaseServer
    .from('runs')
    .insert({
      id: run_id,
      benchmark_id: benchmarkId,
      agent_name: metadata.agent || 'SigmaAgent',
      harness_version_id: harnessVersionId,
      run_label: metadata.run_label || `Run ${run_id}`,
      metrics: '{}',
      raw_artifact_uri: metadata.raw_artifact_uri || '',
      global_score: 0.0
    });
  if (insertRunError) throw insertRunError;

  let passedCount = 0;
  let failedCount = 0;
  let scoreSum = 0;
  const categoryScores: Record<string, { sum: number; count: number }> = {};
  const failedTasksForClustering: any[] = [];

  // 5. Ingest tasks and steps
  for (const t of tasks) {
    // Register task definition
    let benchmarkTaskId: number;
    const { data: existingBt, error: btSelectError } = await supabaseServer
      .from('benchmark_tasks')
      .select('id')
      .eq('benchmark_id', benchmarkId)
      .eq('task_id', t.task_id)
      .maybeSingle();
    if (btSelectError) throw btSelectError;

    if (existingBt) {
      benchmarkTaskId = existingBt.id;
    } else {
      const { data: newBt, error: insertBtError } = await supabaseServer
        .from('benchmark_tasks')
        .insert({
          benchmark_id: benchmarkId,
          task_id: t.task_id,
          title: t.slug,
          category: t.category,
          difficulty: t.difficulty,
          metadata: JSON.stringify({ description: t.description })
        })
        .select('id')
        .single();
      if (insertBtError) throw insertBtError;
      benchmarkTaskId = newBt.id;
    }

    const isPass = t.success === true || t.score >= 1.0;
    const status = isPass ? 'PASS' : 'FAIL';

    if (isPass) passedCount++;
    else failedCount++;
    scoreSum += t.score;

    if (!categoryScores[t.category]) {
      categoryScores[t.category] = { sum: 0, count: 0 };
    }
    categoryScores[t.category].sum += t.score;
    categoryScores[t.category].count += 1;

    // Save execution details
    const { data: runTaskRow, error: insertRunTaskError } = await supabaseServer
      .from('run_tasks')
      .insert({
        run_id: run_id,
        benchmark_task_id: benchmarkTaskId,
        status,
        score: t.score,
        raw_result: JSON.stringify(t)
      })
      .select('id')
      .single();
    if (insertRunTaskError) throw insertRunTaskError;
    const runTaskId = runTaskRow.id;

    // Ingest steps
    if (t.steps && Array.isArray(t.steps)) {
      const traceStepsData = t.steps.map(s => {
        let stepType = 'LOG';
        const originalType = (s.type || '').toLowerCase();
        if (originalType === 'agent') stepType = 'ASSISTANT';
        else if (originalType === 'user') stepType = 'USER';
        else if (originalType === 'system') stepType = 'SYSTEM';
        else if (originalType === 'tool_call' || originalType === 'command') stepType = 'TOOL_CALL';
        else if (originalType === 'tool_output' || originalType === 'stdout' || originalType === 'stderr') stepType = 'TOOL_RESULT';

        return {
          run_task_id: runTaskId,
          step_index: s.step_index,
          step_type: stepType,
          content: s.content || s.output || '',
          metadata: JSON.stringify(s.metadata || {})
        };
      });

      if (traceStepsData.length > 0) {
        const { error: insertStepsError } = await supabaseServer
          .from('trace_steps')
          .insert(traceStepsData);
        if (insertStepsError) throw insertStepsError;
      }
    }

    // 6. Ingest failure labels
    if (!isPass) {
      const preFetched = diagnosesMap.get(t.task_id) || {
        diagnosis_text: 'Agent failed to complete the task successfully.',
        taxonomy_label: 'OTHER'
      };

      const { data: labelRow, error: insertLabelError } = await supabaseServer
        .from('failure_labels')
        .insert({
          run_task_id: runTaskId,
          is_failure: 1,
          source: 'BENCHMARK',
          score: null,
          diagnosis_text: preFetched.diagnosis_text,
          taxonomy_primary: preFetched.taxonomy_label,
          taxonomy_secondary: '[]'
        })
        .select('id')
        .single();
      if (insertLabelError) throw insertLabelError;

      failedTasksForClustering.push({
        id: runTaskId,
        label_id: labelRow.id,
        run_id,
        task_id: t.task_id,
        status,
        score: t.score,
        slug: t.slug,
        category: t.category,
        difficulty: t.difficulty,
        description: t.description,
        diagnosis_text: preFetched.diagnosis_text,
        taxonomy_label: preFetched.taxonomy_label
      });
    }
  }

  // 7. Re-cluster failed tasks and link FailureModes
  const clusters = clusterFailuresLocally(failedTasksForClustering);
  const taxonomyDistribution: Record<string, number> = {};

  for (const cluster of clusters) {
    // Create failure mode linked to benchmark
    const { data: fmRow, error: insertFmError } = await supabaseServer
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
    if (insertFmError) throw insertFmError;
    const failureModeId = fmRow.id;

    // Associate failed tasks through failure labels
    const membersData = [];
    for (const memberId of cluster.memberIds) {
      const taskObj = failedTasksForClustering.find(f => f.id === memberId);
      if (taskObj) {
        membersData.push({
          failure_mode_id: failureModeId,
          failure_label_id: taskObj.label_id,
          distance: 0.0
        });
        taxonomyDistribution[taskObj.taxonomy_label] = (taxonomyDistribution[taskObj.taxonomy_label] || 0) + 1;
      }
    }

    if (membersData.length > 0) {
      const { error: insertMembersError } = await supabaseServer
        .from('failure_mode_members')
        .upsert(membersData, { onConflict: 'failure_mode_id,failure_label_id', ignoreDuplicates: true });
      if (insertMembersError) throw insertMembersError;
    }
  }

  // 8. Compute final metrics
  const totalTasks = tasks.length;
  const passRate = totalTasks > 0 ? passedCount / totalTasks : 0;
  const avgScore = totalTasks > 0 ? scoreSum / totalTasks : 0;

  const categoryAverages: Record<string, number> = {};
  for (const [cat, data] of Object.entries(categoryScores)) {
    categoryAverages[cat] = data.count > 0 ? data.sum / data.count : 0;
  }

  const metricsObj = {
    total_tasks: totalTasks,
    passed_tasks: passedCount,
    failed_tasks: failedCount,
    pass_rate: passRate,
    avg_score: avgScore,
    category_scores: categoryAverages,
    taxonomy_distribution: taxonomyDistribution
  };

  // Save overall score to runs
  const { error: updateRunError } = await supabaseServer
    .from('runs')
    .update({
      global_score: passRate,
      metrics: JSON.stringify(metricsObj)
    })
    .eq('id', run_id);
  if (updateRunError) throw updateRunError;

  return { success: true, run_id, ingested_tasks: tasks.length };
}
