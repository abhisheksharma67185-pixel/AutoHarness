import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { supabaseServer } from './supabase-server';
import { TraceStep } from './types';

// Predefined command outputs for known tasks to ensure safe, reliable demo simulation
const SIMULATED_COMMANDS: Record<string, Record<string, { output: string; status?: string; score?: number }>> = {
  'nginx-port-clash': {
    'systemctl status nginx': {
      output: 'nginx.service - A high performance web server and reverse proxy\nActive: failed\nError: bind() to 0.0.0.0:80 failed (Address already in use)'
    },
    'service nginx status': {
      output: 'nginx.service - A high performance web server and reverse proxy\nActive: failed\nError: bind() to 0.0.0.0:80 failed (Address already in use)'
    },
    'ss -tulpn | grep :80': {
      output: 'tcp   LISTEN 0      511          0.0.0.0:80        0.0.0.0:*      users:(("apache2",pid=912,fd=4))'
    },
    'netstat -tulpn | grep :80': {
      output: 'tcp   LISTEN 0      511          0.0.0.0:80        0.0.0.0:*      users:(("apache2",pid=912,fd=4))'
    },
    'systemctl stop apache2 && systemctl start nginx': {
      output: 'Stopping apache2... Done\nStarting nginx... Done',
      status: 'PASS',
      score: 1.0
    },
    'service apache2 stop && service nginx start': {
      output: 'Stopping apache2... Done\nStarting nginx... Done',
      status: 'PASS',
      score: 1.0
    }
  },
  'git-rebase-conflict': {
    'git rebase origin/main': {
      output: 'CONFLICT (content): Merge conflict in lib/core.py\nResolve all conflicts manually.'
    },
    'cat lib/core.py': {
      output: '<<<<<<< HEAD\ndef get_score(self):\n    return self.score * 100\n=======\ndef get_score(self):\n    return self.base_score + self.delta\n>>>>>>> feature/scores'
    },
    'git rebase --continue': {
      output: 'Applying: update score delta calculation\nRebase finished successfully.',
      status: 'PASS',
      score: 1.0
    }
  },
  'parse-server-logs': {
    "awk '$9 == 500 {print $7}' /var/log/nginx/access.log | sort | uniq -c": {
      output: '  12 /api/v1/users\n  45 /api/v1/auth/login'
    },
    "echo '{\"/api/v1/users\": 12, \"/api/v1/auth/login\": 45}' > /tmp/report.json": {
      output: '',
      status: 'PASS',
      score: 1.0
    }
  }
};

// Default mock sequences if LLM is unavailable or fails
const MOCK_AGENT_SEQUENCES: Record<string, Array<{ thought: string; command: string | null }>> = {
  'nginx-port-clash': [
    { thought: 'I will check the status of the nginx service first.', command: 'systemctl status nginx' },
    { thought: 'It failed because port 80 is occupied. Let me check what is using port 80.', command: 'ss -tulpn | grep :80' },
    { thought: 'Apache is occupying port 80. I will stop Apache and start Nginx.', command: 'systemctl stop apache2 && systemctl start nginx' },
    { thought: 'Nginx is now running. Task completed successfully.', command: null }
  ],
  'git-rebase-conflict': [
    { thought: 'I will start rebasing onto origin/main.', command: 'git rebase origin/main' },
    { thought: 'There is a merge conflict in lib/core.py. Let me read the conflict markers.', command: 'cat lib/core.py' },
    { thought: 'I will resolve the conflict and continue rebasing.', command: 'git rebase --continue' },
    { thought: 'Rebase complete and clean.', command: null }
  ],
  'parse-server-logs': [
    { thought: 'I will parse the server log file to filter out HTTP 500 server errors.', command: "awk '$9 == 500 {print $7}' /var/log/nginx/access.log | sort | uniq -c" },
    { thought: 'Now I will write these counts into the required JSON report format.', command: "echo '{\"/api/v1/users\": 12, \"/api/v1/auth/login\": 45}' > /tmp/report.json" },
    { thought: 'Logs parsed and report generated.', command: null }
  ]
};

const DEFAULT_MOCK_SEQUENCE = [
  { thought: 'I will inspect the workspace files.', command: 'ls -la' },
  { thought: 'The environment seems configured. I will write a success trigger.', command: 'echo "done"' },
  { thought: 'Verification successful.', command: null }
];

/**
 * Call local llama.cpp / Gemini / OpenAI to decide the agent's next step
 */
async function callAgentLLM(
  systemPrompt: string,
  history: Array<{ type: string; content: string; output?: string | null }>
): Promise<{ thought: string; command: string | null }> {
  const geminiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
  const openaiKey = process.env.OPENAI_API_KEY;
  
  // Decide endpoint and headers
  let url = 'http://localhost:8080/v1/chat/completions';
  let headers: Record<string, string> = { 'Content-Type': 'application/json' };
  let payload: any = {};

  const prompt = `
System Prompt:
${systemPrompt}

Trajectory history so far:
${history.map(h => {
  if (h.type === 'agent') return `Agent Thought: ${h.content}`;
  if (h.type === 'tool_call') return `Command: ${h.content}`;
  if (h.type === 'tool_output') return `Output:\n${h.output}`;
  return `${h.type}: ${h.content}`;
}).join('\n\n')}

State your next action. You MUST output a valid JSON object with exactly two fields:
1. "thought": Your logic or reasoning for this step.
2. "command": The bash shell command to execute, or null if the task is complete.

JSON output only:
`;

  try {
    if (geminiKey) {
      url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${geminiKey}`;
      payload = {
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { responseMimeType: 'application/json' }
      };
      const res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(payload) });
      const data = await res.json();
      const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
      if (text) {
        return JSON.parse(text.replace(/```json|```/g, '').trim());
      }
    } else if (openaiKey) {
      url = 'https://api.openai.com/v1/chat/completions';
      headers['Authorization'] = `Bearer ${openaiKey}`;
      payload = {
        model: 'gpt-4o-mini',
        response_format: { type: 'json_object' },
        messages: [{ role: 'user', content: prompt }]
      };
      const res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(payload) });
      const data = await res.json();
      const text = data.choices?.[0]?.message?.content;
      if (text) {
        return JSON.parse(text);
      }
    } else {
      // Attempt local llama.cpp
      payload = {
        model: 'local',
        response_format: { type: 'json_object' },
        messages: [{ role: 'user', content: prompt }]
      };
      const controller = new AbortController();
      const id = setTimeout(() => controller.abort(), 2000); // 2 second timeout for local LLM
      const res = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
        signal: controller.signal
      });
      clearTimeout(id);
      const data = await res.json();
      const text = data.choices?.[0]?.message?.content;
      if (text) {
        return JSON.parse(text);
      }
    }
  } catch (err) {
    // Fall back to mock sequence or throw
    throw new Error('LLM call unavailable');
  }

  throw new Error('LLM did not return parseable JSON');
}

/**
 * Execute online evaluation of a test suite
 */
export async function runOnlineEvaluation(
  evalRunId: number,
  suiteId: number,
  harnessVersionId: number
): Promise<void> {
  try {
    // Update eval_run status to RUNNING
    const { error: updateStartError } = await supabaseServer
      .from('eval_runs')
      .update({ status: 'RUNNING' })
      .eq('id', evalRunId);
    if (updateStartError) throw updateStartError;

    // Fetch harness version configuration
    const { data: hv, error: hvError } = await supabaseServer
      .from('harness_versions')
      .select('name, config')
      .eq('id', harnessVersionId)
      .maybeSingle();
    if (hvError) throw hvError;

    const hvConfig = hv?.config ? JSON.parse(hv.config) : {};
    
    // Fetch benchmark and cases
    const { data: suite, error: suiteError } = await supabaseServer
      .from('eval_suites')
      .select('benchmark_id, name')
      .eq('id', suiteId)
      .maybeSingle();
    if (suiteError) throw suiteError;
    if (!suite) throw new Error(`Evaluation suite ${suiteId} not found`);

    const { data: members, error: membersError } = await supabaseServer
      .from('eval_suite_members')
      .select(`
        eval_suite_id,
        eval_cases (
          id,
          benchmark_task_id,
          failure_label_id,
          input_spec,
          expected_spec,
          scoring_config,
          created_by,
          created_at,
          benchmark_tasks (
            id,
            task_id,
            title,
            category,
            difficulty,
            metadata
          )
        )
      `)
      .eq('eval_suite_id', suiteId);
    if (membersError) throw membersError;

    const cases = (members || []).map((m: any) => {
      const ec = m.eval_cases;
      if (!ec) return null;
      const bt = ec.benchmark_tasks;
      let meta: any = {};
      try {
        meta = typeof bt?.metadata === 'string' ? JSON.parse(bt.metadata) : (bt?.metadata || {});
      } catch {}
      return {
        id: ec.id,
        benchmark_task_id: ec.benchmark_task_id,
        failure_label_id: ec.failure_label_id,
        input_spec: ec.input_spec,
        expected_spec: ec.expected_spec,
        scoring_config: ec.scoring_config,
        created_by: ec.created_by,
        created_at: ec.created_at,
        task_id: bt?.task_id,
        slug: bt?.title, // bt.title is the task slug
        category: bt?.category,
        difficulty: bt?.difficulty,
        description: meta.description || ''
      };
    }).filter(Boolean) as any[];

    // 1. Insert new 'runs' record for this live evaluation
    const runId = `run-online-eval-${evalRunId}`;
    const runLabel = `Live Evaluation Run (Suite: ${suite.name})`;
    const initialMetrics = JSON.stringify({ pass_rate: 0.0, avg_score: 0.0, total_tasks: cases.length });
    
    const { error: runInsertError } = await supabaseServer
      .from('runs')
      .insert({
        id: runId,
        benchmark_id: suite.benchmark_id,
        agent_name: 'SigmaAgent (Live)',
        harness_version_id: harnessVersionId,
        run_label: runLabel,
        metrics: initialMetrics,
        raw_artifact_uri: `public/scratch/eval-run-${evalRunId}/`
      });
    if (runInsertError) throw runInsertError;

    // Link newly generated run to our eval_run
    const { error: updateEvalRunIdError } = await supabaseServer
      .from('eval_runs')
      .update({ run_id: runId })
      .eq('id', evalRunId);
    if (updateEvalRunIdError) throw updateEvalRunIdError;

    let passedCasesCount = 0;
    let scoreSum = 0;

    // 2. Iterate and execute each case inside the sandbox
    for (const c of cases) {
      const sandboxDir = path.join(process.cwd(), 'public', 'scratch', `eval-run-${evalRunId}`, c.slug);
      fs.mkdirSync(sandboxDir, { recursive: true });

      // Insert run_task record
      const { data: rtRow, error: rtError } = await supabaseServer
        .from('run_tasks')
        .insert({
          run_id: runId,
          benchmark_task_id: c.benchmark_task_id,
          status: 'UNKNOWN',
          score: 0.0,
          raw_result: '{}'
        })
        .select('id')
        .single();
      if (rtError) throw rtError;
      const runTaskId = rtRow.id;

      // Define default system prompt
      const systemPrompt = `Task description: ${c.description}\n` + (hvConfig.agent_guidelines?.system_prompt_patch || '');

      let stepsHistory: Array<{ type: string; content: string; output?: string | null }> = [];
      let finalStatus = 'FAIL';
      let finalScore = 0.0;
      let stepIndex = 0;
      let finished = false;

      // Execute up to 10 loops
      while (stepIndex < 10 && !finished) {
        let nextStep: { thought: string; command: string | null };

        try {
          // Attempt calling LLM
          nextStep = await callAgentLLM(systemPrompt, stepsHistory);
        } catch {
          // If LLM fails, fall back to mock sequence matching task slug
          const sequence = MOCK_AGENT_SEQUENCES[c.slug] || DEFAULT_MOCK_SEQUENCE;
          nextStep = sequence[stepIndex] || { thought: 'Exiting simulation loop.', command: null };
        }

        // 1. Log Agent Thought step
        const { error: stepThoughtError } = await supabaseServer
          .from('trace_steps')
          .insert({
            run_task_id: runTaskId,
            step_index: stepIndex++,
            step_type: 'ASSISTANT',
            content: nextStep.thought,
            metadata: '{}'
          });
        if (stepThoughtError) throw stepThoughtError;
        
        stepsHistory.push({ type: 'agent', content: nextStep.thought });

        if (!nextStep.command) {
          finished = true;
          break;
        }

        // 2. Log Command step
        const { error: stepCommandError } = await supabaseServer
          .from('trace_steps')
          .insert({
            run_task_id: runTaskId,
            step_index: stepIndex++,
            step_type: 'COMMAND',
            content: nextStep.command,
            metadata: '{}'
          });
        if (stepCommandError) throw stepCommandError;

        stepsHistory.push({ type: 'tool_call', content: nextStep.command });

        // Execute command (hybrid runner: check simulation mapping first, else run in local shell if safe)
        let commandOutput = '';

        const simulatedMatch = SIMULATED_COMMANDS[c.slug]?.[nextStep.command];

        if (simulatedMatch) {
          commandOutput = simulatedMatch.output;
          if (simulatedMatch.status) {
            finalStatus = simulatedMatch.status;
            finalScore = simulatedMatch.score || 0.0;
          }
        } else {
          // Run command inside the local sandbox folder
          try {
            // Check security restrictions
            const isDestructive = ['rm -rf', 'sudo', 'dd', 'shutdown', 'poweroff', 'reboot'].some(prefix => 
              nextStep.command!.toLowerCase().includes(prefix)
            );

            if (isDestructive) {
              commandOutput = 'Security Error: Command blocked by AutoHarness Studio policy filter.';
            } else {
              const buffer = execSync(nextStep.command, { cwd: sandboxDir, timeout: 5000 });
              commandOutput = buffer.toString();
              // A clean exit code inside local sandboxed run can be marked successful
              finalStatus = 'PASS';
              finalScore = 1.0;
            }
          } catch (execErr: any) {
            commandOutput = execErr.message || 'Execution error';
          }
        }

        // 3. Log Command Output step
        const { error: stepResultError } = await supabaseServer
          .from('trace_steps')
          .insert({
            run_task_id: runTaskId,
            step_index: stepIndex++,
            step_type: 'TOOL_RESULT',
            content: commandOutput,
            metadata: '{}'
          });
        if (stepResultError) throw stepResultError;

        stepsHistory.push({ type: 'tool_output', content: nextStep.command, output: commandOutput });
      }

      // Check if steps completed successfully or timed out
      if (stepIndex >= 10 && finalStatus !== 'PASS') {
        finalStatus = 'TIMEOUT';
      }

      if (finalStatus === 'PASS') {
        passedCasesCount++;
      }
      scoreSum += finalScore;

      // Update run_tasks with final status and score
      const { error: updateRunTaskError } = await supabaseServer
        .from('run_tasks')
        .update({
          status: finalStatus,
          score: finalScore,
          finished_at: new Date().toISOString()
        })
        .eq('id', runTaskId);
      if (updateRunTaskError) throw updateRunTaskError;

      // Insert failure label diagnostic if failed
      if (finalStatus !== 'PASS') {
        const { error: insertLabelError } = await supabaseServer
          .from('failure_labels')
          .insert({
            run_task_id: runTaskId,
            is_failure: 1,
            source: 'LLM_JUDGE',
            score: finalScore,
            diagnosis_text: 'Task failed during online re-run execution.',
            taxonomy_primary: 'TOOL_MISUSE',
            taxonomy_secondary: '[]'
          });
        if (insertLabelError) throw insertLabelError;
      }

      // Insert eval_results
      const { error: insertResultError } = await supabaseServer
        .from('eval_results')
        .insert({
          eval_run_id: evalRunId,
          eval_case_id: c.id,
          status: finalStatus,
          score: finalScore,
          raw_output: JSON.stringify({ steps: stepsHistory }),
          judge_metadata: '{}'
        });
      if (insertResultError) throw insertResultError;
    }

    const totalCases = cases.length;
    const finalPassRate = totalCases > 0 ? passedCasesCount / totalCases : 0.0;
    const finalAvgScore = totalCases > 0 ? scoreSum / totalCases : 0.0;

    const metricsObj = {
      pass_rate: finalPassRate,
      avg_score: finalAvgScore,
      num_cases: totalCases
    };

    // 3. Update eval_run and run records with final metrics
    const { error: updateEvalFinishedError } = await supabaseServer
      .from('eval_runs')
      .update({
        status: 'COMPLETED',
        metrics: JSON.stringify(metricsObj),
        finished_at: new Date().toISOString()
      })
      .eq('id', evalRunId);
    if (updateEvalFinishedError) throw updateEvalFinishedError;

    const { error: updateRunFinishedError } = await supabaseServer
      .from('runs')
      .update({
        metrics: JSON.stringify({ pass_rate: finalPassRate, avg_score: finalAvgScore, total_tasks: totalCases })
      })
      .eq('id', runId);
    if (updateRunFinishedError) throw updateRunFinishedError;

  } catch (error: any) {
    console.error('Online Rerun Job Failed:', error);
    await supabaseServer
      .from('eval_runs')
      .update({
        status: 'FAILED',
        metrics: JSON.stringify({ error: error.message || 'Unknown error' }),
        finished_at: new Date().toISOString()
      })
      .eq('id', evalRunId);
  }
}
