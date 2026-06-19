import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase-server';
import { fetchWithBypass } from '@/lib/api-helper';

const BACKEND = process.env.VERCEL_URL
  ? `https://${process.env.VERCEL_URL}/_/backend/api/v1`
  : 'http://localhost:8001/api/v1';

const fetch = fetchWithBypass;

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const run_id = searchParams.get('run_id');
    const run_task_id = searchParams.get('run_task_id');

    // Case 1: Fetch single task detail with trace steps
    if (run_task_id) {
      const { data: task, error: taskError } = await supabaseServer
        .from('run_tasks')
        .select(`
          *,
          benchmark_tasks!inner (
            task_id,
            title,
            category,
            difficulty
          )
        `)
        .eq('id', run_task_id)
        .single();

      if (taskError || !task) {
        return NextResponse.json({ error: 'Task not found' }, { status: 404 });
      }

      const { data: fl } = await supabaseServer
        .from('failure_labels')
        .select('*')
        .eq('run_task_id', run_task_id)
        .maybeSingle();

      let desc = '';
      if (task.raw_result) {
        try {
          const rawTask = typeof task.raw_result === 'string' ? JSON.parse(task.raw_result) : task.raw_result;
          desc = rawTask?.description || '';
        } catch (_) {}
      }
      if (!desc && task.benchmark_tasks?.title) {
        desc = task.benchmark_tasks.title;
      }

      const taskData = {
        id: task.id,
        run_id: task.run_id,
        status: task.status,
        score: task.score,
        task_id: task.benchmark_tasks?.task_id,
        slug: task.task_slug || `task-${task.benchmark_tasks?.task_id}`,
        category: task.benchmark_tasks?.category,
        difficulty: task.benchmark_tasks?.difficulty,
        description: desc,
        diagnosis_text: fl ? fl.diagnosis_text : null,
        taxonomy_label: fl ? fl.taxonomy_primary : null,
        failure_label_id: fl ? fl.id : null
      };

      const { data: traceSteps } = await supabaseServer
        .from('trace_steps')
        .select('*')
        .eq('run_task_id', run_task_id)
        .order('step_index', { ascending: true });

      const steps = (traceSteps || []).map((s: any) => {
        let type = 'LOG';
        const st = (s.step_type || '').toUpperCase();
        if (st === 'ASSISTANT') type = 'agent';
        else if (st === 'USER') type = 'user';
        else if (st === 'SYSTEM') type = 'system';
        else if (st === 'TOOL_CALL' || st === 'COMMAND') type = 'tool_call';
        else if (st === 'TOOL_RESULT') type = 'tool_output';

        return {
          id: s.id,
          run_task_id: s.run_task_id,
          step_index: s.step_index,
          type,
          content: s.content,
          output: type === 'tool_output' ? s.content : null
        };
      });

      return NextResponse.json({ task: taskData, steps });
    }

    // Case 2: Fetch list of tasks for a run
    if (!run_id) {
      return NextResponse.json({ error: 'Missing run_id or run_task_id' }, { status: 400 });
    }

    const status = searchParams.get('status');
    const category = searchParams.get('category');

    let query = supabaseServer
      .from('run_tasks')
      .select(`
        *,
        benchmark_tasks!inner (
          task_id,
          title,
          category,
          difficulty
        ),
        failure_labels (
          diagnosis_text,
          taxonomy_primary
        )
      `)
      .eq('run_id', run_id);

    if (status) {
      query = query.eq('status', status.toUpperCase());
    }
    if (category) {
      query = query.eq('benchmark_tasks.category', category);
    }

    query = query.order('task_slug', { ascending: true });

    const { data: rows, error } = await query;

    if (error) {
      throw error;
    }

    const tasks = (rows || []).map((t: any) => {
      let desc = '';
      if (t.raw_result) {
        try {
          const rawTask = typeof t.raw_result === 'string' ? JSON.parse(t.raw_result) : t.raw_result;
          desc = rawTask?.description || '';
        } catch (_) {}
      }
      if (!desc && t.benchmark_tasks?.title) {
        desc = t.benchmark_tasks.title;
      }

      // failure_labels is returned as an array by supabase; take the first
      const fl = Array.isArray(t.failure_labels) ? t.failure_labels[0] : t.failure_labels;

      return {
        id: t.id,
        run_id: t.run_id,
        status: t.status,
        score: t.score,
        task_id: t.benchmark_tasks?.task_id,
        slug: t.task_slug || `task-${t.benchmark_tasks?.task_id}`,
        category: t.benchmark_tasks?.category,
        difficulty: t.benchmark_tasks?.difficulty,
        description: desc,
        diagnosis_text: fl ? fl.diagnosis_text : null,
        taxonomy_label: fl ? fl.taxonomy_primary : null
      };
    });

    return NextResponse.json({ tasks });
  } catch (err: any) {
    console.error('Fetch tasks error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const response = await fetch(`${BACKEND}/tasks/override`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    const data = await response.json();

    if (!response.ok) {
      return NextResponse.json({ error: data.detail || 'Failed to override taxonomy' }, { status: response.status });
    }

    return NextResponse.json(data);
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export { POST as PUT };
