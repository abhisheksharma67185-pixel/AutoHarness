'use client';

import React, { useState, useCallback } from 'react';
import { Node, Edge } from 'reactflow';
import { BaseNodeData } from './nodes/BaseNode';

interface WorkflowTriggerDisplayProps {
  nodes: Node<BaseNodeData>[];
  edges: Edge[];
}

interface TriggerResult {
  success: boolean;
  output?: string;
  logs?: Array<{ step: number; nodeId: string; nodeType: string; message: string }>;
  error?: string;
}

export function WorkflowTriggerDisplay({ nodes, edges }: WorkflowTriggerDisplayProps) {
  const [workflowId, setWorkflowId] = useState<string | null>(null);
  const [triggerResult, setTriggerResult] = useState<TriggerResult | null>(null);
  const [isRegistering, setIsRegistering] = useState(false);
  const [isTriggering, setIsTriggering] = useState(false);
  const [testPayload, setTestPayload] = useState('');
  const [copied, setCopied] = useState(false);

  const webhookUrl = workflowId
    ? `${window.location.origin}/api/v1/workflows/${workflowId}/trigger`
    : null;

  const handleRegister = useCallback(async () => {
    setIsRegistering(true);
    try {
      const res = await fetch('/api/v1/workflows/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nodes, edges }),
      });
      const data = await res.json();
      if (data.id) {
        setWorkflowId(data.id);
        setTriggerResult(null);
      }
    } catch {
      setTriggerResult({ success: false, error: 'Failed to register workflow' });
    } finally {
      setIsRegistering(false);
    }
  }, [nodes, edges]);

  const handleTrigger = useCallback(async () => {
    if (!workflowId) return;
    setIsTriggering(true);
    setTriggerResult(null);
    try {
      const res = await fetch(`/api/v1/workflows/${workflowId}/trigger`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          nodes,
          edges,
          payload: testPayload || '',
        }),
      });
      const data = await res.json();
      setTriggerResult(data);
    } catch {
      setTriggerResult({ success: false, error: 'Trigger request failed' });
    } finally {
      setIsTriggering(false);
    }
  }, [workflowId, nodes, edges, testPayload]);

  const handleCopy = useCallback(async () => {
    if (!webhookUrl) return;
    try {
      await navigator.clipboard.writeText(webhookUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // fallback
      const input = document.createElement('input');
      input.value = webhookUrl;
      document.body.appendChild(input);
      input.select();
      document.execCommand('copy');
      document.body.removeChild(input);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }, [webhookUrl]);

  return (
    <div className="bg-white rounded-lg border border-gray-200 p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-bold text-gray-900 uppercase tracking-wider">Webhook Trigger</h3>
        {!workflowId && (
          <button
            onClick={handleRegister}
            disabled={isRegistering}
            className="text-xs font-semibold text-purple-700 bg-purple-50 border border-purple-200 rounded px-3 py-1 hover:bg-purple-100 disabled:opacity-50 transition-colors"
          >
            {isRegistering ? 'Registering...' : 'Register'}
          </button>
        )}
      </div>

      {webhookUrl && (
        <>
          <div className="flex items-center gap-2">
            <input
              type="text"
              readOnly
              value={webhookUrl}
              className="flex-1 text-[11px] font-mono text-gray-600 bg-gray-50 border border-gray-200 rounded px-2 py-1.5 truncate"
            />
            <button
              onClick={handleCopy}
              className="text-xs text-gray-500 hover:text-gray-700 bg-gray-100 rounded px-2 py-1.5 font-medium shrink-0"
            >
              {copied ? 'Copied!' : 'Copy'}
            </button>
          </div>

          <div className="space-y-1.5">
            <label className="text-[11px] font-medium text-gray-600">Test Payload</label>
            <input
              type="text"
              value={testPayload}
              onChange={(e) => setTestPayload(e.target.value)}
              placeholder="Enter a test payload..."
              className="w-full text-xs border border-gray-200 rounded px-2 py-1.5 font-mono outline-none focus:ring-1 focus:ring-purple-500"
            />
          </div>

          <button
            onClick={handleTrigger}
            disabled={isTriggering}
            className="w-full text-xs font-semibold text-white bg-purple-600 rounded py-2 hover:bg-purple-700 disabled:opacity-50 transition-colors"
          >
            {isTriggering ? 'Triggering...' : 'Trigger Webhook'}
          </button>

          {triggerResult && (
            <div className={`text-xs border rounded p-2 space-y-1 ${triggerResult.success ? 'bg-green-50 border-green-200' : 'bg-red-50 border-red-200'}`}>
              <div className="font-semibold">{triggerResult.success ? '✅ Success' : '❌ Failed'}</div>
              {triggerResult.output && (
                <div className="text-gray-700 font-mono text-[11px] break-words">{triggerResult.output}</div>
              )}
              {triggerResult.error && (
                <div className="text-red-600 text-[11px]">{triggerResult.error}</div>
              )}
              {triggerResult.logs && triggerResult.logs.length > 0 && (
                <details className="mt-1">
                  <summary className="text-gray-500 cursor-pointer text-[11px]">Logs ({triggerResult.logs.length})</summary>
                  <div className="mt-1 space-y-0.5 max-h-32 overflow-y-auto">
                    {triggerResult.logs.map((log, i) => (
                      <div key={i} className="text-gray-500 text-[10px] font-mono">
                        <span className="text-purple-600">Step {log.step}</span> [{log.nodeType}] {log.message}
                      </div>
                    ))}
                  </div>
                </details>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
