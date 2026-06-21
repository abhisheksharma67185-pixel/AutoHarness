'use client';

import { useState, useEffect } from 'react';
import {
  GraduationCap,
  Plus,
  BookOpen,
  Calendar,
  Check,
  Code,
  ShieldCheck,
  Trash2,
  ListFilter
} from 'lucide-react';
import { EvalSuite } from '@/lib/types';

interface EvalSuitesClientProps {
  initialSuites: EvalSuite[];
  selectedSuiteId: string;
}

export default function EvalSuitesClient({
  initialSuites,
  selectedSuiteId
}: EvalSuitesClientProps) {
  const [suites, setSuites] = useState<EvalSuite[]>(initialSuites);
  const [activeSuiteId, setActiveSuiteId] = useState<string>(selectedSuiteId);
  const [suiteDetails, setSuiteDetails] = useState<{
    suite: EvalSuite | null;
    cases: any[];
    runs: any[];
  }>({ suite: null, cases: [], runs: [] });

  // Create Suite Form
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [newSuiteName, setNewSuiteName] = useState('');
  const [newSuiteDesc, setNewSuiteDesc] = useState('');
  const [creating, setCreating] = useState(false);

  // Fetch active suite details
  useEffect(() => {
    if (!activeSuiteId) return;

    async function fetchSuiteDetails() {
      try {
        const res = await fetch(`/api/evals?suite_id=${encodeURIComponent(activeSuiteId)}`);
        const data = await res.json();
        if (data.suite) {
          setSuiteDetails({
            suite: data.suite,
            cases: data.cases || [],
            runs: data.runs || []
          });
        }
      } catch (err) {
        console.error('Failed to fetch suite details:', err);
      }
    }
    fetchSuiteDetails();
  }, [activeSuiteId]);

  // Handle create suite
  const handleCreateSuite = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newSuiteName || !newSuiteDesc) return;
    setCreating(true);

    try {
      const res = await fetch('/api/evals', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'create_suite',
          name: newSuiteName,
          description: newSuiteDesc
        })
      });

      const data = await res.json();

      if (res.ok) {
        // Add to suites list
        const createdSuite: EvalSuite = {
          id: data.suite_id,
          name: newSuiteName,
          description: newSuiteDesc,
          case_count: 0
        };
        setSuites(prev => [...prev, createdSuite]);
        setActiveSuiteId(createdSuite.id?.toString() || '');
        setShowCreateForm(false);
        setNewSuiteName('');
        setNewSuiteDesc('');
      } else {
        alert(data.error || 'Failed to create suite.');
      }
    } catch (err) {
      console.error(err);
      alert('Error creating suite.');
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex justify-between items-center">
        <div>
          <h2 className="text-2xl font-bold tracking-tight text-white mb-1">Evaluation Suites</h2>
          <p className="text-sm text-gray-500">
            Design living evaluation suites directly from agent failures to regression-test harness variations.
          </p>
        </div>

        <button
          onClick={() => setShowCreateForm(prev => !prev)}
          className="flex items-center gap-1.5 px-3 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-lg text-xs font-semibold transition-all shadow-lg shadow-purple-500/10"
        >
          <Plus size={14} />
          Create Suite
        </button>
      </div>

      {/* Create form modal panel */}
      {showCreateForm && (
        <form onSubmit={handleCreateSuite} className="glass-panel p-6 max-w-lg space-y-4">
          <h3 className="text-sm font-bold text-white">New Evaluation Suite</h3>
          <div className="space-y-3">
            <div>
              <label className="text-[10px] text-gray-500 font-bold uppercase block mb-1">Suite Name</label>
              <input
                type="text"
                placeholder="e.g. Git Merge Conflict Suites"
                value={newSuiteName}
                onChange={(e) => setNewSuiteName(e.target.value)}
                required
                className="w-full bg-black/40 border border-white/10 rounded px-3 py-1.5 text-xs text-white focus:outline-none focus:border-purple-500"
              />
            </div>
            <div>
              <label className="text-[10px] text-gray-500 font-bold uppercase block mb-1">Suite Description</label>
              <textarea
                placeholder="e.g. Validates the agent's ability to resolve branch conflicts in file headers..."
                value={newSuiteDesc}
                onChange={(e) => setNewSuiteDesc(e.target.value)}
                required
                rows={3}
                className="w-full bg-black/40 border border-white/10 rounded p-3 text-xs text-white focus:outline-none focus:border-purple-500"
              />
            </div>
          </div>
          <div className="flex gap-2 justify-end">
            <button
              type="button"
              onClick={() => setShowCreateForm(false)}
              className="px-3 py-1.5 text-xs bg-white/5 border border-white/10 rounded hover:bg-white/10 text-gray-300 font-semibold"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={creating}
              className="px-3 py-1.5 text-xs bg-purple-600 hover:bg-purple-700 disabled:opacity-50 text-white rounded font-semibold"
            >
              {creating ? 'Creating...' : 'Create'}
            </button>
          </div>
        </form>
      )}

      {/* Main split work pane */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
        
        {/* Left column: List of suites */}
        <div className="glass-panel overflow-hidden flex flex-col h-[520px]">
          <div className="p-4 border-b border-white/[0.04] bg-black/10 shrink-0">
            <h3 className="text-xs font-bold text-white uppercase tracking-wider">Suite Categories</h3>
          </div>

          <div className="flex-1 overflow-y-auto divide-y divide-white/[0.02]">
            {suites.length === 0 ? (
              <div className="text-center py-12 text-gray-500 text-xs">
                No evaluation suites created yet.
              </div>
            ) : (
              suites.map((s, idx) => {
                const isActive = activeSuiteId === s.id?.toString();
                
                return (
                  <div
                    key={s.id || idx}
                    onClick={() => setActiveSuiteId(s.id?.toString() || '')}
                    className={`p-4 cursor-pointer hover:bg-white/[0.02] transition-colors relative ${
                      isActive ? 'bg-purple-900/10 border-l-2 border-purple-500' : ''
                    }`}
                  >
                    <div className="flex justify-between items-center mb-1">
                      <h4 className="text-xs font-semibold text-white">{s.name}</h4>
                      <span className="text-[10px] bg-purple-900/30 text-purple-300 font-bold border border-purple-800/30 px-2 py-0.5 rounded-full shrink-0">
                        {s.case_count} cases
                      </span>
                    </div>
                    <p className="text-[10px] text-gray-500 line-clamp-2 mt-1">{s.description}</p>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* Right column: Cases and runs */}
        <div className="lg:col-span-2 space-y-6">
          {suiteDetails.suite ? (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 items-start">
              
              {/* Cases in suite */}
              <div className="glass-panel overflow-hidden flex flex-col h-[480px]">
                <div className="p-4 border-b border-white/[0.04] bg-black/10 flex items-center justify-between shrink-0">
                  <h3 className="text-xs font-bold text-white flex items-center gap-1.5">
                    <BookOpen size={14} className="text-purple-400" />
                    Cases in Suite
                  </h3>
                  <span className="text-[10px] text-gray-500 font-bold">{suiteDetails.cases.length} active</span>
                </div>

                <div className="divide-y divide-white/[0.02] flex-1 overflow-y-auto">
                  {suiteDetails.cases.length === 0 ? (
                    <div className="text-center py-16 text-gray-500 text-xs">
                      No test cases promoted to this suite yet.
                    </div>
                  ) : (
                    suiteDetails.cases.map((c) => {
                      const input = JSON.parse(c.input_spec);
                      const expected = JSON.parse(c.expected_spec);

                      return (
                        <div key={c.id} className="p-4 space-y-2.5">
                          <div>
                            <div className="flex items-center gap-2">
                              <span className="font-mono text-[9px] text-gray-500 font-bold">{c.task_id}</span>
                              <span className="text-xs font-bold text-slate-200">{c.slug}</span>
                            </div>
                            <p className="text-[10px] text-gray-400 leading-normal mt-1">{c.description}</p>
                          </div>

                          <div className="bg-black/60 p-2.5 rounded border border-white/[0.04] text-[10px] font-mono space-y-1.5">
                            <span className="text-purple-400 font-semibold block uppercase tracking-wide text-[8px]">Expected Conditions:</span>
                            <div>Failed Command: {expected.failed_command || 'N/A'}</div>
                            <div className="flex flex-wrap gap-1 mt-1">
                              {expected.assertions?.map((as: any, idx: number) => (
                                <span key={idx} className="bg-white/5 border border-white/10 rounded px-1 text-gray-400 scale-90">
                                  {as.type}: {as.expected}
                                </span>
                              ))}
                            </div>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>

              {/* Suite Run history */}
              <div className="glass-panel overflow-hidden flex flex-col h-[480px]">
                <div className="p-4 border-b border-white/[0.04] bg-black/10 flex items-center justify-between shrink-0">
                  <h3 className="text-xs font-bold text-white flex items-center gap-1.5">
                    <ShieldCheck size={14} className="text-purple-400" />
                    Iteration Run History
                  </h3>
                </div>

                <div className="divide-y divide-white/[0.02] flex-1 overflow-y-auto">
                  {suiteDetails.runs.length === 0 ? (
                    <div className="text-center py-16 text-gray-500 text-xs">
                      No iteration runs recorded. Runs will appear once experiments are linked.
                    </div>
                  ) : (
                    suiteDetails.runs.map((r, idx) => {
                      const passRate = r.pass_rate * 100;
                      const badgeClass =
                        passRate >= 75
                          ? 'badge-success'
                          : passRate >= 50
                          ? 'badge-warning'
                          : 'badge-fail';

                      return (
                        <div key={r.id || idx} className="p-4 flex items-center justify-between hover:bg-white/[0.01]">
                          <div>
                            <div className="text-xs font-bold text-slate-200">Harness Version: {r.harness_version}</div>
                            <div className="text-[10px] text-gray-500 flex items-center gap-1 mt-1">
                              <Calendar size={10} />
                              {new Date(r.created_at || Date.now()).toLocaleDateString()}
                            </div>
                          </div>
                          <span className={`badge ${badgeClass} text-[10px]`}>
                            {passRate.toFixed(0)}% Pass
                          </span>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>

            </div>
          ) : (
            <div className="glass-panel p-16 text-center text-gray-500">
              Select an evaluation suite from the list left pane to view active test cases and run pass rates.
            </div>
          )}
        </div>

      </div>
    </div>
  );
}
