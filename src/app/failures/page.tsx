'use client';

import { useState, useEffect, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import FailureModesClient from '@/components/FailureModesClient';
import { Loader2 } from 'lucide-react';

interface Run {
  run_id: string;
  run_label: string;
  global_score: number;
  benchmark: string;
  agent: string;
}

function FailureModesLoader() {
  const searchParams = useSearchParams();
  const urlRunId = searchParams.get('run_id') || '';
  const urlModeId = searchParams.get('mode_id') || searchParams.get('id') || '';

  const [runs, setRuns] = useState<Run[]>([]);
  const [activeRunId, setActiveRunId] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchRuns() {
      try {
        const res = await fetch('/api/runs', { cache: 'no-store' });
        const data = await res.json();
        const fetchedRuns: Run[] = data.runs || [];
        setRuns(fetchedRuns);
        
        if (urlRunId) {
          setActiveRunId(urlRunId);
        } else if (fetchedRuns.length > 0) {
          // Default to the run with the most failures (lowest global score)
          // so the Failure Modes view is populated by default
          const sorted = [...fetchedRuns].sort((a, b) => (a.global_score ?? 1) - (b.global_score ?? 1));
          setActiveRunId(sorted[0].run_id);
        }
      } catch (err) {
        console.error('Failed to fetch runs:', err);
      } finally {
        setLoading(false);
      }
    }
    fetchRuns();
  }, [urlRunId]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="flex items-center gap-2 text-gray-500 text-sm">
          <Loader2 size={18} className="animate-spin" />
          Loading failure modes...
        </div>
      </div>
    );
  }

  return (
    <FailureModesClient
      initialRuns={runs as any}
      selectedRunId={activeRunId}
      initialSelectedModeId={urlModeId}
    />
  );
}

export default function FailureModesPage() {
  return (
    <Suspense fallback={
      <div className="flex items-center justify-center h-64">
        <div className="flex items-center gap-2 text-gray-500 text-sm">
          <Loader2 size={18} className="animate-spin" />
          Loading...
        </div>
      </div>
    }>
      <FailureModesLoader />
    </Suspense>
  );
}
