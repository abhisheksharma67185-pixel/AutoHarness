'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import {
  TrendingUp,
  TrendingDown,
  Minus,
  Edit2,
  Check,
  X,
  Play,
  Bookmark,
  ChevronDown,
  AlertTriangle,
  FolderOpen,
  GraduationCap
} from 'lucide-react';
import { Run, FailureMode } from '@/lib/types';

interface FailureModesClientProps {
  initialRuns: Run[];
  selectedRunId: string;
  initialSelectedModeId?: string | number | null;
}

export default function FailureModesClient({
  initialRuns,
  selectedRunId,
  initialSelectedModeId
}: FailureModesClientProps) {
  const [runs] = useState<Run[]>(initialRuns);
  const [activeRunId, setActiveRunId] = useState(selectedRunId);
  const [failureModes, setFailureModes] = useState<any[]>([]);
  const [selectedModeId, setSelectedModeId] = useState<string | number | null>(initialSelectedModeId || null);

  // Edit Mode state
  const [isEditing, setIsEditing] = useState(false);
  const [editTitle, setEditTitle] = useState('');
  const [editDesc, setEditDesc] = useState('');
  const [editTaxonomy, setEditTaxonomy] = useState('');
  const [saving, setSaving] = useState(false);
  const [promoting, setPromoting] = useState(false);
  const [promoteMessage, setPromoteMessage] = useState('');

  const promoteToSuite = async () => {
    if (!activeMode) return;
    setPromoting(true);
    setPromoteMessage('Promoting failure mode to eval suite...');

    try {
      const res = await fetch('/api/evals', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'create_suite_from_failure_mode',
          name: `Eval Suite: ${activeMode.title}`,
          description: `Generated evaluation suite targeting the failure mode: ${activeMode.title} (${activeMode.description})`,
          failure_mode_id: String(activeMode.id),
          max_cases: 20
        })
      });

      const data = await res.json();
      if (res.ok) {
        setPromoteMessage('Suite promoted successfully!');
        setTimeout(() => {
          window.location.href = `/evals?suite_id=${data.suite_id}`;
        }, 1200);
      } else {
        setPromoteMessage(`Promotion failed: ${data.error || 'unknown error'}`);
      }
    } catch (err: any) {
      console.error(err);
      setPromoteMessage('Error during promotion.');
    } finally {
      setPromoting(false);
    }
  };

  // Fetch failure modes when run selection changes
  useEffect(() => {
    if (!activeRunId) return;

    async function fetchFailures() {
      try {
        const res = await fetch(`/api/failures?run_id=${encodeURIComponent(activeRunId)}`);
        const data = await res.json();
        if (data.failureModes) {
          setFailureModes(data.failureModes);
          if (data.failureModes.length > 0) {
            const hasInitial = initialSelectedModeId && data.failureModes.some((fm: any) => String(fm.id) === String(initialSelectedModeId));
            if (hasInitial) {
              setSelectedModeId(initialSelectedModeId);
            } else {
              setSelectedModeId(data.failureModes[0].id);
            }
          } else {
            setSelectedModeId(null);
          }
        }
      } catch (err) {
        console.error('Failed to fetch failure modes:', err);
      }
    }
    fetchFailures();
  }, [activeRunId, initialSelectedModeId]);

  const activeMode = failureModes.find(fm => fm.id === selectedModeId);

  // Enter edit mode
  const startEditing = () => {
    if (!activeMode) return;
    setEditTitle(activeMode.title);
    setEditDesc(activeMode.description);
    setEditTaxonomy(activeMode.taxonomy_label);
    setIsEditing(true);
  };

  // Save updated failure mode details
  const saveChanges = async () => {
    if (!activeMode) return;
    setSaving(true);

    try {
      const res = await fetch('/api/failures', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: activeMode.id,
          title: editTitle,
          description: editDesc,
          taxonomy_label: editTaxonomy
        })
      });

      if (res.ok) {
        // Update local state
        setFailureModes(prev => prev.map(fm => 
          fm.id === activeMode.id 
            ? { ...fm, title: editTitle, description: editDesc, taxonomy_label: editTaxonomy }
            : fm
        ));
        setIsEditing(false);
      } else {
        alert('Failed to save changes.');
      }
    } catch (err) {
      console.error(err);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header bar run selection */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 glass-panel p-4">
        <div className="flex items-center gap-3">
          <Bookmark className="text-purple-400" size={20} />
          <div>
            <span className="text-[10px] text-gray-500 font-bold uppercase tracking-wider block">Scope failure modes for run</span>
            <div className="relative inline-block mt-0.5">
              <select
                value={activeRunId}
                onChange={(e) => setActiveRunId(e.target.value)}
                className="bg-black/40 border border-white/10 rounded-md py-1 px-3 pr-8 text-xs font-semibold text-white focus:outline-none focus:border-purple-500 appearance-none cursor-pointer"
              >
                {runs.map(r => (
                  <option key={r.run_id} value={r.run_id}>
                    {r.run_id} ({r.benchmark})
                  </option>
                ))}
              </select>
              <ChevronDown size={12} className="absolute right-2.5 top-2.5 text-gray-400 pointer-events-none" />
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <span className="text-xs text-gray-500 font-medium">Clustered failure groups:</span>
          <span className="bg-amber-950/20 border border-amber-900/30 text-amber-400 font-mono text-xs px-2 py-0.5 rounded font-bold">
            {failureModes.length} clusters
          </span>
        </div>
      </div>

      {/* Main split dashboard pane */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
        
        {/* Left pane: list of failure modes */}
        <div className="glass-panel overflow-hidden flex flex-col h-[580px]">
          <div className="p-4 border-b border-white/[0.04] bg-black/10 shrink-0">
            <h3 className="text-xs font-bold text-white uppercase tracking-wider">Failure Mode Clusters</h3>
          </div>

          <div className="flex-1 overflow-y-auto divide-y divide-white/[0.02]">
            {failureModes.length === 0 ? (
              <div className="text-center py-12 text-gray-500 text-xs">
                No failure clusters identified for this run.
              </div>
            ) : (
              failureModes.map((fm) => {
                const isActive = fm.id === selectedModeId;
                
                return (
                  <div
                    key={fm.id}
                    onClick={() => {
                      setSelectedModeId(fm.id);
                      setIsEditing(false);
                    }}
                    className={`p-4 cursor-pointer hover:bg-white/[0.02] transition-colors relative ${
                      isActive ? 'bg-purple-900/10 border-l-2 border-purple-500' : ''
                    }`}
                  >
                    <div className="flex justify-between items-start gap-2 mb-1">
                      <span className="badge badge-fail text-[8px] uppercase tracking-wide font-bold scale-90">
                        {fm.taxonomy_label}
                      </span>
                      <span className="text-[10px] text-gray-500 font-bold shrink-0">
                        {fm.failure_count} tasks
                      </span>
                    </div>
                    <h4 className="text-xs font-semibold text-white line-clamp-1">{fm.title}</h4>
                    
                    <div className="flex items-center gap-4 mt-3">
                      <span className="text-[10px] text-gray-500 font-medium">
                        Avg Score: {fm.avg_score.toFixed(1)}
                      </span>

                      {/* Trend icons */}
                      <span className="text-[10px] text-gray-500 font-semibold flex items-center gap-0.5 ml-auto">
                        Trend:
                        {fm.trend === 'down' ? (
                          <span className="text-emerald-400 font-bold flex items-center gap-0.5" title="Failure rate improved">
                            <TrendingDown size={10} /> Improved
                          </span>
                        ) : fm.trend === 'up' ? (
                          <span className="text-rose-400 font-bold flex items-center gap-0.5" title="Failure rate regressed">
                            <TrendingUp size={10} /> Regressed
                          </span>
                        ) : (
                          <span className="text-gray-400 font-bold flex items-center gap-0.5" title="Failure rate stable">
                            <Minus size={10} /> Stable
                          </span>
                        )}
                      </span>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* Right pane: details & manual editor */}
        <div className="lg:col-span-2 space-y-6">
          {activeMode ? (
            <>
              {/* Detail Pane / Title description */}
              <div className="glass-panel p-6 space-y-4">
                <div className="flex items-start justify-between gap-4 pb-4 border-b border-white/[0.04]">
                  
                  {isEditing ? (
                    <div className="space-y-3 w-full">
                      <div>
                        <label className="text-[10px] text-gray-500 font-bold uppercase block mb-1">Cluster Title</label>
                        <input
                          type="text"
                          value={editTitle}
                          onChange={(e) => setEditTitle(e.target.value)}
                          className="w-full bg-black/40 border border-white/10 rounded px-3 py-1.5 text-xs text-white focus:outline-none focus:border-purple-500"
                        />
                      </div>

                      <div className="grid grid-cols-2 gap-4">
                        <div>
                          <label className="text-[10px] text-gray-500 font-bold uppercase block mb-1">Taxonomy Label</label>
                          <select
                            value={editTaxonomy}
                            onChange={(e) => setEditTaxonomy(e.target.value)}
                            className="w-full bg-black/40 border border-white/10 rounded px-2.5 py-1.5 text-xs text-gray-300 focus:outline-none focus:border-purple-500"
                          >
                            <option value="GAP">GAP</option>
                            <option value="AMBIGUITY">AMBIGUITY</option>
                            <option value="TOOL_MISUSE">TOOL_MISUSE</option>
                            <option value="CODE_BUG">CODE_BUG</option>
                            <option value="UPSTREAM">UPSTREAM</option>
                            <option value="SAFETY_VIOLATION">SAFETY_VIOLATION</option>
                          </select>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="badge badge-fail text-[9px] uppercase tracking-wider font-bold">
                          {activeMode.taxonomy_label}
                        </span>
                        <span className="text-[11px] text-gray-500 font-medium">
                          Cluster ID: fm-{activeMode.id}
                        </span>
                      </div>
                      <h3 className="text-lg font-bold text-white mt-1.5">{activeMode.title}</h3>
                      
                      <div className="flex items-center gap-3 mt-3">
                        <button
                          disabled={promoting}
                          onClick={promoteToSuite}
                          className="flex items-center gap-1.5 px-3 py-1.5 bg-purple-600 text-white rounded text-xs font-semibold hover:bg-purple-700 transition-colors shadow-sm disabled:opacity-50"
                        >
                          <GraduationCap size={13} /> Promote to Eval Suite
                        </button>
                        {promoteMessage && (
                          <span className={`text-[10px] font-semibold ${
                            promoteMessage.includes('successfully') ? 'text-emerald-400' : 'text-amber-400'
                          }`}>
                            {promoteMessage}
                          </span>
                        )}
                      </div>
                    </div>
                  )}

                  <div className="shrink-0 flex gap-2">
                    {isEditing ? (
                      <>
                        <button
                          disabled={saving}
                          onClick={saveChanges}
                          className="p-2 bg-emerald-600/20 text-emerald-400 border border-emerald-500/20 rounded hover:bg-emerald-600 hover:text-white transition-colors"
                          title="Save changes"
                        >
                          <Check size={14} />
                        </button>
                        <button
                          onClick={() => setIsEditing(false)}
                          className="p-2 bg-white/5 text-gray-400 border border-white/10 rounded hover:bg-white/10 hover:text-white transition-colors"
                          title="Cancel"
                        >
                          <X size={14} />
                        </button>
                      </>
                    ) : (
                      <button
                        onClick={startEditing}
                        className="p-2 bg-white/5 text-purple-400 border border-purple-500/10 rounded hover:bg-purple-600 hover:text-white transition-colors"
                        title="Edit cluster metadata"
                      >
                        <Edit2 size={14} />
                      </button>
                    )}
                  </div>
                </div>

                {/* Description */}
                <div>
                  <h4 className="text-[10px] text-gray-500 font-bold uppercase tracking-wider mb-1">Cluster Description</h4>
                  {isEditing ? (
                    <textarea
                      value={editDesc}
                      onChange={(e) => setEditDesc(e.target.value)}
                      rows={3}
                      className="w-full bg-black/40 border border-white/10 rounded p-3 text-xs text-white focus:outline-none focus:border-purple-500"
                    />
                  ) : (
                    <p className="text-xs text-gray-300 leading-relaxed bg-black/20 p-3 rounded border border-white/[0.02]">
                      {activeMode.description}
                    </p>
                  )}
                </div>
              </div>

              {/* Cluster Members List */}
              <div className="glass-panel overflow-hidden">
                <div className="p-4 border-b border-white/[0.04] bg-black/10 flex items-center justify-between">
                  <h3 className="text-xs font-bold text-white flex items-center gap-2">
                    <FolderOpen size={14} className="text-purple-400" />
                    Member Task Failures ({activeMode.members?.length || 0})
                  </h3>
                </div>

                <div className="divide-y divide-white/[0.02] max-h-[350px] overflow-y-auto">
                  {(!activeMode.members || activeMode.members.length === 0) ? (
                    <div className="text-center py-10 text-gray-500 font-mono text-xs">
                      No tasks grouped in this cluster.
                    </div>
                  ) : (
                    activeMode.members.map((member: any) => (
                      <div key={member.id} className="p-4 flex flex-col md:flex-row md:items-center justify-between gap-4 hover:bg-white/[0.01] transition-colors">
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="font-mono text-[9px] text-gray-500 font-bold">{member.task_id}</span>
                            <span className="text-xs font-bold text-white">{member.slug}</span>
                            <span className="text-[9px] text-gray-500 font-semibold">• {member.category}</span>
                          </div>
                          <p className="text-xs text-gray-400 mt-1 line-clamp-2">
                            <span className="text-rose-400/90 font-medium">Diagnosis:</span> {member.diagnosis_text}
                          </p>
                        </div>

                        <div className="shrink-0 flex items-center gap-2">
                          <Link
                            href={`/tasks?run_id=${encodeURIComponent(activeRunId)}&run_task_id=${encodeURIComponent(member.id)}`}
                            className="flex items-center gap-1 px-2.5 py-1.5 bg-purple-600/20 text-purple-400 hover:bg-purple-600 hover:text-white rounded text-[10px] font-semibold transition-colors"
                          >
                            <Play size={8} fill="currentColor" />
                            Trace
                          </Link>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </>
          ) : (
            <div className="glass-panel p-16 text-center text-gray-500">
              Select a failure cluster mode from the list left pane to view descriptive summaries, stats, and member tasks.
            </div>
          )}
        </div>

      </div>
    </div>
  );
}
