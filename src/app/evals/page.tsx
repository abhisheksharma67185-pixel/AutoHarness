'use client';

import { useState, useEffect } from 'react';
import EvalSuitesClient from '@/components/EvalSuitesClient';
import { EvalSuite } from '@/lib/types';

export default function EvalSuitesPage() {
  const [suites, setSuites] = useState<EvalSuite[]>([]);
  const [activeSuiteId, setActiveSuiteId] = useState<string>('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchSuites() {
      try {
        const res = await fetch('/api/evals');
        const data = await res.json();
        const fetchedSuites: EvalSuite[] = data.evalSuites || [];
        setSuites(fetchedSuites);
        if (fetchedSuites.length > 0 && fetchedSuites[0].id !== undefined) {
          setActiveSuiteId(String(fetchedSuites[0].id));
        }
      } catch (err) {
        console.error('Failed to fetch eval suites:', err);
      } finally {
        setLoading(false);
      }
    }
    fetchSuites();
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-gray-500 text-sm animate-pulse">Loading eval suites...</div>
      </div>
    );
  }

  return (
    <EvalSuitesClient
      initialSuites={suites}
      selectedSuiteId={activeSuiteId}
    />
  );
}
