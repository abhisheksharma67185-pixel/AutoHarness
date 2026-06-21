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

    if (!run_id) {
      return NextResponse.json({ error: 'Missing run_id' }, { status: 400 });
    }

    // Fetch failure modes associated with this run through the chain:
    // failure_modes -> failure_mode_members -> failure_labels -> run_tasks (filtered by run_id)
    const { data: modeRows, error: modesError } = await supabaseServer
      .from('failure_mode_members')
      .select(`
        failure_mode_id,
        failure_modes!inner (
          id,
          name,
          description,
          taxonomy_primary
        ),
        failure_labels!inner (
          id,
          diagnosis_text,
          taxonomy_primary,
          run_task_id,
          run_tasks!inner (
            id,
            run_id,
            status,
            score,
            raw_result,
            benchmark_task_id,
            benchmark_tasks!inner (
              task_id,
              title,
              category,
              difficulty
            )
          )
        )
      `)
      .eq('failure_labels.run_tasks.run_id', run_id);

    if (modesError) {
      throw modesError;
    }

    // Group by failure mode name
    const groupedModes: Record<string, { fm: any; members: any[] }> = {};

    for (const row of (modeRows || [])) {
      const fm = row.failure_modes as any;
      const fl = row.failure_labels as any;
      const rt = fl?.run_tasks as any;
      const bt = rt?.benchmark_tasks as any;

      if (!fm || !fl || !rt || !bt) continue;

      const name = (fm.name || '').trim();
      if (!groupedModes[name]) {
        groupedModes[name] = { fm, members: [] };
      }

      let desc = '';
      if (rt.raw_result) {
        try {
          const rawTask = typeof rt.raw_result === 'string' ? JSON.parse(rt.raw_result) : rt.raw_result;
          desc = rawTask?.description || '';
        } catch (_) {}
      }
      if (!desc && bt.title) {
        desc = bt.title;
      }

      // Deduplicate by run_task id
      const exists = groupedModes[name].members.some(m => m.id === rt.id);
      if (!exists) {
        groupedModes[name].members.push({
          id: rt.id,
          status: rt.status,
          score: rt.score,
          task_id: bt.task_id,
          slug: bt.title || `task-${bt.task_id}`,
          category: bt.category,
          difficulty: bt.difficulty,
          description: desc,
          diagnosis_text: fl.diagnosis_text,
          taxonomy_label: (fl.taxonomy_primary || 'OTHER').toUpperCase()
        });
      }
    }

    const sortedNames = Object.keys(groupedModes).sort();
    const enrichedModes: any[] = [];

    for (const name of sortedNames) {
      const { fm, members } = groupedModes[name];

      // Sort members by task_id and slug
      members.sort((a, b) => {
        if (a.task_id !== b.task_id) return String(a.task_id).localeCompare(String(b.task_id));
        return String(a.slug).localeCompare(String(b.slug));
      });

      const count = members.length;
      const scores = members.map(m => m.score);
      const avgScore = count > 0 ? scores.reduce((sum, s) => sum + s, 0) / count : 0.0;

      enrichedModes.push({
        id: fm.id,
        benchmark_slug: 'terminal-bench@2.0',
        name: name,
        title: name,
        description: fm.description,
        taxonomy_primary: fm.taxonomy_primary,
        taxonomy_label: (fm.taxonomy_primary || 'other').toUpperCase(),
        severity: 'medium',
        failure_count: count,
        avg_score: avgScore,
        trend: 'stable',
        members: members
      });
    }

    return NextResponse.json({ failureModes: enrichedModes });
  } catch (err: any) {
    console.error('Fetch failures error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const host = req.headers.get('host') || process.env.VERCEL_URL || 'localhost:3000';
    const backendUrl = host.includes('localhost') || host.includes('127.0.0.1')
      ? 'http://localhost:8001/api/v1'
      : `https://${host}/_/backend/api/v1`;

    const body = await req.json();
    const response = await fetch(`${backendUrl}/runs/failure-modes/update`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    const data = await response.json();

    if (!response.ok) {
      return NextResponse.json({ error: data.detail || 'Failed to update failure mode' }, { status: response.status });
    }

    return NextResponse.json(data);
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export { POST as PUT };
