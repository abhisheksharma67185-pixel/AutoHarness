'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import {
  TrendingUp,
  AlertTriangle,
  PlayCircle,
  FileCheck2,
  ChevronRight,
  Sparkles,
  ArrowUpRight,
  Loader2
} from 'lucide-react';

interface Run {
  run_id: string;
  run_label: string;
  global_score: number;
  benchmark: string;
  agent: string;
  harness_version?: string;
  created_at?: string;
}

interface FailureMode {
  id: string;
  title: string;
  taxonomy_label: string;
  failure_count: number;
}

interface EvalSuite {
  id: string;
  name: string;
  case_count: number;
}

export default function OverviewPage() {
  const [runs, setRuns] = useState<Run[]>([]);
  const [topFailures, setTopFailures] = useState<FailureMode[]>([]);
  const [evalSuites, setEvalSuites] = useState<EvalSuite[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchAll() {
      try {
        const [runsRes, fmRes, evalsRes] = await Promise.all([
          fetch('/api/runs', { cache: 'no-store' }),
          fetch('/api/failures/modes', { cache: 'no-store' }),
          fetch('/api/evals', { cache: 'no-store' }),
        ]);

        const runsData = await runsRes.json();
        const fmData = await fmRes.json().catch(() => ({ failureModes: [] }));
        const evalsData = await evalsRes.json().catch(() => ({ evalSuites: [] }));

        const fetchedRuns: Run[] = runsData.runs || [];
        // Sort by created_at asc for chart
        const sortedRuns = [...fetchedRuns].sort((a, b) =>
          new Date(a.created_at || 0).getTime() - new Date(b.created_at || 0).getTime()
        );
        setRuns(sortedRuns);

        const modes: FailureMode[] = (fmData.failureModes || [])
          .sort((a: any, b: any) => (b.failure_count || 0) - (a.failure_count || 0))
          .slice(0, 4);
        setTopFailures(modes);

        setEvalSuites(evalsData.evalSuites || []);
      } catch (err) {
        console.error('Dashboard fetch error:', err);
      } finally {
        setLoading(false);
      }
    }
    fetchAll();
  }, []);

  const latestRun = runs[runs.length - 1];
  const globalPassRate = latestRun ? (latestRun.global_score * 100).toFixed(0) : '0';
  const totalEvalCases = evalSuites.reduce((sum, s) => sum + (s.case_count || 0), 0);

  // Chart data
  const chartWidth = 500;
  const chartHeight = 160;
  const padding = 20;
  let chartPoints = '';
  let chartGlowPoints = '';
  const circles: Array<{ x: number; y: number; score: string; version: string }> = [];

  if (runs.length > 0) {
    const usableWidth = chartWidth - padding * 2;
    const usableHeight = chartHeight - padding * 2;

    runs.forEach((run, index) => {
      const x = padding + (runs.length > 1 ? (index / (runs.length - 1)) * usableWidth : usableWidth / 2);
      const y = padding + (usableHeight - run.global_score * usableHeight);

      if (index === 0) {
        chartPoints += `M ${x} ${y}`;
        chartGlowPoints += `M ${x} ${chartHeight - padding} L ${x} ${y}`;
      } else {
        chartPoints += ` L ${x} ${y}`;
        chartGlowPoints += ` L ${x} ${y}`;
      }

      if (index === runs.length - 1) {
        chartGlowPoints += ` L ${x} ${chartHeight - padding} Z`;
      }

      circles.push({
        x,
        y,
        score: `${(run.global_score * 100).toFixed(0)}%`,
        version: run.harness_version || run.run_id?.slice(0, 8) || ''
      });
    });

    if (runs.length === 1 && circles[0]) {
      const point = circles[0];
      chartPoints = `M ${point.x - 16} ${point.y} L ${point.x + 16} ${point.y}`;
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="flex items-center gap-2 text-gray-500 text-sm">
          <Loader2 size={18} className="animate-spin" />
          Loading dashboard...
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-8 relative">
      {/* Welcome Hero Banner */}
      <div className="glass-panel p-8 relative overflow-hidden bg-gradient-to-r from-purple-900/10 to-indigo-900/10">
        <div className="absolute top-0 right-0 w-64 h-64 bg-purple-500/5 blur-3xl rounded-full pointer-events-none" />
        <div className="flex items-center gap-2 text-purple-400 text-xs font-semibold uppercase tracking-wider mb-2">
          <Sparkles size={14} className="animate-pulse" />
          Agentic Experiment IDE
        </div>
        <h2 className="text-3xl font-bold tracking-tight text-white mb-2">
          AutoHarness <span className="text-gradient-purple">Studio</span>
        </h2>
        <p className="text-gray-400 max-w-xl text-sm leading-relaxed">
          Observe and optimize agent runs on Terminal-Bench 2.0. Group execution traces into clustered failure modes, extract test suites, and deploy regression-gated harness variants.
        </p>
      </div>

      {/* KPI Cards Grid */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
        <div className="glass-panel p-6">
          <span className="text-gray-500 text-xs font-bold uppercase tracking-wider block mb-1">
            Global Pass Rate
          </span>
          <div className="flex items-baseline gap-2">
            <span className="text-4xl font-extrabold text-white">{globalPassRate}%</span>
            {runs.length > 1 && (
              <span className="text-xs font-semibold text-emerald-400 flex items-center gap-0.5">
                <TrendingUp size={12} />
                +{((runs[runs.length - 1].global_score - runs[0].global_score) * 100).toFixed(0)}%
              </span>
            )}
          </div>
          <span className="text-[11px] text-gray-500 font-medium mt-1 block">
            Latest: {latestRun?.run_id?.slice(0, 16) || 'No runs'}{latestRun?.run_id?.length > 16 ? '…' : ''}
          </span>
        </div>

        <div className="glass-panel p-6">
          <span className="text-gray-500 text-xs font-bold uppercase tracking-wider block mb-1">
            Ingested Runs
          </span>
          <div className="flex items-baseline gap-2">
            <span className="text-4xl font-extrabold text-white">{runs.length}</span>
            <span className="text-xs text-gray-500 font-semibold">versions</span>
          </div>
          <span className="text-[11px] text-gray-500 font-medium mt-1 block">
            Agent: {latestRun?.agent || 'None'}
          </span>
        </div>

        <div className="glass-panel p-6">
          <span className="text-gray-500 text-xs font-bold uppercase tracking-wider block mb-1">
            Failure Clusters
          </span>
          <div className="flex items-baseline gap-2">
            <span className="text-4xl font-extrabold text-amber-500">{topFailures.length}</span>
            <span className="text-xs text-gray-500 font-semibold">modes</span>
          </div>
          <span className="text-[11px] text-gray-500 font-medium mt-1 block">
            Active in latest harness version
          </span>
        </div>

        <div className="glass-panel p-6">
          <span className="text-gray-500 text-xs font-bold uppercase tracking-wider block mb-1">
            Eval Test Cases
          </span>
          <div className="flex items-baseline gap-2">
            <span className="text-4xl font-extrabold text-purple-400">{totalEvalCases}</span>
            <span className="text-xs text-gray-500 font-semibold">promoted</span>
          </div>
          <span className="text-[11px] text-gray-500 font-medium mt-1 block">
            Across {evalSuites.length} suites
          </span>
        </div>
      </div>

      {/* Charts & Failures Split Section */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        
        {/* Iteration Progression Chart */}
        <div className="glass-panel p-6 lg:col-span-2 flex flex-col justify-between">
          <div>
            <h3 className="text-base font-bold text-white mb-1">Harness Iteration Progression</h3>
            <p className="text-xs text-gray-500 mb-6">
              Benchmark pass rates tracked across successive auto-harness configurations.
            </p>
          </div>

          <div className="relative w-full flex items-center justify-center bg-black/30 rounded-xl p-4 border border-[rgba(255,255,255,0.02)] min-h-[200px]">
            {runs.length === 0 ? (
              <div className="text-center py-10">
                <PlayCircle size={32} className="text-gray-600 mx-auto mb-2" />
                <p className="text-sm text-gray-400">No runs ingested yet.</p>
                <Link href="/runs" className="text-xs text-purple-400 underline mt-1 inline-block">
                  Upload first run logs
                </Link>
              </div>
            ) : (
              <svg viewBox={`0 0 ${chartWidth} ${chartHeight}`} className="w-full h-auto overflow-visible">
                {/* Grid Lines */}
                <line x1={padding} y1={padding} x2={chartWidth - padding} y2={padding} stroke="rgba(255,255,255,0.14)" strokeWidth={1} />
                <line x1={padding} y1={chartHeight / 2} x2={chartWidth - padding} y2={chartHeight / 2} stroke="rgba(255,255,255,0.14)" strokeWidth={1} />
                <line x1={padding} y1={chartHeight - padding} x2={chartWidth - padding} y2={chartHeight - padding} stroke="rgba(255,255,255,0.22)" strokeWidth={1} />

                {/* Shading Area Gradient */}
                <defs>
                  <linearGradient id="chartGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#ddd6fe" stopOpacity="0.35" />
                    <stop offset="100%" stopColor="#8b5cf6" stopOpacity="0.05" />
                  </linearGradient>
                </defs>

                {runs.length >= 1 && (
                  <>
                    <path d={chartGlowPoints} fill="url(#chartGradient)" />
                    <path d={chartPoints} fill="none" stroke="#c084fc" strokeWidth={3} strokeLinecap="round" />
                  </>
                )}

                {/* Interactive circles */}
                {circles.map((c, i) => (
                  <g key={i} className="group cursor-pointer">
                    <circle cx={c.x} cy={c.y} r={runs.length === 1 ? 8 : 6} fill="#f8fafc" stroke="#c084fc" strokeWidth={2}>
                      <title>{`${c.version} • ${c.score} Pass`}</title>
                    </circle>
                    <circle cx={c.x} cy={c.y} r={runs.length === 1 ? 18 : 12} fill="#7c3aed" fillOpacity={0} className="hover:fill-opacity-25 transition-all duration-200" />
                    
                    {/* Tooltip */}
                    <g className="opacity-0 group-hover:opacity-100 transition-opacity duration-200 pointer-events-none">
                      <rect x={c.x - 50} y={c.y - 52} width={100} height={40} rx={6} fill="#111827" stroke="rgba(255,255,255,0.22)" strokeWidth={1.25} />
                      <text x={c.x} y={c.y - 30} fill="#f8fafc" fontSize={10} fontWeight="bold" textAnchor="middle">{c.version}</text>
                      <text x={c.x} y={c.y - 16} fill="#c084fc" fontSize={10} fontWeight="bold" textAnchor="middle">{c.score} Pass</text>
                    </g>
                  </g>
                ))}
              </svg>
            )}
          </div>

          <div className="flex justify-between items-center mt-4 pt-4 border-t border-[rgba(255,255,255,0.04)]">
            <span className="text-xs text-gray-500 font-medium">Baseline: 0%</span>
            <span className="text-xs text-gray-500 font-medium">Target Cap: 100%</span>
          </div>
        </div>

        {/* Top Failure Modes List */}
        <div className="glass-panel p-6 flex flex-col justify-between">
          <div>
            <h3 className="text-base font-bold text-white mb-1">Top Failure Clusters</h3>
            <p className="text-xs text-gray-500 mb-6">
              Dominant failure modes across tasks in the latest benchmark.
            </p>
          </div>

          <div className="space-y-4 flex-1">
            {topFailures.length === 0 ? (
              <div className="text-center py-8">
                <FileCheck2 size={24} className="text-emerald-500/80 mx-auto mb-2" />
                <p className="text-xs text-gray-400">No failure modes identified yet.</p>
                <p className="text-[10px] text-gray-600 mt-1">Run failure diagnosis from the Tasks page.</p>
              </div>
            ) : (
              topFailures.map((fm) => {
                const targetUrl = latestRun
                  ? `/failures?run_id=${encodeURIComponent(latestRun.run_id)}&mode_id=${encodeURIComponent(fm.id)}`
                  : `/failures?mode_id=${encodeURIComponent(fm.id)}`;
                
                return (
                  <Link
                    key={fm.id}
                    href={targetUrl}
                    className="block p-3 bg-white/[0.02] border border-white/[0.04] rounded-lg hover:bg-white/[0.04] transition-colors"
                  >
                    <div className="flex justify-between items-start mb-1">
                      <span className="badge badge-fail text-[9px] uppercase tracking-wider">
                        {fm.taxonomy_label}
                      </span>
                      <span className="text-[10px] text-gray-500 font-bold">
                        {fm.failure_count} tasks
                      </span>
                    </div>
                    <h4 className="text-xs font-semibold text-white line-clamp-1">{fm.title}</h4>
                  </Link>
                );
              })
            )}
          </div>

          <Link href="/failures" className="mt-4 pt-3 border-t border-white/[0.04] flex items-center justify-between text-xs text-purple-400 hover:text-white transition-colors group">
            Analyze failure taxonomy
            <ChevronRight size={14} className="transform group-hover:translate-x-1 transition-transform" />
          </Link>
        </div>
      </div>

      {/* Bottom Segment: Evals and Info Links */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
        
        {/* Eval Suites Quick Summary */}
        <div className="glass-panel p-6">
          <h3 className="text-base font-bold text-white mb-1">Living Eval Suites</h3>
          <p className="text-xs text-gray-500 mb-4">
            Custom testing suites generated directly from run failure traces.
          </p>

          <div className="space-y-3">
            {evalSuites.length === 0 ? (
              <p className="text-xs text-gray-500">No evaluation suites defined yet.</p>
            ) : (
              evalSuites.slice(0, 5).map((s) => (
                <div key={s.id} className="flex justify-between items-center py-2 border-b border-white/[0.03] last:border-0">
                  <div>
                    <h4 className="text-xs font-semibold text-white">{s.name}</h4>
                    <span className="text-[10px] text-gray-500">{s.case_count} regression test cases</span>
                  </div>
                  <Link href={`/evals?suite_id=${s.id}`} className="text-gray-400 hover:text-white transition-colors">
                    <ArrowUpRight size={14} />
                  </Link>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Studio Info card */}
        <div className="glass-panel p-6 flex flex-col justify-between bg-gradient-to-br from-indigo-950/20 to-purple-950/20">
          <div>
            <h3 className="text-base font-bold text-white mb-2 flex items-center gap-2">
              <Sparkles size={16} className="text-purple-400" />
              Experiment Flow
            </h3>
            <ol className="space-y-2 text-xs text-gray-400 list-decimal pl-4 leading-relaxed">
              <li>Upload benchmark run logs from auto-harness inside the <strong className="text-gray-300">Runs View</strong>.</li>
              <li>Drill down into failed tasks and execution steps inside the <strong className="text-gray-300">Task Explorer</strong>.</li>
              <li>Run <strong className="text-gray-300">Diagnose Failures</strong> to get LLM-powered failure labels and clusters.</li>
              <li>Promote failures to evaluation test cases in <strong className="text-gray-300">Eval Suites</strong>.</li>
              <li>Design experiments and check <strong className="text-gray-300">Regression Gates</strong> for safe promotions.</li>
            </ol>
          </div>

          <div className="mt-4 flex gap-4">
            <Link href="/runs" className="flex-1 bg-purple-600 hover:bg-purple-700 text-white text-center py-2 px-4 rounded-lg text-xs font-semibold transition-colors">
              Manage Runs
            </Link>
            <Link href="/experiments" className="flex-1 bg-white/5 hover:bg-white/10 text-white text-center py-2 px-4 rounded-lg text-xs font-semibold border border-white/10 transition-colors">
              Design Experiment
            </Link>
          </div>
        </div>

      </div>

    </div>
  );
}
