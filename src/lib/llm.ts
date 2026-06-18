import { TraceStep } from './types';

// Supported taxonomies
export type TaxonomyLabel = 'GAP' | 'AMBIGUITY' | 'TOOL_MISUSE' | 'CODE_BUG' | 'UPSTREAM' | 'SAFETY_VIOLATION';

interface DiagnosisResult {
  diagnosis_text: string;
  taxonomy_label: TaxonomyLabel;
}

/**
 * Clean trajectory to fit LLM prompt limits
 */
function formatTrajectorySnippet(steps: TraceStep[]): string {
  return steps
    .slice(-10) // focus on the end where the failure usually occurs
    .map(s => {
      const outputStr = s.output ? `\nOutput: ${s.output.substring(0, 300)}${s.output.length > 300 ? '...' : ''}` : '';
      return `[Step ${s.step_index}] ${(s.type || 'LOG').toUpperCase()}: ${s.content.substring(0, 300)}${s.content.length > 300 ? '...' : ''}${outputStr}`;
    })
    .join('\n\n');
}

/**
 * Local Heuristics-based fallback diagnostic generator
 */
export function generateHeuristicDiagnosis(
  taskDescription: string,
  slug: string,
  steps: TraceStep[]
): DiagnosisResult {
  const lastStepsText = steps
    .slice(-5)
    .map(s => `${s.content} ${s.output || ''}`)
    .join(' ')
    .toLowerCase();

  const fullText = (taskDescription + ' ' + slug + ' ' + lastStepsText).toLowerCase();

  let diagnosis_text = 'Agent failed to complete the task successfully. ';
  let taxonomy_label: TaxonomyLabel = 'TOOL_MISUSE';

  // Heuristic rule 1: Python/Syntax/Code Bugs
  if (
    fullText.includes('syntaxerror') ||
    fullText.includes('traceback') ||
    fullText.includes('typeerror') ||
    fullText.includes('nullpointer') ||
    fullText.includes('referenceerror') ||
    fullText.includes('undefined') ||
    fullText.includes('import error') ||
    fullText.includes('module not found')
  ) {
    taxonomy_label = 'CODE_BUG';
    const match = lastStepsText.match(/(?:error|exception|traceback):?\s*([^\n]+)/i);
    diagnosis_text = match 
      ? `Code execution failed due to a runtime bug: ${match[1].trim()}`
      : 'Agent encountered a programming exception or traceback in its execution script.';
  }
  // Heuristic rule 2: Safety & Policy
  else if (
    fullText.includes('safety') ||
    fullText.includes('policy') ||
    fullText.includes('forbidden') ||
    fullText.includes('unauthorized') ||
    fullText.includes('block') ||
    fullText.includes('abuse')
  ) {
    taxonomy_label = 'SAFETY_VIOLATION';
    diagnosis_text = 'The agent trajectory triggered a security filter, permission restriction, or content safety policy.';
  }
  // Heuristic rule 3: Ambiguity
  else if (
    fullText.includes('ambiguous') ||
    fullText.includes('unclear') ||
    fullText.includes('specify') ||
    fullText.includes('choose between') ||
    fullText.includes('conflicting')
  ) {
    taxonomy_label = 'AMBIGUITY';
    diagnosis_text = 'Task instructions are underspecified or conflicting, making it impossible to determine the correct target state.';
  }
  // Heuristic rule 4: Environment/Network/Upstream
  else if (
    fullText.includes('connection timed out') ||
    fullText.includes('502 bad gateway') ||
    fullText.includes('500 internal server') ||
    fullText.includes('could not resolve host') ||
    fullText.includes('network is unreachable') ||
    fullText.includes('connection refused')
  ) {
    taxonomy_label = 'UPSTREAM';
    diagnosis_text = 'Execution failed due to external system dependencies, host resolution issues, or network unavailability.';
  }
  // Heuristic rule 5: Capabilities/Tools Gap
  else if (
    fullText.includes('command not found') ||
    fullText.includes('permission denied') ||
    fullText.includes('not permitted') ||
    fullText.includes('tool not available') ||
    fullText.includes('missing package') ||
    fullText.includes('apt-get install')
  ) {
    taxonomy_label = 'GAP';
    diagnosis_text = 'Agent was missing required OS utilities, packages, permissions, or specialized tools to run the requested commands.';
  }
  // Heuristic rule 6: Tool Misuse / standard failures
  else {
    taxonomy_label = 'TOOL_MISUSE';
    // Find some text describing the command failure
    const toolCall = steps.find(s => s.type === 'tool_call' || s.type === 'command');
    if (toolCall) {
      diagnosis_text = `Agent attempted to call tools but misused parameters or provided invalid arguments: "${toolCall.content.substring(0, 60)}".`;
    } else {
      diagnosis_text = 'Agent exited or stalled without completing key requirements, likely due to incorrect logic loop parameters.';
    }
  }

  return { diagnosis_text, taxonomy_label };
}

/**
 * Standard LLM Diagnostic Call using API
 */
export async function diagnoseFailure(
  taskDescription: string,
  slug: string,
  steps: TraceStep[]
): Promise<DiagnosisResult> {
  const geminiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
  const openaiKey = process.env.OPENAI_API_KEY;

  if (!geminiKey && !openaiKey) {
    try {
      const prompt = `
You are analyzing a failed run of an AI agent on a terminal/command-line benchmark task.
Task Name/Slug: ${slug}
Task Description: ${taskDescription}

Here is the end of the agent's trajectory trace:
${formatTrajectorySnippet(steps)}

Determine why the agent failed and return a JSON object with exactly two keys:
1. "diagnosis_text": A concise (1-2 sentences) explanation of why the task failed based on the logs.
2. "taxonomy_label": Choose exactly one of the following category labels:
   - "GAP": Agent is missing tools, OS permissions, or capabilities required for the task.
   - "AMBIGUITY": Instructions are conflicting, unclear, or require user clarification.
   - "TOOL_MISUSE": Agent makes parameter errors, syntax errors in tools, runs commands incorrectly, or loops.
   - "CODE_BUG": Runtime code exceptions, tracebacks, or bugs in the agent's script code/libraries.
   - "UPSTREAM": Network timeouts, API crashes, or environmental/infrastructure failures.
   - "SAFETY_VIOLATION": Agent output blocked by safety filters or policy guardrails.

Your output must be parseable JSON only. Do not wrap in markdown blocks.
`;
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 1000);
      const res = await fetch('http://localhost:8080/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'local',
          response_format: { type: 'json_object' },
          messages: [{ role: 'user', content: prompt }]
        }),
        signal: controller.signal
      });
      clearTimeout(timeoutId);
      const data = await res.json();
      const text = data.choices?.[0]?.message?.content;
      if (text) {
        const parsed = JSON.parse(text.replace(/```json|```/g, '').trim());
        if (parsed.diagnosis_text && parsed.taxonomy_label) {
          return parsed as DiagnosisResult;
        }
      }
    } catch (err) {
      console.warn('Local llama.cpp diagnostics call failed, falling back to heuristics:', err);
    }
    return generateHeuristicDiagnosis(taskDescription, slug, steps);
  }

  const prompt = `
You are analyzing a failed run of an AI agent on a terminal/command-line benchmark task.
Task Name/Slug: ${slug}
Task Description: ${taskDescription}

Here is the end of the agent's trajectory trace:
${formatTrajectorySnippet(steps)}

Determine why the agent failed and return a JSON object with exactly two keys:
1. "diagnosis_text": A concise (1-2 sentences) explanation of why the task failed based on the logs.
2. "taxonomy_label": Choose exactly one of the following category labels:
   - "GAP": Agent is missing tools, OS permissions, or capabilities required for the task.
   - "AMBIGUITY": Instructions are conflicting, unclear, or require user clarification.
   - "TOOL_MISUSE": Agent makes parameter errors, syntax errors in tools, runs commands incorrectly, or loops.
   - "CODE_BUG": Runtime code exceptions, tracebacks, or bugs in the agent's script code/libraries.
   - "UPSTREAM": Network timeouts, API crashes, or environmental/infrastructure failures.
   - "SAFETY_VIOLATION": Agent output blocked by safety filters or policy guardrails.

Your output must be parseable JSON only. Do not wrap in markdown blocks.
`;

  try {
    if (geminiKey) {
      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${geminiKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { responseMimeType: 'application/json' }
        })
      });
      const data = await res.json();
      const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
      if (text) {
        const parsed = JSON.parse(text.replace(/```json|```/g, '').trim());
        if (parsed.diagnosis_text && parsed.taxonomy_label) {
          return parsed as DiagnosisResult;
        }
      }
    } else if (openaiKey) {
      const res = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${openaiKey}`
        },
        body: JSON.stringify({
          model: 'gpt-4o-mini',
          response_format: { type: 'json_object' },
          messages: [{ role: 'user', content: prompt }]
        })
      });
      const data = await res.json();
      const text = data.choices?.[0]?.message?.content;
      if (text) {
        const parsed = JSON.parse(text);
        if (parsed.diagnosis_text && parsed.taxonomy_label) {
          return parsed as DiagnosisResult;
        }
      }
    }
  } catch (err) {
    console.error('LLM Ingestion Diagnostic Call Failed, falling back to heuristics:', err);
  }

  return generateHeuristicDiagnosis(taskDescription, slug, steps);
}

/**
 * Propose candidate harness fixes for an Experiment
 */
export async function proposeHarnessFixes(
  failureModes: Array<{ title: string; description: string; taxonomy_label: string }>
): Promise<Array<{ title: string; type: string; prompt_suggestion: string; tool_config: string }>> {
  const geminiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
  const openaiKey = process.env.OPENAI_API_KEY;

  const defaultFixes = [
    {
      title: 'Enhanced Command Pre-flight Checking Prompt',
      type: 'Prompt Variation',
      prompt_suggestion: 'You are executing in a restricted sandboxed shell. Before executing a command, check if you have the package installed (e.g. command -v <cmd>). If missing, install it with apt-get or notify status immediately.',
      tool_config: 'No tool config change needed.'
    },
    {
      title: 'Automatic Path & Env Initialization',
      type: 'Tool Configuration',
      prompt_suggestion: 'Verify all paths relative to the current working directory first.',
      tool_config: 'Add env.PATH path initialization scripts before running agent commands.'
    },
    {
      title: 'Strict Input Validation Safety Gate',
      type: 'Parameter Adjustments',
      prompt_suggestion: 'Validate inputs to avoid execution failures and parameter loops.',
      tool_config: 'Reduce temperature to 0.1, set max_steps to 30 to limit loops.'
    }
  ];

  if (!geminiKey && !openaiKey) {
    try {
      const prompt = `
We have an agent benchmark experiment targeting specific failure modes:
${failureModes.map((fm, i) => `${i+1}. [${fm.taxonomy_label}] ${fm.title}: ${fm.description}`).join('\n')}

Propose exactly three concrete candidate harness modifications to help the agent bypass these failures.
Each modification must contain:
1. "title": descriptive name of candidate
2. "type": 'Prompt Variation' | 'Tool Configuration' | 'Parameter Adjustments'
3. "prompt_suggestion": modified system instruction or prefix prompting suggestion.
4. "tool_config": changes to tools, ordering, arguments or model parameters.

Return a JSON array of 3 objects with these keys. No markdown formatting.
`;
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 1000);
      const res = await fetch('http://localhost:8080/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'local',
          response_format: { type: 'json_object' },
          messages: [{ role: 'user', content: prompt }]
        }),
        signal: controller.signal
      });
      clearTimeout(timeoutId);
      const data = await res.json();
      const text = data.choices?.[0]?.message?.content;
      if (text) {
        const parsed = JSON.parse(text.replace(/```json|```/g, '').trim());
        const list = Array.isArray(parsed) ? parsed : (parsed.suggestions || parsed);
        if (Array.isArray(list) && list.length > 0) {
          return list as any[];
        }
      }
    } catch (err) {
      console.warn('Local llama.cpp harness fix suggestion call failed, falling back to defaults:', err);
    }
    return defaultFixes;
  }

  const prompt = `
We have an agent benchmark experiment targeting specific failure modes:
${failureModes.map((fm, i) => `${i+1}. [${fm.taxonomy_label}] ${fm.title}: ${fm.description}`).join('\n')}

Propose exactly three concrete candidate harness modifications to help the agent bypass these failures.
Each modification must contain:
1. "title": descriptive name of candidate
2. "type": 'Prompt Variation' | 'Tool Configuration' | 'Parameter Adjustments'
3. "prompt_suggestion": modified system instruction or prefix prompting suggestion.
4. "tool_config": changes to tools, ordering, arguments or model parameters.

Return a JSON array of 3 objects with these keys. No markdown formatting.
`;

  try {
    if (geminiKey) {
      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${geminiKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { responseMimeType: 'application/json' }
        })
      });
      const data = await res.json();
      const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
      if (text) {
        return JSON.parse(text.replace(/```json|```/g, '').trim());
      }
    } else if (openaiKey) {
      const res = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${openaiKey}`
        },
        body: JSON.stringify({
          model: 'gpt-4o-mini',
          response_format: { type: 'json_object' },
          messages: [{ role: 'user', content: prompt }]
        })
      });
      const data = await res.json();
      const text = data.choices?.[0]?.message?.content;
      if (text) {
        const parsed = JSON.parse(text);
        return parsed.suggestions || parsed;
      }
    }
  } catch (err) {
    console.error('LLM harness fix suggestion call failed:', err);
  }

  return defaultFixes;
}
