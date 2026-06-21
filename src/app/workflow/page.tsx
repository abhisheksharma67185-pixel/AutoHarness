'use client';

import React, { useState, useCallback, useMemo, useEffect } from 'react';
import { Node, Edge, useNodesState, useEdgesState, ReactFlowProvider, Connection, addEdge } from 'reactflow';
import { WorkflowCanvas } from '@/components/workflow/Canvas';
import { PropertiesPanel } from '@/components/workflow/PropertiesPanel';
import { WorkflowControls } from '@/components/workflow/WorkflowControls';
import { TemplateSidebar } from '@/components/workflow/TemplateSidebar';
import { WorkflowTriggerDisplay } from '@/components/workflow/WorkflowTriggerDisplay';
import { ApprovalPanel } from '@/components/workflow/ApprovalPanel';
import { ApprovalHistoryTimeline, type TimelineEntry } from '@/components/workflow/ApprovalHistoryTimeline';
import { ApprovalExport } from '@/components/workflow/ApprovalExport';
import { usePipelineValidation } from '@/hooks/usePipelineValidation';
import { usePipelineExecution } from '@/hooks/usePipelineExecution';
import { BaseNodeData } from '@/components/workflow/nodes/BaseNode';
import { type WorkflowTemplate } from '@/components/workflow/templates';
import '@/styles/workflow.css';
import Link from 'next/link';

// Initial dummy nodes for the demo
const initialNodes: Node<BaseNodeData>[] = [
  {
    id: '1',
    type: 'input',
    position: { x: 50, y: 150 },
    data: { label: '1. Input', kind: 'input', description: 'Provides text value (client-side)', params: { inputValue: 'What is the speed of light?' } },
  },
  {
    id: '2',
    type: 'text',
    position: { x: 300, y: 150 },
    data: { label: '2. Format Prompt', kind: 'text', description: 'Transforms text via variables (client-side)', params: { text: 'Answer concisely: {{ user_query }}' } },
  },
  {
    id: '3',
    type: 'llm',
    position: { x: 600, y: 150 },
    data: { 
      label: '3. LLM', 
      kind: 'llm', 
      description: 'Calls Ollama via proxy → backend',
      params: { 
        model: 'llama3.1:8b', 
        temperature: 0.7 
      } 
    },
  },
  {
    id: '4',
    type: 'output',
    position: { x: 950, y: 150 },
    data: { label: '4. Output', kind: 'output', description: 'Displays the final result', params: {} },
  }
];

const initialEdges: Edge[] = [
  { id: 'e1-2', source: '1', target: '2', targetHandle: 'var:user_query', type: 'smoothstep' },
  { id: 'e2-3', source: '2', target: '3', type: 'smoothstep' },
  { id: 'e3-4', source: '3', target: '4', type: 'smoothstep' },
];

function WorkflowBuilder() {
  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);
  const [selectedNode, setSelectedNode] = useState<Node<BaseNodeData> | null>(null);
  const [isMobilePanelOpen, setIsMobilePanelOpen] = useState(false);
  const [isLogsOpen, setIsLogsOpen] = useState(false);
  const [runId, setRunId] = useState<string>('');
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>('custom');
  const [approvalNodeId, setApprovalNodeId] = useState<string>('');
  const [timelineEntries, setTimelineEntries] = useState<TimelineEntry[]>([]);
  
  const { validate, isValidating, error } = usePipelineValidation();
  const { executePipeline, resumePipeline, rejectApproval, isExecuting, logs, pendingApproval } = usePipelineExecution();

  // Handle node selection
  const onSelectionChange = useCallback(({ nodes: selectedNodes }: { nodes: Node[], edges: Edge[] }) => {
    if (selectedNodes.length > 0) {
      setSelectedNode(selectedNodes[0] as Node<BaseNodeData>);
      setIsMobilePanelOpen(true);
    } else {
      setSelectedNode(null);
      setIsMobilePanelOpen(false);
    }
  }, []);

  // Update node data from PropertiesPanel
  const onUpdateNodeData = useCallback((nodeId: string, newData: Partial<BaseNodeData['params']>) => {
    setNodes((nds) =>
      nds.map((node) => {
        if (node.id === nodeId) {
          const updatedNode = {
            ...node,
            data: {
              ...node.data,
              params: {
                ...node.data.params,
                ...newData,
              },
            },
          };
          // Also update selectedNode state to keep PropertiesPanel in sync immediately
          if (selectedNode?.id === nodeId) {
            setSelectedNode(updatedNode as Node<BaseNodeData>);
          }
          return updatedNode;
        }
        return node;
      })
    );
  }, [setNodes, selectedNode]);

  // Connect edges
  const onConnect = useCallback((connection: Connection) => {
    setEdges((eds) => addEdge({ ...connection, type: 'smoothstep' }, eds));
  }, [setEdges]);

  // Validate on changes (debounced by the hook)
  useEffect(() => {
    validate(nodes, edges);
  }, [nodes, edges, validate]);

  // Build a timeline entry
  const addTimelineEntry = useCallback((entry: TimelineEntry) => {
    setTimelineEntries((prev) => [...prev, entry]);
  }, []);

  // Handle Run Pipeline
  const handleRunPipeline = async () => {
    const isValid = await validate(nodes, edges);
    if (!isValid) {
      alert('Pipeline validation failed. Please fix errors before running.');
      return;
    }

    setIsLogsOpen(true);
    setTimelineEntries([]);
    const rid = `run-${Date.now()}`;
    setRunId(rid);
    setApprovalNodeId('');
    const result = await executePipeline(nodes, edges, rid, selectedTemplateId);

    if (result.paused) {
      setApprovalNodeId(result.approvalNodeId || '');
      addTimelineEntry({
        id: result.approvalId || 'approval',
        type: 'requested',
        label: 'Approval Requested',
        description: result.approvalTitle || 'Approval Required',
        timestamp: new Date().toISOString(),
        actor: 'operator',
      });
      return;
    }

    if (result.success) {
      addTimelineEntry({
        id: 'completed',
        type: 'completed',
        label: 'Run Completed',
        description: 'Pipeline executed successfully',
        timestamp: new Date().toISOString(),
      });
      setNodes((nds) => nds.map(n => {
        if (n.type === 'output') {
          return {
            ...n,
            data: { ...n.data, params: { ...n.data.params, result: result.output } }
          };
        }
        return n;
      }));
    } else {
      alert(`Pipeline failed: ${result.error}`);
    }
  };

  // Handle approval
  const handleApprove = async () => {
    const now = new Date().toISOString();
    if (pendingApproval) {
      addTimelineEntry({
        id: `${pendingApproval.id}-approved`,
        type: 'approved',
        label: 'Approved',
        description: pendingApproval.title,
        timestamp: now,
        actor: 'operator',
      });
    }

    const result = await resumePipeline();
    if (!result) return;

    if (result.paused) {
      setApprovalNodeId(result.approvalNodeId || '');
      const resumeId = `resumed-${Date.now()}`;
      addTimelineEntry({
        id: resumeId,
        type: 'resumed',
        label: 'Resumed',
        description: 'Execution continued after approval',
        timestamp: new Date().toISOString(),
      });
      addTimelineEntry({
        id: result.approvalId ? `${result.approvalId}-requested` : `requested-${Date.now()}`,
        type: 'requested',
        label: 'Approval Requested',
        description: result.approvalTitle || 'Approval Required',
        timestamp: new Date().toISOString(),
        actor: 'operator',
      });
      return;
    }

    addTimelineEntry({
      id: `resumed-${Date.now()}`,
      type: 'resumed',
      label: 'Resumed',
      description: 'Execution continued after approval',
      timestamp: now,
    });

    if (result.success) {
      addTimelineEntry({
        id: 'completed',
        type: 'completed',
        label: 'Run Completed',
        description: 'Pipeline executed successfully',
        timestamp: new Date().toISOString(),
      });
      setNodes((nds) => nds.map(n => {
        if (n.type === 'output') {
          return {
            ...n,
            data: { ...n.data, params: { ...n.data.params, result: result.output } }
          };
        }
        return n;
      }));
    } else {
      alert(`Pipeline failed: ${result.error}`);
    }
  };

  const handleReject = (note?: string) => {
    if (pendingApproval) {
      addTimelineEntry({
        id: `${pendingApproval.id}-rejected`,
        type: 'rejected',
        label: 'Rejected',
        description: pendingApproval.title,
        timestamp: new Date().toISOString(),
        actor: 'operator',
        note,
      });
    }
    rejectApproval(note);
  };

  // Load a template into the canvas
  const loadTemplate = useCallback((template: WorkflowTemplate) => {
    setNodes(template.nodes);
    setEdges(template.edges);
    setSelectedNode(null);
    setIsMobilePanelOpen(false);
    setSelectedTemplateId(template.id);
  }, [setNodes, setEdges]);

  // Add new nodes from sidebar/menu
  const addNode = (kind: BaseNodeData['kind'], label: string) => {
    const newNode: Node<BaseNodeData> = {
      id: `${kind}-${Date.now()}`,
      type: kind,
      position: { x: Math.random() * 200 + 100, y: Math.random() * 200 + 100 },
      data: { label, kind, params: {} },
    };
    setNodes((nds) => nds.concat(newNode));
  };

  return (
    <div className="workflow-layout">
      {/* Header */}
      <header className="workflow-header">
        <div>
          <h1 className="text-xl font-bold text-gray-900 flex items-center gap-2">
            <Link href="/" className="text-purple-600 hover:text-purple-800">←</Link>
            AutoHarness 2.0 <span className="text-sm font-normal text-gray-500">Visual Workflow Builder</span>
          </h1>
          <p className="text-xs text-gray-500 mt-0.5 ml-8">
            Visual AI workflow builder for execution, validation, HTTP calls, database queries, and local LLM runs.
          </p>
        </div>
        
        <div className="workflow-controls flex items-center gap-4 flex-shrink-0">
          <WorkflowControls />
          
          <button
            onClick={handleRunPipeline}
            disabled={isValidating || !!error || isExecuting}
            className="px-2.5 py-1 bg-purple-600 text-white text-xs font-semibold rounded-md hover:bg-purple-700 disabled:opacity-50 disabled:cursor-not-allowed shadow-sm transition-all whitespace-nowrap flex items-center gap-1.5"
          >
            {(isExecuting || isValidating) && (
              <svg className="animate-spin w-3 h-3" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
            )}
            {isExecuting ? 'Executing...' : isValidating ? 'Validating...' : 'Run Pipeline'}
          </button>
          
          <button
            onClick={() => setIsLogsOpen(!isLogsOpen)}
            className="px-2.5 py-1 bg-gray-200 text-gray-700 text-xs font-semibold rounded-md hover:bg-gray-300 transition-all whitespace-nowrap"
          >
            {isLogsOpen ? 'Hide Logs' : 'Show Logs'}
          </button>
        </div>
      </header>

      {/* Flows Info Banner */}
      <div className="bg-purple-50/80 border-b border-purple-100 px-6 py-2.5 flex items-center justify-between">
        <div className="flex items-center gap-x-5 gap-y-1 flex-wrap text-xs text-gray-600">
          <span className="font-semibold text-purple-700">✓ Verified flows:</span>
          <span className="text-purple-600 font-medium">Input → Text → Output</span>
          <span className="text-gray-300 select-none">|</span>
          <span className="text-cyan-600 font-medium">Input → HTTP → Output</span>
          <span className="text-gray-300 select-none">|</span>
          <span className="text-purple-600 font-medium">Input → LLM → Output</span>
          <span className="text-gray-300 select-none">|</span>
          <span className="text-emerald-600 font-medium">Input → Database → Output</span>
        </div>
        <div className="hidden md:flex items-center gap-4 text-[11px] text-gray-400">
          <span>Build → Validate → Run</span>
        </div>
      </div>

      {/* Main Body */}
      <div className="workflow-body flex">
        <TemplateSidebar onLoad={loadTemplate} />
        
        <div className="workflow-canvas-area flex flex-col relative flex-1">
          {/* Floating Node Palette */}
          <div className="absolute top-4 left-1/2 transform -translate-x-1/2 z-10 bg-white/95 backdrop-blur border border-gray-200/80 shadow-xl rounded-full px-3 py-1.5 flex items-center gap-1.5 transition-all">
            <span className="text-[10px] font-bold text-gray-400 tracking-wider px-2 border-r border-gray-200 mr-1 select-none">ADD NODE</span>
            
            <button onClick={() => addNode('input', 'New Input')} className="px-2.5 py-1 text-xs font-semibold text-gray-700 hover:bg-emerald-50 hover:text-emerald-700 rounded-full transition-all flex items-center gap-1">
              <span className="w-2 h-2 rounded-full bg-emerald-500"></span> Input
            </button>
            <button onClick={() => addNode('llm', 'New LLM')} className="px-2.5 py-1 text-xs font-semibold text-gray-700 hover:bg-purple-50 hover:text-purple-700 rounded-full transition-all flex items-center gap-1">
              <span className="w-2 h-2 rounded-full bg-purple-500"></span> LLM
            </button>
            <button onClick={() => addNode('text', 'New Text')} className="px-2.5 py-1 text-xs font-semibold text-gray-700 hover:bg-amber-50 hover:text-amber-700 rounded-full transition-all flex items-center gap-1">
              <span className="w-2 h-2 rounded-full bg-amber-500"></span> Text
            </button>
            <button onClick={() => addNode('logic', 'New Logic')} className="px-2.5 py-1 text-xs font-semibold text-gray-700 hover:bg-blue-50 hover:text-blue-700 rounded-full transition-all flex items-center gap-1">
              <span className="w-2 h-2 rounded-full bg-blue-500"></span> Logic
            </button>
            <button onClick={() => addNode('http', 'HTTP Request')} className="px-2.5 py-1 text-xs font-semibold text-gray-700 hover:bg-cyan-50 hover:text-cyan-700 rounded-full transition-all flex items-center gap-1">
              <span className="w-2 h-2 rounded-full bg-cyan-500"></span> HTTP
            </button>
            <button onClick={() => addNode('database', 'Database Query')} className="px-2.5 py-1 text-xs font-semibold text-gray-700 hover:bg-indigo-50 hover:text-indigo-700 rounded-full transition-all flex items-center gap-1">
              <span className="w-2 h-2 rounded-full bg-indigo-500"></span> DB
            </button>
            <button onClick={() => addNode('approval', 'Approval')} className="px-2.5 py-1 text-xs font-semibold text-gray-700 hover:bg-rose-50 hover:text-rose-700 rounded-full transition-all flex items-center gap-1">
              <span className="w-2 h-2 rounded-full bg-rose-500"></span> Approval
            </button>
            <button onClick={() => addNode('output', 'New Output')} className="px-2.5 py-1 text-xs font-semibold text-gray-700 hover:bg-red-50 hover:text-red-700 rounded-full transition-all flex items-center gap-1">
              <span className="w-2 h-2 rounded-full bg-red-500"></span> Output
            </button>
          </div>

          <WorkflowCanvas
            initialNodes={nodes}
            initialEdges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onSelectionChange={onSelectionChange}
          />
          
          {/* Validation Banner */}
          {error && (
            <div className="absolute bottom-4 left-1/2 transform -translate-x-1/2 bg-red-50 border border-red-200 text-red-700 px-4 py-2 rounded-lg shadow-lg z-50 text-sm max-w-xl text-center flex items-center gap-2">
              <span className="font-bold">Error:</span> {error}
            </div>
          )}
        </div>
        
        {/* Logs Panel */}
        {isLogsOpen && (
          <aside className="w-80 bg-white/80 backdrop-blur-md border-l border-gray-200/80 flex flex-col z-10 shadow-xl">
             <div className="p-3.5 border-b border-gray-200/80 flex justify-between items-center bg-gray-50/50">
               <h3 className="text-[11px] font-bold text-gray-900 uppercase tracking-wider">Execution Logs</h3>
               <button onClick={() => setIsLogsOpen(false)} className="text-gray-400 hover:text-gray-700 transition-colors text-lg font-bold leading-none">&times;</button>
             </div>
             <div className="flex-1 overflow-y-auto p-4 space-y-4 font-mono text-[11px]">
               {logs.length === 0 ? (
                 <div className="text-gray-400 italic text-center py-8">No execution logs yet. Run the pipeline to see output.</div>
               ) : (
                 logs.map((log, i) => (
                   <div key={i} className="border-b border-gray-100 pb-3 last:border-0">
                     <div className="flex items-center gap-2">
                       <span className="text-blue-600 font-bold">Step {log.step}</span>
                       <span className="text-gray-400 font-semibold">[{log.nodeType.toUpperCase()}]</span>
                     </div>
                     <div className="text-gray-600 break-words whitespace-pre-wrap leading-relaxed mt-1">{log.message}</div>
                   </div>
                 ))
               )}
             </div>
          </aside>
        )}

        {/* Sidebar Properties */}
        <aside className={`workflow-sidebar ${isMobilePanelOpen ? 'open' : ''}`}>
          <PropertiesPanel
            selectedNode={selectedNode}
            onUpdateNodeData={onUpdateNodeData}
            onClose={() => setIsMobilePanelOpen(false)}
          />
          <div className="border-t border-gray-200 p-3">
            <WorkflowTriggerDisplay nodes={nodes} edges={edges} />
          </div>
          {pendingApproval && (
            <div className="border-t border-gray-200 p-3">
              <ApprovalPanel
                approval={pendingApproval}
                isExecuting={isExecuting}
                onApprove={handleApprove}
                onReject={handleReject}
                runId={runId}
                workflowId={selectedTemplateId}
                nodeId={approvalNodeId}
                nodeTitle={pendingApproval.title}
                eventSource="sidebar"
              />
            </div>
          )}
          {timelineEntries.length > 0 && (
            <div className="border-t border-gray-200 p-3">
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-[11px] font-bold text-gray-900 uppercase tracking-wider">Approval Timeline</h3>
                <ApprovalExport entries={timelineEntries} runId={runId} />
              </div>
              <ApprovalHistoryTimeline entries={timelineEntries} />
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}

export default function WorkflowPage() {
  return (
    <ReactFlowProvider>
      <WorkflowBuilder />
    </ReactFlowProvider>
  );
}
