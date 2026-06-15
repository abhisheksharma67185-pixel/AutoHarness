'use client';

import { useState, useEffect, useRef } from 'react';
import {
  Search,
  GraduationCap,
  ChevronDown,
  Terminal,
  Bookmark,
  Check,
  AlertCircle,
  Zap,
  Loader2,
  GitBranch,
  X
} from 'lucide-react';
import { Run, RunTask, TraceStep, EvalSuite } from '@/lib/types';

interface TaskExplorerClientProps {
  initialRuns: Run[];
  initialSuites: EvalSuite[];
  selectedRunId: string;
}

export default function TaskExplorerClient({
  initialRuns,
  initialSuites,
  selectedRunId
}: TaskExplorerClientProps) {
  const [runs] = useState<Run[]>(initialRuns);
  const [suites] = useState<EvalSuite[]>(initialSuites);
  const [activeRunId, setActiveRunId] = useState(selectedRunId);
  const [tasks, setTasks] = useState<RunTask[]>([]);
  const [activeTaskId, setActiveTaskId] = useState<string | null>(null);
  const [activeTask, setActiveTask] = useState<RunTask | null>(null);
  const [activeSteps, setActiveSteps] = useState<TraceStep[]>([]);
  
  // Filters
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'PASS' | 'FAIL'>('ALL');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [difficultyFilter, setDifficultyFilter] = useState('');

  // Search Focus & Shortcut state
  const [isFocused, setIsFocused] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const isInputFocused = document.activeElement?.tagName === 'INPUT' || 
                             document.activeElement?.tagName === 'TEXTAREA' || 
                             document.activeElement?.hasAttribute('contenteditable');
                             
      if (
        ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') ||
        (e.key === '/' && !isInputFocused)
      ) {
        e.preventDefault();
        searchInputRef.current?.focus();
        searchInputRef.current?.select();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // Interactive Operations
  const [updatingTaxonomy, setUpdatingTaxonomy] = useState(false);
  const [promotingSuiteId, setPromotingSuiteId] = useState<string>('');
  const [promotionMessage, setPromotionMessage] = useState('');

  // Job actions: Diagnose & Cluster
  const [diagnoseStatus, setDiagnoseStatus] = useState<'idle' | 'running' | 'done' | 'error'>('idle');
  const [clusterStatus, setClusterStatus] = useState<'idle' | 'running' | 'done' | 'error'>('idle');
  const [jobMessage, setJobMessage] = useState('');
  const [isDiagnoseHover, setDiagnoseHover] = useState(false);
  const [isClusterHover, setClusterHover] = useState(false);

  // Fetch tasks when run changes
  useEffect(() => {
    if (!activeRunId) return;
    
    async function fetchTasks() {
      try {
        const res = await fetch(`/api/tasks?run_id=${encodeURIComponent(activeRunId)}`);
        const data = await res.json();
        if (data.tasks) {
          setTasks(data.tasks);
          // Auto-select first task if available
          if (data.tasks.length > 0) {
            setActiveTaskId(String(data.tasks[0].id));
          } else {
            setActiveTaskId(null);
            setActiveTask(null);
            setActiveSteps([]);
          }
        }
      } catch (err) {
        console.error('Failed to fetch tasks:', err);
      }
    }
    fetchTasks();
  }, [activeRunId]);

  // Fetch task steps & failure metadata when active task changes
  useEffect(() => {
    if (!activeTaskId) return;
    const taskId = activeTaskId;
    
    async function fetchTaskDetail() {
      try {
        const res = await fetch(`/api/tasks?run_task_id=${encodeURIComponent(String(taskId))}`);
        const data = await res.json();
        if (data.task) {
          setActiveTask(data.task);
          setActiveSteps(data.steps || []);
          setPromotingSuiteId('');
          setPromotionMessage('');
        }
      } catch (err) {
        console.error('Failed to fetch task details:', err);
      }
    }
    fetchTaskDetail();
  }, [activeTaskId]);

  // Trigger diagnose-failures job on FastAPI
  const handleDiagnose = async () => {
    if (!activeRunId || diagnoseStatus === 'running') return;
    setDiagnoseStatus('running');
    setJobMessage('Diagnosing failures with LLM...');
    try {
      const res = await fetch('/api/jobs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'diagnose', run_id: activeRunId }),
      });
      let data;
      const text = await res.text();
      try {
        data = JSON.parse(text || '{}');
      } catch {
        data = { error: text || 'Failed to parse response from jobs API' };
      }
      if (res.ok) {
        setDiagnoseStatus('done');
        setJobMessage(`✓ Diagnosis job started (Job: ${data.job?.job_id || 'queued'}). Refresh tasks to see labels.`);
        // Refresh tasks after a short delay
        setTimeout(() => {
          setDiagnoseStatus('idle');
          setJobMessage('');
          // Re-trigger tasks fetch
          const fetchTasks = async () => {
            const r = await fetch(`/api/tasks?run_id=${encodeURIComponent(activeRunId)}`);
            const d = await r.json();
            if (d.tasks) setTasks(d.tasks);
          };
          fetchTasks();
        }, 4000);
      } else {
        setDiagnoseStatus('error');
        setJobMessage(data.error || 'Diagnosis job failed.');
        setTimeout(() => { setDiagnoseStatus('idle'); setJobMessage(''); }, 4000);
      }
    } catch (err: any) {
      setDiagnoseStatus('error');
      setJobMessage(err.message);
      setTimeout(() => { setDiagnoseStatus('idle'); setJobMessage(''); }, 4000);
    }
  };

  // Trigger cluster/recluster job on FastAPI
  const handleCluster = async () => {
    if (!activeRunId || clusterStatus === 'running') return;
    setClusterStatus('running');
    setJobMessage('Clustering failure modes...');
    try {
      const res = await fetch('/api/jobs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'cluster', run_id: activeRunId }),
      });
      let data;
      const text = await res.text();
      try {
        data = JSON.parse(text || '{}');
      } catch {
        data = { error: text || 'Failed to parse response from jobs API' };
      }
      if (res.ok) {
        setClusterStatus('done');
        setJobMessage(`✓ Clustering job started. Check Failure Modes page for results.`);
        setTimeout(() => { setClusterStatus('idle'); setJobMessage(''); }, 5000);
      } else {
        setClusterStatus('error');
        setJobMessage(data.error || 'Clustering failed.');
        setTimeout(() => { setClusterStatus('idle'); setJobMessage(''); }, 4000);
      }
    } catch (err: any) {
      setClusterStatus('error');
      setJobMessage(err.message);
      setTimeout(() => { setClusterStatus('idle'); setJobMessage(''); }, 4000);
    }
  };

  // Handle manual taxonomy override
  const handleTaxonomyOverride = async (taxonomy: string) => {
    if (!activeTask) return;
    setUpdatingTaxonomy(true);

    try {
      const res = await fetch('/api/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          run_task_id: activeTask.id,
          taxonomy_label: taxonomy
        })
      });

      if (res.ok) {
        // Update task state locally
        setActiveTask(prev => prev ? { ...prev, taxonomy_label: taxonomy } : null);
        setTasks(prev => prev.map(t => t.id === activeTask.id ? { ...t, taxonomy_label: taxonomy } : t));
      } else {
        alert('Failed to update taxonomy.');
      }
    } catch (err) {
      console.error(err);
    } finally {
      setUpdatingTaxonomy(false);
    }
  };

  // Promote failed task to an evaluation suite
  const handlePromoteToSuite = async (suiteId: string) => {
    if (!activeTask || !suiteId) return;
    setPromotionMessage('Promoting...');

    try {
      const res = await fetch('/api/evals', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'promote_failure',
          run_task_id: activeTask.id,
          eval_suite_id: suiteId
        })
      });
      
      const data = await res.json();

      if (res.ok) {
        setPromotionMessage('Promoted successfully!');
      } else {
        setPromotionMessage(`Failed: ${data.error || 'error'}`);
      }
    } catch (err) {
      console.error(err);
      setPromotionMessage('Error promoting task.');
    }
  };

  // Filter computations
  const uniqueCategories = Array.from(new Set(tasks.map(t => t.category || '')));
  
  const filteredTasks = tasks.filter(t => {
    const matchesSearch = (t.slug || '').toLowerCase().includes(search.toLowerCase()) || 
                          (t.description || '').toLowerCase().includes(search.toLowerCase()) ||
                          (t.task_id || '').toLowerCase().includes(search.toLowerCase());
    
    const matchesStatus = statusFilter === 'ALL' || t.status === statusFilter;
    const matchesCategory = !categoryFilter || t.category === categoryFilter;
    const matchesDifficulty = !difficultyFilter || t.difficulty === difficultyFilter;

    return matchesSearch && matchesStatus && matchesCategory && matchesDifficulty;
  });

  return (
    <div className="space-y-6">
      {/* Select Run Header bar */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 glass-panel p-4">
        <div className="flex items-center gap-3">
          <Bookmark className="text-purple-400" size={20} />
          <div>
            <span className="text-[10px] text-gray-500 font-bold uppercase tracking-wider block">Selected Ingestion Run</span>
            <div className="relative inline-block mt-0.5">
              <select
                value={activeRunId}
                onChange={(e) => setActiveRunId(e.target.value)}
                className="bg-black/40 border border-white/10 rounded-md py-1 px-3 pr-8 text-xs font-semibold text-white focus:outline-none focus:border-purple-500 appearance-none cursor-pointer"
              >
                {runs.map(r => (
                  <option key={r.run_id} value={r.run_id}>
                    {r.run_id} ({r.benchmark} / Score: {(r.global_score * 100).toFixed(0)}%)
                  </option>
                ))}
              </select>
              <ChevronDown size={12} className="absolute right-2.5 top-2.5 text-gray-400 pointer-events-none" />
            </div>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex items-center gap-2">
          {jobMessage && (
            <span className={`text-[10px] font-semibold px-2 py-1 rounded ${
              diagnoseStatus === 'error' || clusterStatus === 'error'
                ? 'text-rose-400 bg-rose-950/20'
                : 'text-emerald-400 bg-emerald-950/20'
            }`}>{jobMessage}</span>
          )}
          <button
            onClick={handleDiagnose}
            disabled={diagnoseStatus === 'running' || !activeRunId}
            title="Run LLM failure diagnosis on this run"
            onMouseEnter={() => setDiagnoseHover(true)}
            onMouseLeave={() => setDiagnoseHover(false)}
            className="flex items-center gap-1.5 px-3 py-1.5 text-white border border-amber-500/20 rounded text-xs font-semibold transition-colors disabled:opacity-40"
            style={{ backgroundColor: isDiagnoseHover ? 'rgba(245, 158, 11, 0.7)' : '#f59e0b' }}
          >
            {diagnoseStatus === 'running' ? <Loader2 size={12} className="animate-spin" /> : <Zap size={12} />}
            Diagnose Failures
          </button>
          <button
            onClick={handleCluster}
            disabled={clusterStatus === 'running' || !activeRunId}
            title="Cluster failure labels into failure modes"
            onMouseEnter={() => setClusterHover(true)}
            onMouseLeave={() => setClusterHover(false)}
            className="flex items-center gap-1.5 px-3 py-1.5 text-white border border-purple-500/20 rounded text-xs font-semibold transition-colors disabled:opacity-40"
            style={{ backgroundColor: isClusterHover ? 'rgba(79, 141, 252, 0.7)' : '#4f8dfc' }}
          >
            {clusterStatus === 'running' ? <Loader2 size={12} className="animate-spin" /> : <GitBranch size={12} />}
            Cluster Modes
          </button>
        </div>
      </div>

      {/* Main Split explorer workspace */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
        
        {/* Left column: Task list & search filters */}
        <div className="glass-panel flex flex-col h-[650px] overflow-hidden">
          {/* List Controls */}
          <div className="p-4 border-b border-white/[0.04] space-y-3 shrink-0">
            {/* Search */}
            <div className="search-wrapper relative">
              <Search 
                size={14} 
                className={`absolute left-3 top-1/2 -translate-y-1/2 transition-colors duration-200 ${
                  isFocused ? 'text-purple-600' : 'text-gray-400'
                }`}
                style={{ color: isFocused ? '#4f8dfc' : undefined }}
              />
              <input
                ref={searchInputRef}
                type="text"
                placeholder="Search tasks by slug or description..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                onFocus={() => setIsFocused(true)}
                onBlur={() => setIsFocused(false)}
                className="studio-search-input w-full"
              />
              <div className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center gap-1.5">
                {search ? (
                  <button
                    type="button"
                    onClick={() => {
                      setSearch('');
                      searchInputRef.current?.focus();
                    }}
                    className="clear-search-btn"
                    title="Clear search"
                  >
                    <X size={14} />
                  </button>
                ) : (
                  <kbd className="search-shortcut-badge">
                    <span>⌘</span><span>K</span>
                  </kbd>
                )}
              </div>
            </div>

            {/* Status tabs */}
            <div className="grid grid-cols-3 gap-1 bg-black/40 p-1 rounded border border-white/5">
              {(['ALL', 'PASS', 'FAIL'] as const).map(status => (
                <button
                  key={status}
                  onClick={() => setStatusFilter(status)}
                  className={`text-[10px] py-1.5 rounded font-bold transition-colors ${
                    statusFilter === status
                      ? 'bg-purple-600 text-white border border-purple-500/20 hover:bg-purple-600/70'
                      : 'bg-transparent !text-slate-700 border border-transparent hover:bg-purple-600/10 hover:text-white'
                  }`}
                >
                  {status}
                </button>
              ))}
            </div>

            {/* Filters row */}
            <div className="grid grid-cols-2 gap-2">
              <select
                value={categoryFilter}
                onChange={(e) => setCategoryFilter(e.target.value)}
                className="bg-black/30 border border-white/10 rounded py-1.5 px-2 text-[10px] text-gray-300 focus:outline-none focus:border-purple-500"
              >
                <option value="">All Categories</option>
                {uniqueCategories.map(cat => cat && (
                  <option key={cat} value={cat}>{cat}</option>
                ))}
              </select>

              <select
                value={difficultyFilter}
                onChange={(e) => setDifficultyFilter(e.target.value)}
                className="bg-black/30 border border-white/10 rounded py-1.5 px-2 text-[10px] text-gray-300 focus:outline-none focus:border-purple-500"
              >
                <option value="">All Difficulties</option>
                <option value="Easy">Easy</option>
                <option value="Medium">Medium</option>
                <option value="Hard">Hard</option>
              </select>
            </div>
          </div>

          {/* List scroll panel */}
          <div className="flex-1 overflow-y-auto divide-y divide-white/[0.02]">
            {filteredTasks.length === 0 ? (
              <div className="text-center py-12 text-gray-500 text-xs">
                No matching tasks found.
              </div>
            ) : (
              filteredTasks.map((t) => {
                const isActive = activeTaskId === String(t.id);
                const isPass = t.status === 'PASS';

                return (
                  <div
                    key={t.id}
                    onClick={() => setActiveTaskId(t.id ? String(t.id) : null)}
                    className={`p-4 cursor-pointer hover:bg-white/[0.02] transition-colors relative ${
                      isActive ? 'bg-purple-900/10 border-l-2 border-purple-500' : ''
                    }`}
                  >
                    <div className="flex justify-between items-start gap-2 mb-1">
                      <span className="font-mono text-[10px] text-gray-500 font-bold block shrink-0">{t.task_id}</span>
                      <span className={`badge ${isPass ? 'badge-success' : 'badge-fail'} text-[8px] scale-90`}>
                        {isPass ? 'PASS' : 'FAIL'}
                      </span>
                    </div>
                    <h4 className="text-xs font-semibold text-white line-clamp-1">{t.slug}</h4>
                    <p className="text-[10px] text-gray-500 line-clamp-1 mt-1">{t.description}</p>
                    
                    {!isPass && (
                      <span className={`inline-block mt-2 text-[8px] rounded px-1.5 font-bold uppercase tracking-wider ${
                        t.taxonomy_label 
                          ? 'bg-red-950/20 text-red-400 border border-red-900/20' 
                          : 'bg-amber-950/20 text-amber-500 border border-amber-900/20'
                      }`}>
                        {t.taxonomy_label || 'Unlabeled'}
                      </span>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* Right column: Trajectory Viewer & Diagnostics */}
        <div className="lg:col-span-2 space-y-6">
          
          {activeTask ? (
            <>
              {/* Task Summary Card */}
              <div className="glass-panel p-6 space-y-4">
                <div className="flex flex-col md:flex-row md:items-start justify-between gap-4 pb-4 border-b border-white/[0.04]">
                  <div>
                    <span className="text-[10px] text-gray-500 font-bold uppercase tracking-wider block">
                      {activeTask.category || 'General'} • {activeTask.difficulty || 'Medium'}
                    </span>
                    <h3 className="text-lg font-bold text-white mt-1">{activeTask.slug || 'Unnamed Task'}</h3>
                  </div>

                  <div className="flex items-center gap-2">
                    <span className={`badge ${activeTask.status === 'PASS' ? 'badge-success' : 'badge-fail'} text-xs px-3 py-1`}>
                      {activeTask.status === 'PASS' ? 'PASSED' : 'FAILED'}
                    </span>
                    <span className="bg-white/5 border border-white/10 text-white font-mono text-xs px-2.5 py-1.5 rounded">
                      Score: {activeTask.score !== undefined && activeTask.score !== null ? activeTask.score.toFixed(2) : '0.00'}
                    </span>
                  </div>
                </div>

                {/* Instruction */}
                <div>
                  <h4 className="text-xs font-bold uppercase tracking-wider text-gray-500 mb-1">Original Goal Instruction</h4>
                  <p className="text-xs text-gray-300 bg-black/20 p-3 rounded border border-white/[0.03] leading-relaxed">
                    {activeTask.description || 'No instruction description available for this task.'}
                  </p>
                </div>

                {/* In case of failure: show diagnostic mode & overrides */}
                {activeTask.status === 'FAIL' && (
                  <div className="p-4 bg-red-950/5 border border-red-900/10 rounded-lg space-y-3">
                    <div className="flex items-start gap-2.5">
                      <AlertCircle className="text-rose-400 shrink-0 mt-0.5" size={16} />
                      <div>
                        <h4 className="text-xs font-bold text-rose-400 uppercase tracking-wide">
                          Failure Diagnosis ({activeTask.taxonomy_label || 'Unlabeled'})
                        </h4>
                        <p className="text-xs text-gray-300 mt-1 leading-relaxed">
                          {activeTask.diagnosis_text || 'No diagnosis generated yet. Click "Diagnose Failures" in the top action panel to run LLM-powered root-cause classification on this run.'}
                        </p>
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-4 pt-3 border-t border-red-900/10">
                      {/* Override taxonomy */}
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] text-gray-500 font-bold uppercase">Override Label:</span>
                        <div className="relative inline-block">
                          <select
                            disabled={updatingTaxonomy}
                            value={activeTask.taxonomy_label || ''}
                            onChange={(e) => handleTaxonomyOverride(e.target.value)}
                            className="bg-black/60 border border-white/10 text-gray-300 text-[10px] rounded px-2 py-1 pr-6 focus:outline-none cursor-pointer focus:border-purple-500 appearance-none"
                          >
                            <option value="">Select Category</option>
                            <option value="GAP">GAP</option>
                            <option value="AMBIGUITY">AMBIGUITY</option>
                            <option value="TOOL_MISUSE">TOOL_MISUSE</option>
                            <option value="CODE_BUG">CODE_BUG</option>
                            <option value="UPSTREAM">UPSTREAM</option>
                            <option value="SAFETY_VIOLATION">SAFETY_VIOLATION</option>
                          </select>
                          <ChevronDown size={10} className="absolute right-2 top-2 text-gray-400 pointer-events-none" />
                        </div>
                      </div>

                      {/* Promote to Eval Suite */}
                      <div className="flex items-center gap-2 ml-auto">
                        <span className="text-[10px] text-gray-500 font-bold uppercase">Promote to Eval:</span>
                        <div className="relative inline-block">
                          <select
                            value={promotingSuiteId}
                            onChange={(e) => {
                              setPromotingSuiteId(e.target.value);
                              if (e.target.value) handlePromoteToSuite(e.target.value);
                            }}
                            className="bg-purple-900/30 border border-purple-800/30 text-purple-300 text-[10px] font-semibold rounded px-2.5 py-1.5 pr-8 focus:outline-none cursor-pointer hover:bg-purple-900/40 appearance-none"
                          >
                            <option value="">Select Suite</option>
                            {suites.map(s => (
                              <option key={s.id} value={s.id}>{s.name}</option>
                            ))}
                          </select>
                          <GraduationCap size={10} className="absolute right-2.5 top-2.5 text-purple-300 pointer-events-none" />
                        </div>
                        {promotionMessage && (
                          <span className="text-[10px] font-semibold text-emerald-400 flex items-center gap-0.5">
                            {promotionMessage.includes('successfully') ? <Check size={12} /> : null}
                            {promotionMessage}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* Trajectory Viewer */}
              <div className="glass-panel overflow-hidden">
                <div className="p-4 border-b border-white/[0.04] bg-black/10 flex items-center justify-between">
                  <h3 className="text-xs font-bold text-white flex items-center gap-2">
                    <Terminal size={14} className="text-purple-400" />
                    Agent Trajectory Execution Trace
                  </h3>
                  <span className="text-[10px] text-gray-500 font-semibold">{activeSteps.length} execution steps</span>
                </div>

                <div className="p-6 bg-[#010103] max-h-[480px] overflow-y-auto space-y-4">
                  {activeSteps.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-12 text-center space-y-3">
                      <AlertCircle className="text-amber-500" size={24} />
                      <div className="space-y-1">
                        <p className="text-xs font-semibold text-white">No steps recorded in trajectory trace</p>
                        <p className="text-[11px] text-gray-500 max-w-md mx-auto">
                          This failed task did not generate any execution steps. This usually indicates an early setup failure, container initialization error, or system-level ingestion issue.
                        </p>
                      </div>
                    </div>
                  ) : (
                    activeSteps.map((step) => {
                      const isAgent = step.type === 'agent';
                      const isToolCall = step.type === 'tool_call' || step.type === 'command';
                      const isToolOutput = step.type === 'tool_output' || step.type === 'stdout' || step.type === 'stderr';

                      return (
                        <div key={step.id || step.step_index} className="space-y-1">
                          <div className="flex items-center gap-2 text-[10px] text-gray-500 font-mono">
                            <span className="bg-white/5 border border-white/10 rounded px-1 scale-90">Step {step.step_index}</span>
                            <span className="uppercase text-[9px] tracking-wider font-semibold text-gray-400">{step.type}</span>
                          </div>

                          {isAgent && (
                            <div className="step-agent-thought font-sans text-xs bg-white/[0.01] p-3 rounded-md border border-white/[0.02]">
                              {step.content}
                            </div>
                          )}

                          {isToolCall && (
                            <div className="step-tool-call text-xs flex items-start gap-1 font-mono">
                              <span className="text-purple-400 shrink-0">$</span>
                              <span className="text-purple-300 font-bold whitespace-pre-wrap">{step.content}</span>
                            </div>
                          )}

                          {isToolOutput && (
                            <div className="step-tool-output font-mono text-xs whitespace-pre-wrap bg-black/60 p-3 border border-white/[0.04] rounded-md text-gray-400">
                              {step.output || step.content || '(Empty output)'}
                            </div>
                          )}
                        </div>
                      );
                    })
                  )}
                </div>
              </div>
            </>
          ) : (
            <div className="glass-panel p-16 text-center text-gray-500">
              Select a task from the explorer left pane to examine execution step traces and failure diagnosis.
            </div>
          )}

        </div>

      </div>

    </div>
  );
}
