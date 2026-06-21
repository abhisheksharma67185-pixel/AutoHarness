'use client';

import { useState, useEffect, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import TaskExplorerClient from '@/components/TaskExplorerClient';
import { Loader2 } from 'lucide-react';

interface Run {
  run_id: string;
  run_label: string;
  global_score: number;
  benchmark: string;
  agent: string;
}

interface EvalSuite {
  id: string | number;
  name: string;
  description?: string;
}

function TaskExplorerLoader() {
  const searchParams = useSearchParams();
  const urlRunId = searchParams.get('run_id') || '';

  const [runs, setRuns] = useState<Run[]>([]);
  const [suites, setSuites] = useState<EvalSuite[]>([]);
  const [activeRunId, setActiveRunId] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchAll() {
      try {
        const [runsRes, evalsRes] = await Promise.all([
          fetch('/api/runs', { cache: 'no-store' }),
          fetch('/api/evals', { cache: 'no-store' }),
        ]);

        const runsData = await runsRes.json();
        const evalsData = await evalsRes.json().catch(() => ({ evalSuites: [] }));

        const fetchedRuns: Run[] = runsData.runs || [];
        setRuns(fetchedRuns);
        setSuites(evalsData.evalSuites || []);

        // Determine active run: URL param > first available
        if (urlRunId) {
          setActiveRunId(urlRunId);
        } else if (fetchedRuns.length > 0) {
          setActiveRunId(fetchedRuns[0].run_id);
        }
      } catch (err) {
        console.error('Failed to fetch task explorer data:', err);
      } finally {
        setLoading(false);
      }
    }
    fetchAll();
  }, [urlRunId]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="flex items-center gap-2 text-gray-500 text-sm">
          <Loader2 size={18} className="animate-spin" />
          Loading task explorer...
        </div>
      </div>
    );
  }

  return (
    <TaskExplorerClient
      initialRuns={runs as any}
      initialSuites={suites as any}
      selectedRunId={activeRunId}
    />
  );
}

export default function TaskExplorerPage() {
  return (
    <Suspense fallback={
      <div className="flex items-center justify-center h-64">
        <div className="flex items-center gap-2 text-gray-500 text-sm">
          <Loader2 size={18} className="animate-spin" />
          Loading...
        </div>
      </div>
    }>
      <TaskExplorerLoader />
    </Suspense>
  );
}
