'use client';

import React, { useRef } from 'react';
import { Handle, Position, useNodeId, useStore, type ReactFlowState } from 'reactflow';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export type BaseNodeData = {
  label: string;
  kind: 'input' | 'output' | 'llm' | 'text' | 'logic' | 'http' | 'database' | 'approval';
  description?: string;
  params?: Record<string, unknown>;
};

interface BaseNodeProps {
  data: BaseNodeData;
  children?: React.ReactNode;
}

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(...inputs));
}

export function BaseNode({ data, children }: BaseNodeProps) {
  const nodeId = useNodeId();
  const isSelected = useStore((store: ReactFlowState) =>
    nodeId ? (store.nodeInternals?.get(nodeId)?.selected ?? false) : false
  );

  return (
    <div
      className={cn(
        'rounded-lg border p-3 shadow-sm min-w-[200px] transition-all duration-200',
        isSelected
          ? 'border-purple-500 ring-2 ring-purple-500/20 bg-white/95'
          : 'border-gray-200 bg-white hover:border-gray-300'
      )}
    >
      <Handle
        type="target"
        position={Position.Left}
        id="input"
        className="w-3 h-3 bg-gray-400 border-2 border-white"
        isConnectable={true}
      />

      <div className="flex items-center gap-2 mb-1">
        <div
          className={cn(
            'flex items-center justify-center w-8 h-6 rounded text-[10px] font-bold tracking-wider',
            data.kind === 'input' && 'bg-green-500 text-white',
            data.kind === 'output' && 'bg-blue-500 text-white',
            data.kind === 'llm' && 'bg-purple-500 text-white',
            data.kind === 'text' && 'bg-orange-500 text-white',
            data.kind === 'logic' && 'bg-red-500 text-white',
            data.kind === 'http' && 'bg-cyan-600 text-white',
            data.kind === 'database' && 'bg-emerald-600 text-white',
            data.kind === 'approval' && 'bg-amber-500 text-white'
          )}
        >
          {data.kind === 'input' && 'IN'}
          {data.kind === 'output' && 'OUT'}
          {data.kind === 'llm' && 'LLM'}
          {data.kind === 'text' && 'TXT'}
          {data.kind === 'logic' && 'LOG'}
          {data.kind === 'http' && 'HTTP'}
          {data.kind === 'database' && 'DB'}
          {data.kind === 'approval' && 'APR'}
        </div>
        <div>
          <div className="font-semibold text-gray-900 text-sm">{data.label}</div>
          {data.description && (
            <div className="text-xs text-gray-500 line-clamp-1">{data.description}</div>
          )}
        </div>
      </div>

      <div className="mt-2">
        {data.params && Object.entries(data.params).length > 0 && (
          <div className="text-xs text-gray-600 space-y-0.5">
            {Object.entries(data.params).map(([key, value]) => {
              if (key === 'result' || key === 'resolvedText' || key === 'resolvedPrompt') return null;
              
              let displayValue = String(value);
              if (typeof value === 'object') {
                displayValue = '{...}';
              }
              if (displayValue.length > 30) {
                displayValue = displayValue.substring(0, 30) + '...';
              }
              
              return (
                <div key={key} className="flex items-center gap-1">
                  <span className="text-gray-400">{key}:</span>
                  <span className="font-mono text-gray-700">{displayValue}</span>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {children}

      <Handle
        type="source"
        position={Position.Right}
        id="output"
        className="w-3 h-3 bg-gray-400 border-2 border-white"
        isConnectable={true}
      />
    </div>
  );
}
