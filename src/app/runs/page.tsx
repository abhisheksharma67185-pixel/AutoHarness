'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { Play, Calendar, Cpu, Layers, Trash2 } from 'lucide-react';
import RunUploader from '@/components/RunUploader';

interface Run {
  run_id: string;
  run_label: string;
  global_score: number;
  benchmark: string;
  agent: string;
  harness_version?: string;
  created_at?: string;
  metrics?: any;
}

export default function RunsPage() {
  const [runs, setRuns] = useState<Run[]>([]);
  const [loading, setLoading] = useState(true);
  const [deleting, setDeleting] = useState<string | null>(null);

  const fetchRuns = async () => {
    try {
      const res = await fetch('/api/runs', { cache: 'no-store' });
      const data = await res.json();
      setRuns(data.runs || []);
    } catch (err) {
      console.error('Failed to fetch runs:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchRuns();
  }, []);

  const handleDelete = async (runId: string) => {
    if (!confirm(`Delete run ${runId}?`)) return;
    setDeleting(runId);
    try {
      const res = await fetch(`/api/runs?run_id=${encodeURIComponent(runId)}`, { method: 'DELETE' });
      if (res.ok) {
        setRuns(prev => prev.filter(r => r.run_id !== runId));
      } else {
        alert('Failed to delete run.');
      }
    } catch (err) {
      console.error(err);
    } finally {
      setDeleting(null);
    }
  };

  return (
    <div className="space-y-8">
      {/* Header */}
      <div>
        <h2 className="text-2xl font-bold tracking-tight text-white mb-1">Ingested Benchmark Runs</h2>
        <p className="text-sm text-gray-500">
          Upload and review agent evaluation benchmarks and trace histories.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 items-start">
        {/* Runs Table List */}
        <div className="lg:col-span-2 glass-panel overflow-hidden">
          <div className="p-6 border-b border-white/[0.04]">
            <h3 className="text-sm font-bold text-white flex items-center gap-2">
              <Layers size={16} className="text-purple-400" />
              Run History ({loading ? '...' : runs.length})
            </h3>
          </div>

          <div className="overflow-x-auto">
            {loading ? (
              <div className="text-center py-16 text-gray-400">
                <p className="text-sm font-medium animate-pulse">Loading runs...</p>
              </div>
            ) : runs.length === 0 ? (
              <div className="text-center py-16 text-gray-400">
                <p className="text-sm font-medium">No runs found in database.</p>
                <p className="text-xs text-gray-600 mt-1">Upload a benchmark log using the control panel on the right.</p>
              </div>
            ) : (
              <table className="studio-table">
                <thead>
                  <tr>
                    <th>Run ID / Version</th>
                    <th>Benchmark / Agent</th>
                    <th>Pass Rate</th>
                    <th className="text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {runs.map((run) => {
                    const runId = run.run_id;
                    const passRate = (run.global_score || 0) * 100;
                    const scoreColorClass =
                      passRate >= 75
                        ? 'badge-success'
                        : passRate >= 50
                        ? 'badge-warning'
                        : 'badge-fail';

                    return (
                      <tr key={runId}>
                        <td>
                          <div className="font-semibold text-white text-xs truncate max-w-[180px]" title={runId}>{runId}</div>
                          <div className="text-[10px] text-gray-500 flex items-center gap-1 mt-0.5">
                            <Cpu size={10} />
                            {run.harness_version || 'N/A'}
                          </div>
                        </td>
                        <td>
                          <div className="text-xs text-gray-300 font-semibold">{run.benchmark}</div>
                          <div className="text-[10px] text-gray-500 mt-0.5">{run.agent}</div>
                        </td>
                        <td>
                          <span className={`badge ${scoreColorClass} text-[10px]`}>
                            {passRate.toFixed(0)}% Pass
                          </span>
                        </td>
                        <td>
                          <div className="flex items-center justify-end gap-2">
                            <Link
                              href={`/tasks?run_id=${encodeURIComponent(runId)}`}
                              className="flex items-center gap-1 px-2.5 py-1.5 bg-purple-600 text-white hover:bg-purple-600/70 rounded text-xs font-semibold transition-colors"
                              title="Explore task trajectories"
                            >
                              <Play size={10} fill="currentColor" />
                              Explore
                            </Link>
                            <button
                              onClick={() => handleDelete(runId)}
                              disabled={deleting === runId}
                              className="p-1.5 bg-red-100 text-red-600 border border-red-200 hover:opacity-60 rounded transition-all disabled:opacity-40"
                              title="Delete run"
                            >
                              <Trash2 size={12} />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </div>

        {/* Upload Control Sidebar */}
        <div className="space-y-6">
          <RunUploader onUploadSuccess={fetchRuns} />

          {/* Info Card */}
          <div className="glass-panel p-6 bg-gradient-to-br from-purple-950/10 to-indigo-950/10 border-purple-500/10">
            <h4 className="text-xs font-bold uppercase tracking-wider text-purple-400 mb-2 flex items-center gap-1.5">
              <Calendar size={12} />
              Ingestion Contract
            </h4>
            <p className="text-xs text-gray-400 leading-relaxed">
              Studio parses a standardized contract including a top-level <code className="text-purple-300/80">run_id</code>, <code className="text-purple-300/80">metadata</code>, and a list of <code className="text-purple-300/80">tasks</code>.
              Each task records a <code className="text-purple-300/80">status</code>, a numeric <code className="text-purple-300/80">score</code>, and a list of ordered <code className="text-purple-300/80">steps</code>.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
