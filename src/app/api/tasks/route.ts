import { NextRequest, NextResponse } from 'next/server';

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const run_id = searchParams.get('run_id');
    const run_task_id = searchParams.get('run_task_id');

    // Case 1: Fetch single task detail with trace steps
    if (run_task_id) {
      const taskRes = await fetch(`http://localhost:8001/api/v1/tasks/${run_task_id}`, { cache: 'no-store' });
      const taskData = await taskRes.json();
      if (!taskRes.ok) {
        return NextResponse.json({ error: taskData.detail || 'Task not found' }, { status: taskRes.status });
      }

      const traceRes = await fetch(`http://localhost:8001/api/v1/tasks/${run_task_id}/trace`, { cache: 'no-store' });
      const traceData = await traceRes.json();
      const steps = (traceData.data?.steps || []).map((s: any) => {
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

      return NextResponse.json({ task: taskData.data, steps });
    }

    // Case 2: Fetch list of tasks for a run
    if (!run_id) {
      return NextResponse.json({ error: 'Missing run_id or run_task_id' }, { status: 400 });
    }

    const status = searchParams.get('status');
    const category = searchParams.get('category');

    let url = `http://localhost:8001/api/v1/runs/${run_id}/tasks`;
    const params: string[] = [];
    if (status) params.push(`status=${encodeURIComponent(status)}`);
    if (category) params.push(`category=${encodeURIComponent(category)}`);
    if (params.length > 0) {
      url += `?${params.join('&')}`;
    }

    const response = await fetch(url, { cache: 'no-store' });
    const data = await response.json();
    if (!response.ok) {
      return NextResponse.json({ error: data.detail || 'Failed to fetch tasks' }, { status: response.status });
    }

    // Map to client expected properties
    const tasks = (data.data || []).map((t: any) => ({
      id: t.id,
      run_id: t.run_id,
      status: t.status,
      score: t.score,
      task_id: t.benchmark_task_id,
      slug: t.task_slug,
      category: t.category,
      difficulty: t.difficulty,
      description: t.description,
      diagnosis_text: t.diagnosis_text,
      taxonomy_label: t.taxonomy_label
    }));

    return NextResponse.json({ tasks });

  } catch (err: any) {
    console.error('Fetch tasks error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const response = await fetch('http://localhost:8001/api/v1/tasks/override', {
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
