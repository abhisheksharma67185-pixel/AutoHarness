'use client';

import { useState, useEffect } from 'react';
import {
  FlaskConical,
  Plus,
  Play,
  Copy,
  Check,
  TrendingDown,
  TrendingUp,
  AlertTriangle,
  ChevronRight,
  ShieldCheck,
  ChevronDown,
  Info,
  Layers,
  ArrowRight
} from 'lucide-react';
import { Run, Experiment, FailureMode } from '@/lib/types';

interface ExperimentsClientProps {
  initialExperiments: Experiment[];
  initialRuns: Run[];
  initialFailureModes: FailureMode[];
}

export default function ExperimentsClient({
  initialExperiments,
  initialRuns,
  initialFailureModes
}: ExperimentsClientProps) {
  const [experiments, setExperiments] = useState<Experiment[]>(initialExperiments);
  const [runs] = useState<Run[]>(initialRuns);
  const [failureModes] = useState<FailureMode[]>(initialFailureModes);
  
  const [activeExpId, setActiveExpId] = useState<string>('');
  const [expDetails, setExpDetails] = useState<{
    experiment: Experiment | null;
    variants: any[];
  }>({ experiment: null, variants: [] });

  // Wizard state
  const [showWizard, setShowWizard] = useState(false);
  const [newExpName, setNewExpName] = useState('');
  const [newBaseRunId, setNewBaseRunId] = useState('');
  const [newHarnessVer, setNewHarnessVer] = useState('');
  const [selectedTargetModes, setSelectedTargetModes] = useState<(string | number)[]>([]);
  const [maxRegressionPct, setMaxRegressionPct] = useState(2.0);
  const [creating, setCreating] = useState(false);

  // Variant selector
  const [activeVariantId, setActiveVariantId] = useState<string | null>(null);
  const [showAddVariantModal, setShowAddVariantModal] = useState(false);
  const [newVariantLabel, setNewVariantLabel] = useState('');
  const [addingVariant, setAddingVariant] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  
  // Linker state
  const [linkRunId, setLinkRunId] = useState('');
  const [linking, setLinking] = useState(false);
  const [copied, setCopied] = useState(false);

  // Load initial active experiment from localStorage on mount
  useEffect(() => {
    const storedExpId = localStorage.getItem('auto_harness_active_exp_id');
    if (storedExpId) {
      setActiveExpId(storedExpId);
    }
  }, []);

  // Sync active experiment to localStorage when it changes
  useEffect(() => {
    if (activeExpId) {
      localStorage.setItem('auto_harness_active_exp_id', activeExpId);
    }
  }, [activeExpId]);

  // Fetch experiment details when active ID changes
  useEffect(() => {
    if (!activeExpId) return;

    async function fetchDetails() {
      try {
        const res = await fetch(`/api/experiments?id=${encodeURIComponent(activeExpId)}`);
        const data = await res.json();
        if (data.experiment) {
          setExpDetails({
            experiment: data.experiment,
            variants: data.variants || []
          });
          
          const storedVarId = localStorage.getItem(`auto_harness_active_var_id_${activeExpId}`);
          if (storedVarId && data.variants && data.variants.some((v: any) => String(v.id) === String(storedVarId))) {
            setActiveVariantId(String(storedVarId));
          } else if (data.variants && data.variants.length > 0) {
            setActiveVariantId(String(data.variants[0].id));
          } else {
            setActiveVariantId(null);
          }
        }
      } catch (err) {
        console.error('Failed to fetch experiment details:', err);
      }
    }
    fetchDetails();
  }, [activeExpId]);

  // Set default active experiment
  useEffect(() => {
    if (experiments.length > 0 && !activeExpId) {
      const storedExpId = localStorage.getItem('auto_harness_active_exp_id');
      if (storedExpId && experiments.some(e => e.id?.toString() === storedExpId)) {
        setActiveExpId(storedExpId);
      } else {
        setActiveExpId(experiments[0].id?.toString() || '');
      }
    }
  }, [experiments, activeExpId]);

  // Sync active variant to localStorage when it changes
  useEffect(() => {
    if (activeVariantId && activeExpId) {
      localStorage.setItem(`auto_harness_active_var_id_${activeExpId}`, activeVariantId);
    }
  }, [activeVariantId, activeExpId]);

  // Toggle selection in wizard
  const handleToggleTargetMode = (id: string | number) => {
    const idStr = String(id);
    setSelectedTargetModes(prev => 
      prev.map(String).includes(idStr) ? prev.filter(m => String(m) !== idStr) : [...prev, id]
    );
  };

  // Auto-fill harness version when base run changes in wizard
  useEffect(() => {
    if (!newBaseRunId) return;
    const matchedRun = runs.find(r => r.run_id === newBaseRunId);
    if (matchedRun) {
      setNewHarnessVer(matchedRun.harness_version || '');
    }
  }, [newBaseRunId, runs]);

  // Create experiment handler
  const handleCreateExperiment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newExpName || !newBaseRunId || selectedTargetModes.length === 0) {
      alert('Please fill out all fields and select at least one target failure mode.');
      return;
    }
    setCreating(true);

    try {
      const res = await fetch('/api/experiments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'create_experiment',
          name: newExpName,
          base_harness_version: newHarnessVer,
          base_run_id: newBaseRunId,
          target_modes: selectedTargetModes,
          regression_policy: {
            guard_suites: [],
            global_min_success_rate: 0.0,
            max_regression_pct: maxRegressionPct
          }
        })
      });

      const data = await res.json();

      if (res.ok) {
        // Fetch experiments list again to update
        const listRes = await fetch('/api/experiments');
        const listData = await listRes.json();
        if (listData.experiments) {
          setExperiments(listData.experiments);
          setActiveExpId(data.experiment_id.toString());
        }
        setShowWizard(false);
        setNewExpName('');
        setNewBaseRunId('');
        setNewHarnessVer('');
        setSelectedTargetModes([]);
        setMaxRegressionPct(2.0);
      } else {
        alert(data.error || 'Failed to create experiment.');
      }
    } catch (err) {
      console.error(err);
      alert('Error occurred while creating experiment.');
    } finally {
      setCreating(false);
    }
  };

  // Link run handler
  const handleLinkRun = async (variantId: string | number) => {
    if (!linkRunId) return;
    setLinking(true);

    try {
      const res = await fetch('/api/experiments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'link_run',
          variant_id: variantId,
          run_id: linkRunId,
          experiment_id: activeExpId
        })
      });

      const data = await res.json();

      if (res.ok) {
        // Refresh experiment details
        const detRes = await fetch(`/api/experiments?id=${activeExpId}`);
        const detData = await detRes.json();
        if (detData.experiment) {
          setExpDetails({
            experiment: detData.experiment,
            variants: detData.variants || []
          });
        }
        setLinkRunId('');
      } else {
        alert(data.error || 'Failed to link run.');
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLinking(false);
    }
  };

  // Add variant handlers
  const handleAddVariant = () => {
    setNewVariantLabel('');
    setErrorMsg(null);
    setShowAddVariantModal(true);
  };

  const submitAddVariant = async () => {
    const label = newVariantLabel.trim() || `candidate-variant-${expDetails.variants.length + 1}`;
    setAddingVariant(true);
    setErrorMsg(null);

    const varVersion = `v1.0.0-var-${expDetails.variants.length + 1}-${Math.floor(1000 + Math.random() * 9000)}`;

    try {
      const res = await fetch('/api/experiments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'add_variant',
          experiment_id: activeExpId,
          variant_label: label,
          harness_version_id: varVersion
        })
      });
      const data = await res.json();
      if (res.ok) {
        // Refresh details
        const detRes = await fetch(`/api/experiments?id=${activeExpId}`);
        const detData = await detRes.json();
        if (detData.experiment) {
          setExpDetails({
            experiment: detData.experiment,
            variants: detData.variants || []
          });
          const newVar = detData.variants.find((v: any) => v.name === label || v.variant_label === label);
          if (newVar) {
            setActiveVariantId(String(newVar.id));
          }
        }
        setShowAddVariantModal(false);
        setNewVariantLabel('');
      } else {
        setErrorMsg(data.error || 'Failed to add variant');
      }
    } catch (err) {
      console.error(err);
      setErrorMsg('Error occurred while adding variant.');
    } finally {
      setAddingVariant(false);
    }
  };

  const activeVariant = expDetails.variants.find(v => String(v.id) === String(activeVariantId));

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex justify-between items-center">
        <div>
          <h2 className="text-2xl font-bold tracking-tight text-white mb-1">Experiment Planner IDE</h2>
          <p className="text-sm text-gray-500">
            Define target improvement nodes, enforce regression gates, and generate candidate configs.
          </p>
        </div>

        <button
          onClick={() => setShowWizard(prev => !prev)}
          className="flex items-center gap-1.5 px-3 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-lg text-xs font-semibold transition-all shadow-lg shadow-purple-500/10"
        >
          <Plus size={14} />
          New Experiment
        </button>
      </div>

      {/* Creation Wizard */}
      {showWizard && (
        <form onSubmit={handleCreateExperiment} className="glass-panel p-6 space-y-4 max-w-2xl">
          <h3 className="text-sm font-bold text-white flex items-center gap-1.5">
            <FlaskConical size={16} className="text-purple-400" />
            Create Experiment Wizard
          </h3>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="text-[10px] text-gray-500 font-bold uppercase block mb-1">Experiment Name</label>
              <input
                type="text"
                placeholder="e.g. Git conflict prompt validation"
                value={newExpName}
                onChange={(e) => setNewExpName(e.target.value)}
                required
                className="w-full bg-black/40 border border-white/10 rounded px-3 py-1.5 text-xs text-white focus:outline-none focus:border-purple-500"
              />
            </div>

            <div>
              <label className="text-[10px] text-gray-500 font-bold uppercase block mb-1">Base Benchmark Run</label>
              <div className="relative">
                <select
                  value={newBaseRunId}
                  onChange={(e) => setNewBaseRunId(e.target.value)}
                  required
                  className="w-full bg-black/40 border border-white/10 rounded px-3 py-1.5 text-xs text-gray-300 focus:outline-none focus:border-purple-500 appearance-none cursor-pointer"
                >
                  <option value="">Select Baseline Run</option>
                  {runs.map(r => (
                    <option key={r.run_id} value={r.run_id}>
                      {r.run_id} (Harness: {r.harness_version})
                    </option>
                  ))}
                </select>
                <ChevronDown size={12} className="absolute right-3 top-2.5 text-gray-400 pointer-events-none" />
              </div>
            </div>
          </div>

          {/* Target Failure Modes checklist */}
          <div>
            <label className="text-[10px] text-gray-500 font-bold uppercase block mb-2">
              Select Target Failure Modes (To Improve)
            </label>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2 max-h-[160px] overflow-y-auto bg-black/30 p-3 rounded border border-white/5">
              {failureModes.length === 0 ? (
                <span className="text-xs text-gray-500">No failure modes found in database. Seed or upload runs first.</span>
              ) : (
                failureModes.map(fm => (
                  <label key={fm.id} className="flex items-start gap-2.5 p-2 rounded hover:bg-white/5 cursor-pointer text-xs">
                    <input
                      type="checkbox"
                      checked={selectedTargetModes.includes(fm.id!)}
                      onChange={() => handleToggleTargetMode(fm.id!)}
                      className="mt-0.5 rounded border-white/10 bg-black/50 text-purple-600 focus:ring-0"
                    />
                    <div>
                      <span className="font-semibold text-white block">{fm.title}</span>
                      <span className="text-[9px] text-gray-500 uppercase">{fm.taxonomy_label}</span>
                    </div>
                  </label>
                ))
              )}
            </div>
          </div>

          {/* Policy */}
          <div>
            <label className="text-[10px] text-gray-500 font-bold uppercase block mb-1">
              Max Allowed Global Regression Gate (%)
            </label>
            <input
              type="number"
              step="0.1"
              value={maxRegressionPct}
              onChange={(e) => setMaxRegressionPct(parseFloat(e.target.value))}
              required
              className="w-32 bg-black/40 border border-white/10 rounded px-3 py-1.5 text-xs text-white focus:outline-none focus:border-purple-500"
            />
            <span className="text-[10px] text-gray-500 ml-2">Drop in global success rate beyond this triggers a gate violation.</span>
          </div>

          <div className="flex gap-2 justify-end pt-2">
            <button
              type="button"
              onClick={() => setShowWizard(false)}
              className="px-3 py-1.5 text-xs bg-white/5 border border-white/10 rounded hover:bg-white/10 text-gray-300 font-semibold"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={creating}
              className="px-3 py-1.5 text-xs bg-purple-600 hover:bg-purple-700 disabled:opacity-50 text-white rounded font-semibold"
            >
              {creating ? 'Proposing fix candidates...' : 'Create Experiment'}
            </button>
          </div>
        </form>
      )}

      {/* Main dashboard work panel */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
        
        {/* Left pane: Experiment List */}
        <div className="glass-panel overflow-hidden flex flex-col h-[520px]">
          <div className="p-4 border-b border-white/[0.04] bg-black/10 shrink-0">
            <h3 className="text-xs font-bold text-white uppercase tracking-wider">Active Experiments</h3>
          </div>

          <div className="flex-1 overflow-y-auto divide-y divide-white/[0.02]">
            {experiments.length === 0 ? (
              <div className="text-center py-12 text-gray-500 text-xs">
                No experiments defined yet.
              </div>
            ) : (
              experiments.map((e, idx) => {
                const isActive = activeExpId === e.id?.toString();
                
                return (
                  <div
                    key={e.id || idx}
                    onClick={() => setActiveExpId(e.id?.toString() || '')}
                    className={`p-4 cursor-pointer hover:bg-white/[0.02] transition-colors relative ${
                      isActive ? 'bg-purple-900/10 border-l-2 border-purple-500' : ''
                    }`}
                  >
                    <h4 className="text-xs font-semibold text-white">{e.name}</h4>
                    <div className="text-[10px] text-gray-500 mt-1">
                      Baseline Harness: {e.base_harness_version}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* Right pane: Variants explorer and details */}
        <div className="lg:col-span-2 space-y-6">
          {expDetails.experiment ? (
            <div className="space-y-6">
              
              {/* Variant Tabs Selector */}
              {/* Variant Tabs Selector */}
              <div className="flex items-center gap-2 bg-black/30 p-1 rounded-lg border border-white/5 overflow-x-auto max-w-full scrollbar-thin">
                {expDetails.variants.map((v, i) => (
                  <button
                    key={v.id}
                    onClick={() => setActiveVariantId(String(v.id))}
                    className={`flex-none whitespace-nowrap text-[11px] py-1.5 px-3 rounded font-bold transition-all ${
                      activeVariantId === String(v.id)
                        ? 'bg-purple-600 text-white shadow shadow-purple-500/20'
                        : 'text-gray-400 hover:text-white hover:bg-white/5'
                    }`}
                  >
                    {v.name || `Candidate #${i + 1}`}
                  </button>
                ))}
                
                <button
                  onClick={handleAddVariant}
                  className="px-3 py-1.5 text-purple-400 hover:text-purple-300 rounded hover:bg-white/5 text-[11px] font-bold flex items-center gap-1 shrink-0 cursor-pointer whitespace-nowrap"
                  title="Add candidate variant"
                >
                  <Plus size={12} /> Add Variant
                </button>
              </div>

              {activeVariant ? (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6 items-start">
                  
                  {/* Left Column: Code Patch Diff and YAML */}
                  <div className="space-y-6">
                    
                    {/* Config YAML file */}
                    <div className="glass-panel overflow-hidden">
                      <div className="p-4 border-b border-white/[0.04] bg-black/10 flex items-center justify-between">
                        <span className="text-xs font-bold text-white">Runnable Harness Configuration</span>
                        <button
                          onClick={() => copyToClipboard(activeVariant.generated_config)}
                          className="text-gray-400 hover:text-white transition-colors p-1 rounded hover:bg-white/5"
                          title="Copy file contents"
                        >
                          {copied ? <Check size={12} className="text-emerald-400" /> : <Copy size={12} />}
                        </button>
                      </div>

                      <pre className="p-4 bg-[#020204] text-gray-300 font-mono text-[10px] leading-relaxed overflow-x-auto h-[220px]">
                        {activeVariant.generated_config}
                      </pre>
                    </div>

                    {/* CLI snippet helper */}
                    <div className="glass-panel p-4 space-y-2 bg-purple-950/5 border-purple-500/10">
                      <span className="text-[9px] text-purple-400 font-bold uppercase tracking-wider block">Suggested Execution CLI Command</span>
                      <div className="flex items-center gap-2 bg-black/55 p-2 rounded border border-white/5 font-mono text-[10px]">
                        <span className="text-purple-400">$</span>
                        <span className="text-gray-300 select-all">python3 -m neosigma.autoharness --config harness_variant_{activeVariantId}.yaml --benchmark "Terminal-Bench 2.0"</span>
                      </div>
                    </div>
                  </div>

                  {/* Right Column: Regression Gating & Link result */}
                  <div className="space-y-6">
                    
                    {/* Gate Evaluation Metrics block */}
                    <div className="glass-panel p-6 space-y-4">
                      <h3 className="text-sm font-bold text-white">Regression Gate Verification</h3>
                      
                      {activeVariant.run_id ? (
                        <div className="space-y-4">
                          <div className="flex items-center justify-between pb-3 border-b border-white/[0.04]">
                            <span className="text-xs text-gray-400">Linked Run ID:</span>
                            <span className="font-mono text-xs text-white bg-white/5 border border-white/10 px-2 py-0.5 rounded">
                              {activeVariant.run_id}
                            </span>
                          </div>

                          <div className="flex items-center justify-between pb-3 border-b border-white/[0.04]">
                            <span className="text-xs text-gray-400">Promotion Status:</span>
                            <span className={`badge ${
                              activeVariant.status === 'promoted' 
                                ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' 
                                : activeVariant.status === 'rejected'
                                  ? 'bg-rose-500/10 text-rose-400 border border-rose-500/20'
                                  : 'bg-amber-500/10 text-amber-400 border border-amber-500/20'
                            } text-[10px] font-bold py-1 px-3 rounded uppercase`}>
                              {activeVariant.status || 'PENDING'}
                            </span>
                          </div>

                          {activeVariant.decision_reason && (
                            <div className="text-[11px] text-gray-400 bg-white/[0.02] border border-white/5 p-3 rounded leading-relaxed">
                              <span className="font-semibold text-white block mb-0.5">Decision Explanation:</span>
                              {activeVariant.decision_reason}
                            </div>
                          )}

                          <div className="flex items-center gap-3 p-3 rounded-lg bg-black/25 border border-white/5">
                            <span className="text-xs text-gray-400">Regression Gates:</span>
                            <span className={`badge ${activeVariant.gates_passed === 1 ? 'badge-success' : 'badge-fail'} text-[10px] font-bold py-1 px-3 ml-auto`}>
                              {activeVariant.gates_passed === 1 ? 'PASSED (STABLE)' : 'FAILED (REGRESSED)'}
                            </span>
                          </div>

                          {/* Target differences table */}
                          <div>
                            <span className="text-[10px] text-gray-500 font-bold uppercase block mb-1">Target Metrics (Deltas)</span>
                            <div className="space-y-2 max-h-[150px] overflow-y-auto">
                              {activeVariant.target_suite_scores?.map((t: any, idx: number) => (
                                <div key={idx} className="flex justify-between items-center text-xs py-1 border-b border-white/[0.02]">
                                  <span className="text-gray-400">{t.taxonomy} failure counts:</span>
                                  <span className="flex items-center gap-1.5 font-semibold">
                                    {t.failures_before} <ArrowRight size={10} className="text-gray-600" /> {t.failures_after}
                                    <span className={t.status === 'IMPROVED' ? 'text-emerald-400' : t.status === 'REGRESSED' ? 'text-rose-400' : 'text-gray-500'}>
                                      ({t.status})
                                    </span>
                                  </span>
                                </div>
                              ))}
                            </div>
                          </div>

                          {/* Guard differences table */}
                          <div>
                            <span className="text-[10px] text-gray-500 font-bold uppercase block mb-1">Guard Suite Met (Regression)</span>
                            <div className="space-y-1.5 max-h-[150px] overflow-y-auto">
                              {activeVariant.guard_suite_scores?.map((g: any, idx: number) => (
                                <div key={idx} className="flex justify-between items-center text-xs py-1 border-b border-white/[0.02]">
                                  <span className="text-gray-400">{g.taxonomy} failures:</span>
                                  <span className="font-semibold flex items-center gap-1">
                                    {g.failures_before} <ArrowRight size={10} className="text-gray-600" /> {g.failures_after}
                                    {g.regressed ? (
                                      <span className="text-[10px] font-bold text-rose-400 ml-1">REGRESSED</span>
                                    ) : (
                                      <span className="text-[10px] font-bold text-emerald-400 ml-1">OK</span>
                                    )}
                                  </span>
                                </div>
                              ))}
                            </div>
                          </div>
                        </div>
                      ) : (
                        <div className="space-y-4">
                          <div className="p-3 rounded bg-amber-950/5 border border-amber-900/10 text-xs text-amber-400 flex items-start gap-2">
                            <Info size={16} className="shrink-0 mt-0.5" />
                            <p className="leading-relaxed">
                              Run the agent with this generated configuration, and then upload the resulting run logs back into Studio in the Runs View.
                            </p>
                          </div>

                          {/* Linker dropdown */}
                          <div className="space-y-2">
                            <label className="text-[10px] text-gray-500 font-bold uppercase block">
                              Link Post-Experiment Run Output
                            </label>
                            <div className="flex gap-2">
                              <div className="relative flex-1">
                                <select
                                  value={linkRunId}
                                  onChange={(e) => setLinkRunId(e.target.value)}
                                  className="w-full bg-black/40 border border-white/10 rounded px-3 py-1.5 text-xs text-gray-300 focus:outline-none focus:border-purple-500 appearance-none cursor-pointer"
                                >
                                  <option value="">Select Completed Run</option>
                                  {runs
                                    .map(r => {
                                      const runId = r.run_id || r.id;
                                      return (
                                        <option key={runId} value={runId}>
                                          {runId} ({r.harness_version}, Score: {(r.global_score * 100).toFixed(0)}%)
                                        </option>
                                      );
                                    })}
                                </select>
                                <ChevronDown size={12} className="absolute right-3 top-2.5 text-gray-400 pointer-events-none" />
                              </div>

                              <button
                                onClick={() => handleLinkRun(activeVariant.id)}
                                disabled={linking || !linkRunId}
                                className="px-4 py-1.5 bg-purple-600 hover:bg-purple-700 disabled:opacity-50 text-white rounded text-xs font-semibold transition-colors"
                              >
                                {linking ? 'Linking...' : 'Verify Gates'}
                              </button>
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>

                </div>
              ) : (
                <div className="glass-panel p-16 text-center text-gray-500">
                  Click a candidate variant to view config patches and regression gate details.
                </div>
              )}
            </div>
          ) : (
            <div className="glass-panel p-16 text-center text-gray-500">
              Select an active experiment from the left list, or create a new experiment node via the wizard.
            </div>
          )}
        </div>

      </div>

      {showAddVariantModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="glass-panel p-6 max-w-md w-full space-y-4 shadow-2xl border border-white/10 bg-zinc-950/95">
            <h3 className="text-sm font-bold text-white flex items-center gap-1.5">
              <FlaskConical size={16} className="text-purple-400" />
              Add Candidate Variant
            </h3>
            
            {errorMsg && (
              <div className="text-xs text-rose-400 bg-rose-500/10 border border-rose-500/20 p-2.5 rounded">
                {errorMsg}
              </div>
            )}
            
            <div className="space-y-2">
              <label className="text-[10px] text-gray-500 font-bold uppercase block">
                Variant Label
              </label>
              <input
                type="text"
                autoFocus
                placeholder={`candidate-variant-${expDetails.variants.length + 1}`}
                value={newVariantLabel}
                onChange={(e) => setNewVariantLabel(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') submitAddVariant();
                }}
                className="w-full bg-black/40 border border-white/10 rounded px-3 py-2 text-xs text-white focus:outline-none focus:border-purple-500"
              />
            </div>

            <div className="flex gap-2 justify-end pt-2">
              <button
                type="button"
                onClick={() => setShowAddVariantModal(false)}
                className="px-3 py-1.5 text-xs bg-white/5 border border-white/10 rounded hover:bg-white/10 text-gray-300 font-semibold transition-all cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={submitAddVariant}
                disabled={addingVariant}
                className="px-3 py-1.5 text-xs bg-purple-600 hover:bg-purple-700 disabled:opacity-50 text-white rounded font-semibold transition-all cursor-pointer"
              >
                {addingVariant ? 'Adding...' : 'Add Variant'}
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
