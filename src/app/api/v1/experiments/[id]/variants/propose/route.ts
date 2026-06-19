import { NextRequest } from 'next/server';
import { supabaseServer } from '@/lib/supabase-server';
import { proposeHarnessFixes } from '@/lib/llm';
import { checkAuth, sendSuccess, sendError } from '@/lib/api-helper';
import { createJob, updateJob } from '@/lib/jobs';

interface Params {
  params: Promise<{
    id: string;
  }>;
}

export async function POST(req: NextRequest, { params }: Params) {
  if (!checkAuth(req)) {
    return sendError('UNAUTHORIZED', 'Invalid or missing API key', null, 401);
  }

  try {
    const { id } = await params;
    const cleanId = id.startsWith('exp') ? id.slice(3) : id;
    const idNum = parseInt(cleanId, 10);

    if (isNaN(idNum)) {
      return sendError('VALIDATION_ERROR', 'Invalid experiment_id format', { field: 'experiment_id' }, 400);
    }

    const { data: exp, error: expError } = await supabaseServer
      .from('experiments')
      .select('*')
      .eq('id', idNum)
      .maybeSingle();

    if (expError) throw expError;
    if (!exp) {
      return sendError('NOT_FOUND', `Experiment not found with ID: ${id}`, { experiment_id: id }, 404);
    }

    // Read body if present, default to empty
    let body: any = {};
    try {
      body = await req.json();
    } catch {}

    // Get the targets failure modes
    const { data: targets, error: targetsError } = await supabaseServer
      .from('experiment_targets')
      .select('target_id')
      .eq('experiment_id', idNum)
      .eq('target_type', 'FAILURE_MODE');

    if (targetsError) throw targetsError;

    // Fetch target failure modes detail
    const failureModes: any[] = [];
    if (targets && targets.length > 0) {
      const targetIds = targets.map(t => t.target_id);
      const { data: modes, error: modesError } = await supabaseServer
        .from('failure_modes')
        .select('name, description, taxonomy_primary')
        .in('id', targetIds);

      if (modesError) throw modesError;

      for (const fm of (modes || [])) {
        failureModes.push({
          title: fm.name,
          description: fm.description,
          taxonomy_label: fm.taxonomy_primary
        });
      }
    }

    if (failureModes.length === 0) {
      // Fallback proposal source
      failureModes.push({
        title: 'Direct Taxonomy Improvement',
        description: 'Improving general failure modes related to tool misuse.',
        taxonomy_label: 'TOOL_MISUSE'
      });
    }

    // Call LLM generator (or heuristic fallback)
    const proposals = await proposeHarnessFixes(failureModes);

    // Get base harness name
    const { data: baseHarness, error: hvError } = await supabaseServer
      .from('harness_versions')
      .select('name')
      .eq('id', exp.base_harness_version_id)
      .maybeSingle();

    if (hvError) throw hvError;
    const baseHarnessName = baseHarness ? baseHarness.name : 'v1.0.0';

    const createdVariants: any[] = [];

    for (let idx = 0; idx < proposals.length; idx++) {
      const p = proposals[idx];
      const varVersionName = `${baseHarnessName}-var-${idx + 1}-${Math.floor(1000 + Math.random() * 9000)}`;

      const configYaml = `
# AutoHarness Candidate Configuration
harness:
  version: "${varVersionName}"
  agent_model: "SigmaAgent"
  temperature: ${p.title.includes('Safety') || p.title.includes('Strict') ? 0.1 : 0.4}
  max_steps: 40

agent_guidelines:
  system_prompt_patch: |
    ${p.prompt_suggestion.replace(/\n/g, '\n    ')}

tool_configuration:
  ordering_mode: "strict"
  notes: "${p.tool_config}"
`;
      const diff = `
--- base_harness.yaml
+++ candidate_variant_${idx + 1}.yaml
@@ -10,4 +10,12 @@
-  temperature: 0.7
+  temperature: ${p.title.includes('Safety') || p.title.includes('Strict') ? 0.1 : 0.4}
+  # Added system prompt patch for "${p.title}"
+  system_prompt_patch: |
+    ${p.prompt_suggestion}
+`;

      // Insert harness version
      const { data: hvRow, error: hvInsertError } = await supabaseServer
        .from('harness_versions')
        .insert({
          name: varVersionName,
          config: configYaml.trim(),
          notes: `Proposed variant for experiment: ${exp.name}`
        })
        .select('id')
        .single();

      if (hvInsertError || !hvRow) throw hvInsertError || new Error('Failed to insert variant harness version');
      const newHarnessVersionId = hvRow.id;

      // Insert variant
      const { data: varRow, error: varInsertError } = await supabaseServer
        .from('experiment_variants')
        .insert({
          experiment_id: idNum,
          harness_version_id: newHarnessVersionId,
          variant_label: p.title,
          config_diff: JSON.stringify({ diff: diff.trim() }),
          exported_config_uri: `public/demo/runs/improved.json`,
          status: 'PLANNED'
        })
        .select('id')
        .single();

      if (varInsertError || !varRow) throw varInsertError || new Error('Failed to insert variant');
      const variantId = varRow.id;

      createdVariants.push({
        experiment_variant_id: `ev${variantId}`,
        variant_label: p.title,
        exported_config_uri: `public/demo/runs/improved.json`,
        status: 'planned'
      });
    }

    const jobId = createJob('propose');
    updateJob(jobId, 'completed', 1.0);

    return sendSuccess({
      job_id: jobId,
      variants: createdVariants
    }, 202);

  } catch (err: any) {
    console.error('Propose variants error:', err);
    return sendError('SERVER_ERROR', err.message || 'Error proposing variants', null, 500);
  }
}
