'use client';

import { useState, useEffect } from 'react';
import ExperimentsClient from '@/components/ExperimentsClient';
import { Experiment, Run, FailureMode } from '@/lib/types';

export default function ExperimentsPage() {
  const [experiments, setExperiments] = useState<Experiment[]>([]);
  const [runs, setRuns] = useState<Run[]>([]);
  const [failureModes, setFailureModes] = useState<FailureMode[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchAll() {
      try {
        const [expRes, runsRes, fmRes] = await Promise.all([
          fetch('/api/experiments', { cache: 'no-store' }),
          fetch('/api/runs', { cache: 'no-store' }),
          fetch('/api/failures/modes', { cache: 'no-store' }),
        ]);

        const expData = await expRes.json();
        const runsData = await runsRes.json();
        const fmData = await fmRes.json().catch(() => ({ failureModes: [] }));

        const parsedExperiments = (expData.experiments || []).map((e: any) => ({
          ...e,
          target_modes: Array.isArray(e.targets) ? e.targets : (e.target_modes || []),
          regression_policy: e.regression_policy || {},
        }));

        setExperiments(parsedExperiments);
        setRuns(runsData.runs || []);
        setFailureModes(fmData.failureModes || []);
      } catch (err) {
        console.error('Failed to fetch experiments data:', err);
      } finally {
        setLoading(false);
      }
    }
    fetchAll();
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-gray-500 text-sm animate-pulse">Loading experiments...</div>
      </div>
    );
  }

  return (
    <ExperimentsClient
      initialExperiments={experiments}
      initialRuns={runs}
      initialFailureModes={failureModes}
    />
  );
}
