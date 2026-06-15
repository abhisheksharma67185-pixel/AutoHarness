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

    if (!run_id) {
      return NextResponse.json({ error: 'Missing run_id' }, { status: 400 });
    }

    try {
      // 1. Find distinct failure modes that have member failure labels in this run_id
      const queryModes = `
        SELECT DISTINCT fm.id, fm.name, fm.description, fm.taxonomy_primary
        FROM failure_modes fm
        JOIN failure_mode_members fmm ON fm.id = fmm.failure_mode_id
        JOIN failure_labels fl ON fmm.failure_label_id = fl.id
        WHERE fl.run_id = ?
      `;
      const modes = db.prepare(queryModes).all(run_id) as any[];

      // Group by name (trimmed)
      const groupedModes: Record<string, any[]> = {};
      for (const fm of modes) {
        const name = (fm.name || '').trim();
        if (!groupedModes[name]) {
          groupedModes[name] = [];
        }
        groupedModes[name].push(fm);
      }

      const sortedNames = Object.keys(groupedModes).sort();
      const enrichedModes: any[] = [];

      for (const name of sortedNames) {
        const fmList = groupedModes[name];
        const primaryFm = fmList[0];

        // Fetch associated failure labels for all modes in this group for this run_id
        const fmIds = fmList.map(f => f.id);
        const placeholders = fmIds.map(() => '?').join(',');
        const membersLabels = db.prepare(`
          SELECT fl.*
          FROM failure_labels fl
          JOIN failure_mode_members fmm ON fl.id = fmm.failure_label_id
          WHERE fmm.failure_mode_id IN (${placeholders}) AND fl.run_id = ?
        `).all(...fmIds, run_id) as any[];

        // Deduplicate labels by ID
        const uniqueLabelsMap: Record<number, any> = {};
        for (const fl of membersLabels) {
          uniqueLabelsMap[fl.id] = fl;
        }
        const uniqueMembersLabels = Object.values(uniqueLabelsMap);

        const members: any[] = [];
        const scores: number[] = [];

        for (const fl of uniqueMembersLabels) {
          const rt = db.prepare(`
            SELECT rt.*, bt.task_id as benchmark_task_id, bt.title as task_title, bt.category, bt.difficulty
            FROM run_tasks rt
            JOIN benchmark_tasks bt ON rt.benchmark_task_id = bt.id
            WHERE rt.id = ?
          `).get(fl.run_task_id) as any;

          if (rt) {
            let desc = '';
            if (rt.raw_result) {
              try {
                const rawTask = typeof rt.raw_result === 'string' ? JSON.parse(rt.raw_result) : rt.raw_result;
                desc = rawTask?.description || '';
              } catch (_) {}
            }
            if (!desc && rt.task_title) {
              desc = rt.task_title;
            }

            members.push({
              id: rt.id,
              status: rt.status,
              score: rt.score,
              task_id: rt.benchmark_task_id,
              slug: rt.task_slug || `task-${rt.benchmark_task_id}`,
              category: rt.category,
              difficulty: rt.difficulty,
              description: desc,
              diagnosis_text: fl.diagnosis_text,
              taxonomy_label: (fl.taxonomy_primary || 'OTHER').toUpperCase()
            });
            scores.push(rt.score);
          }
        }

        // Sort members by task_id and slug
        members.sort((a, b) => {
          if (a.task_id !== b.task_id) return String(a.task_id).localeCompare(String(b.task_id));
          return String(a.slug).localeCompare(String(b.slug));
        });

        const count = members.length;
        const avgScore = count > 0 ? scores.reduce((sum, s) => sum + s, 0) / count : 0.0;

        enrichedModes.push({
          id: primaryFm.id,
          benchmark_slug: 'terminal-bench@2.0',
          name: name,
          title: name,
          description: primaryFm.description,
          taxonomy_primary: primaryFm.taxonomy_primary,
          taxonomy_label: (primaryFm.taxonomy_primary || 'other').toUpperCase(),
          severity: 'medium',
          failure_count: count,
          avg_score: avgScore,
          trend: 'stable',
          members: members
        });
      }

      return NextResponse.json({ failureModes: enrichedModes });
    } catch (dbErr: any) {
      console.error('Direct SQLite query for failures failed, falling back to HTTP:', dbErr);
      const response = await fetch(`${BACKEND}/runs/failure-modes?run_id=${encodeURIComponent(run_id)}`, { cache: 'no-store' });
      const data = await response.json();

      if (!response.ok) {
        return NextResponse.json({ error: data.detail || 'Failed to fetch failure modes' }, { status: response.status });
      }

      return NextResponse.json(data);
    }
  } catch (err: any) {
    console.error('Fetch failures error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const response = await fetch(`${BACKEND}/runs/failure-modes/update`, {
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
