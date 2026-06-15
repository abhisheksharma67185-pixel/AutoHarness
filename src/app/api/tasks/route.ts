import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
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
      try {
        const task = await db.prepare(`
          SELECT rt.*, bt.task_id as benchmark_task_id, bt.title as task_title, bt.category, bt.difficulty
          FROM run_tasks rt
          JOIN benchmark_tasks bt ON rt.benchmark_task_id = bt.id
          WHERE rt.id = ?
        `).get(run_task_id) as any;

        if (!task) {
          throw new Error('Task not found in SQLite');
        }

        const fl = await db.prepare('SELECT * FROM failure_labels WHERE run_task_id = ?').get(run_task_id) as any;
        let desc = '';
        if (task.raw_result) {
          try {
            const rawTask = typeof task.raw_result === 'string' ? JSON.parse(task.raw_result) : task.raw_result;
            desc = rawTask?.description || '';
          } catch (_) {}
        }
        if (!desc && task.task_title) {
          desc = task.task_title;
        }

        const taskData = {
          id: task.id,
          run_id: task.run_id,
          status: task.status,
          score: task.score,
          task_id: task.benchmark_task_id,
          slug: task.task_slug || `task-${task.benchmark_task_id}`,
          category: task.category,
          difficulty: task.difficulty,
          description: desc,
          diagnosis_text: fl ? fl.diagnosis_text : null,
          taxonomy_label: fl ? fl.taxonomy_primary : null,
          failure_label_id: fl ? fl.id : null
        };

        const traceSteps = await db.prepare('SELECT * FROM trace_steps WHERE run_task_id = ? ORDER BY step_index').all(run_task_id) as any[];
        const steps = traceSteps.map((s: any) => {
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
      } catch (dbErr: any) {
        console.error('Direct SQLite single-task query failed, falling back to HTTP:', dbErr);
        const taskRes = await fetch(`${BACKEND}/tasks/${run_task_id}`, { cache: 'no-store' });
        const taskData = await taskRes.json();
        if (!taskRes.ok) {
          return NextResponse.json({ error: taskData.detail || 'Task not found' }, { status: taskRes.status });
        }

        const traceRes = await fetch(`${BACKEND}/tasks/${run_task_id}/trace`, { cache: 'no-store' });
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
    }

    // Case 2: Fetch list of tasks for a run
    if (!run_id) {
      return NextResponse.json({ error: 'Missing run_id or run_task_id' }, { status: 400 });
    }

    const status = searchParams.get('status');
    const category = searchParams.get('category');

    try {
      let query = `
        SELECT rt.*, bt.task_id as benchmark_task_id, bt.title as task_title, bt.category, bt.difficulty,
               fl.diagnosis_text, fl.taxonomy_primary as taxonomy_label
        FROM run_tasks rt
        JOIN benchmark_tasks bt ON rt.benchmark_task_id = bt.id
        LEFT JOIN failure_labels fl ON rt.id = fl.run_task_id
        WHERE rt.run_id = ?
      `;
      const params: any[] = [run_id];
      if (status) {
        query += ' AND rt.status = ?';
        params.push(status.toUpperCase());
      }
      if (category) {
        query += ' AND bt.category = ?';
        params.push(category);
      }
      query += ' ORDER BY rt.task_slug';

      const rows = await db.prepare(query).all(...params) as any[];
      const tasks = rows.map((t: any) => {
        let desc = '';
        if (t.raw_result) {
          try {
            const rawTask = typeof t.raw_result === 'string' ? JSON.parse(t.raw_result) : t.raw_result;
            desc = rawTask?.description || '';
          } catch (_) {}
        }
        if (!desc && t.task_title) {
          desc = t.task_title;
        }

        return {
          id: t.id,
          run_id: t.run_id,
          status: t.status,
          score: t.score,
          task_id: t.benchmark_task_id,
          slug: t.task_slug || `task-${t.benchmark_task_id}`,
          category: t.category,
          difficulty: t.difficulty,
          description: desc,
          diagnosis_text: t.diagnosis_text,
          taxonomy_label: t.taxonomy_label
        };
      });

      return NextResponse.json({ tasks });
    } catch (dbErr: any) {
      console.error('Direct SQLite task list query failed, falling back to HTTP:', dbErr);
      let url = `${BACKEND}/runs/${run_id}/tasks`;
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
    }
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
