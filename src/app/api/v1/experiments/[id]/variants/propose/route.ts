import { NextRequest } from 'next/server';
import { db } from '@/lib/db';
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

    const exp = await db.prepare('SELECT * FROM experiments WHERE id = ?').get(idNum) as any;
    if (!exp) {
      return sendError('NOT_FOUND', `Experiment not found with ID: ${id}`, { experiment_id: id }, 404);
    }

    // Read body if present, default to empty
    let body: any = {};
    try {
      body = await req.json();
    } catch {}

    // Get the targets failure modes
    const targets = await db.prepare('SELECT target_id FROM experiment_targets WHERE experiment_id = ? AND target_type = \'FAILURE_MODE\'').all(idNum) as any[];

    // Fetch target failure modes detail
    const failureModes: any[] = [];
    for (const t of targets) {
      const fm = await db.prepare('SELECT name as title, description, taxonomy_primary as taxonomy_label FROM failure_modes WHERE id = ?').get(t.target_id) as any;
      if (fm) failureModes.push(fm);
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
    const baseHarness = await db.prepare('SELECT name FROM harness_versions WHERE id = ?').get(exp.base_harness_version_id) as any;
    const baseHarnessName = baseHarness ? baseHarness.name : 'v1.0.0';

    const insertTx = db.transaction(async () => {
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
        const hvResult = await db.prepare(`
          INSERT INTO harness_versions (name, config, notes)
          VALUES (?, ?, ?)
          RETURNING id
        `).run(varVersionName, configYaml.trim(), `Proposed variant for experiment: ${exp.name}`);
        const newHarnessVersionId = hvResult.lastInsertRowid;

        // Insert variant
        const varResult = await db.prepare(`
          INSERT INTO experiment_variants (experiment_id, harness_version_id, variant_label, config_diff, exported_config_uri, status)
          VALUES (?, ?, ?, ?, ?, 'PLANNED')
          RETURNING id
        `).run(
          idNum,
          newHarnessVersionId,
          p.title,
          JSON.stringify({ diff: diff.trim() }),
          `public/demo/runs/improved.json`
        );
        const variantId = varResult.lastInsertRowid;

        createdVariants.push({
          experiment_variant_id: `ev${variantId}`,
          variant_label: p.title,
          exported_config_uri: `public/demo/runs/improved.json`,
          status: 'planned'
        });
      }

      return createdVariants;
    });

    const result = await insertTx();

    const jobId = createJob('propose');
    updateJob(jobId, 'completed', 1.0);

    return sendSuccess({
      job_id: jobId,
      variants: result
    }, 202);

  } catch (err: any) {
    console.error('Propose variants error:', err);
    return sendError('SERVER_ERROR', err.message || 'Error proposing variants', null, 500);
  }
}
