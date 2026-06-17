'use client';

import React from 'react';
import { Node } from 'reactflow';
import { BaseNodeData } from './nodes/BaseNode';

interface PropertiesPanelProps {
  selectedNode: Node<BaseNodeData> | null;
  onUpdateNodeData: (nodeId: string, newData: Partial<BaseNodeData['params']>) => void;
  onClose?: () => void;
}

export function PropertiesPanel({ selectedNode, onUpdateNodeData, onClose }: PropertiesPanelProps) {
  if (!selectedNode) {
    return (
      <div className="h-full flex items-center justify-center text-gray-400 text-sm p-4 text-center">
        Select a node to edit its properties
      </div>
    );
  }

  const { id, data } = selectedNode;
  const { kind, label, description, params = {} } = data;

  const handleChange = (key: string, value: any) => {
    onUpdateNodeData(id, { [key]: value });
  };

  return (
    <div className="flex flex-col h-full bg-white border-l border-gray-200">
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-gray-100">
        <div>
          <h3 className="text-sm font-bold text-gray-900">{label}</h3>
          <p className="text-xs text-gray-500 uppercase tracking-wider">{kind} node</p>
        </div>
        {onClose && (
          <button onClick={onClose} className="md:hidden text-gray-400 hover:text-gray-600">
            &times;
          </button>
        )}
      </div>

      {/* Body */}
      <div className="p-4 flex-1 overflow-y-auto space-y-4">
        {description && (
          <div className="text-xs text-gray-600 mb-4 bg-gray-50 p-2 rounded">
            {description}
          </div>
        )}

        {kind === 'llm' && (
          <>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-gray-700">Model</label>
              <input
                type="text"
                className="w-full text-sm border border-gray-300 rounded p-2 focus:ring-2 focus:ring-purple-500 focus:border-transparent outline-none"
                placeholder="e.g. llama3.1:8b"
                value={(params.model as string) || ''}
                onChange={(e) => handleChange('model', e.target.value)}
              />
              <p className="text-[10px] text-gray-500">Available models are loaded from your local Ollama instance.</p>
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-gray-700">System Prompt</label>
              <textarea
                className="w-full text-sm border border-gray-300 rounded p-2 min-h-[100px] focus:ring-2 focus:ring-purple-500 focus:border-transparent outline-none resize-y"
                placeholder="Enter system instructions..."
                value={(params.prompt as string) || ''}
                onChange={(e) => handleChange('prompt', e.target.value)}
              />
            </div>
          </>
        )}

        {kind === 'text' && (
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-gray-700">Text Content</label>
            <textarea
              className="w-full text-sm border border-gray-300 rounded p-2 min-h-[150px] font-mono focus:ring-2 focus:ring-orange-500 focus:border-transparent outline-none resize-y"
              placeholder="Hello {{ name }}!"
              value={(params.text as string) || ''}
              onChange={(e) => handleChange('text', e.target.value)}
            />
            <p className="text-[10px] text-gray-500">Use {'{{ variable }}'} syntax to create dynamic input handles.</p>
          </div>
        )}

        {kind === 'logic' && (
          <>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-gray-700">Condition Type</label>
              <select
                className="w-full text-sm border border-gray-300 rounded p-2 focus:ring-2 focus:ring-red-500 focus:border-transparent outline-none bg-white"
                value={(params.conditionType as string) || 'if'}
                onChange={(e) => handleChange('conditionType', e.target.value)}
              >
                <option value="if">If (Boolean)</option>
                <option value="and">AND</option>
                <option value="or">OR</option>
                <option value="switch">Switch (Exact Match)</option>
              </select>
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-gray-700">Condition Expression</label>
              <input
                type="text"
                className="w-full text-sm border border-gray-300 rounded p-2 font-mono focus:ring-2 focus:ring-red-500 focus:border-transparent outline-none"
                placeholder="e.g. score > 0.8"
                value={(params.condition as string) || ''}
                onChange={(e) => handleChange('condition', e.target.value)}
              />
            </div>
          </>
        )}

        {kind === 'input' && (
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-gray-700">Variable Name</label>
            <input
              type="text"
              className="w-full text-sm border border-gray-300 rounded p-2 font-mono focus:ring-2 focus:ring-green-500 focus:border-transparent outline-none"
              placeholder="input_1"
              value={(params.outputVariable as string) || ''}
              onChange={(e) => handleChange('outputVariable', e.target.value)}
            />
          </div>
        )}

        {kind === 'output' && (
          <div className="text-xs text-gray-500">
            Output nodes automatically capture all connected inputs.
          </div>
        )}

        {kind === 'http' && (
          <>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-gray-700">Method</label>
              <select
                className="w-full text-sm border border-gray-300 rounded p-2 focus:ring-2 focus:ring-cyan-500 focus:border-transparent outline-none bg-white"
                value={(params.method as string) || 'GET'}
                onChange={(e) => handleChange('method', e.target.value)}
              >
                <option value="GET">GET</option>
                <option value="POST">POST</option>
                <option value="PUT">PUT</option>
                <option value="DELETE">DELETE</option>
              </select>
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-gray-700">URL</label>
              <input
                type="text"
                className="w-full text-sm border border-gray-300 rounded p-2 font-mono focus:ring-2 focus:ring-cyan-500 focus:border-transparent outline-none"
                placeholder="https://api.example.com/data"
                value={(params.url as string) || ''}
                onChange={(e) => handleChange('url', e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-gray-700">Headers (JSON)</label>
              <textarea
                className="w-full text-sm border border-gray-300 rounded p-2 font-mono focus:ring-2 focus:ring-cyan-500 focus:border-transparent outline-none resize-y"
                placeholder='{"Authorization": "Bearer token"}'
                rows={3}
                value={(params.headers as string) || ''}
                onChange={(e) => handleChange('headers', e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-gray-700">Body</label>
              <textarea
                className="w-full text-sm border border-gray-300 rounded p-2 font-mono focus:ring-2 focus:ring-cyan-500 focus:border-transparent outline-none resize-y"
                placeholder="Request payload..."
                rows={4}
                value={(params.body as string) || ''}
                onChange={(e) => handleChange('body', e.target.value)}
              />
            </div>
          </>
        )}

        {kind === 'approval' && (
          <>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-gray-700">Approval Title</label>
              <input
                type="text"
                className="w-full text-sm border border-gray-300 rounded p-2 focus:ring-2 focus:ring-amber-500 focus:border-transparent outline-none"
                placeholder="e.g. Approve deployment"
                value={(params.title as string) || ''}
                onChange={(e) => handleChange('title', e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-gray-700">Description</label>
              <textarea
                className="w-full text-sm border border-gray-300 rounded p-2 min-h-[80px] focus:ring-2 focus:ring-amber-500 focus:border-transparent outline-none resize-y"
                placeholder="Describe what this approval is for..."
                value={(params.description as string) || ''}
                onChange={(e) => handleChange('description', e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-gray-700">Fallback Action (on reject)</label>
              <input
                type="text"
                className="w-full text-sm border border-gray-300 rounded p-2 focus:ring-2 focus:ring-amber-500 focus:border-transparent outline-none"
                placeholder="e.g. Skip and continue"
                value={(params.fallbackAction as string) || ''}
                onChange={(e) => handleChange('fallbackAction', e.target.value)}
              />
              <p className="text-[10px] text-gray-500">Optional action to take if the approval is rejected.</p>
            </div>
          </>
        )}

        {kind === 'database' && (
          <>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-gray-700">Query Type</label>
              <select
                className="w-full text-sm border border-gray-300 rounded p-2 focus:ring-2 focus:ring-emerald-500 focus:border-transparent outline-none bg-white"
                value={(params.queryType as string) || 'SELECT'}
                onChange={(e) => handleChange('queryType', e.target.value)}
              >
                <option value="SELECT">SELECT</option>
                <option value="INSERT">INSERT</option>
                <option value="UPDATE">UPDATE</option>
                <option value="DELETE">DELETE</option>
              </select>
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-gray-700">Table Name</label>
              <input
                type="text"
                className="w-full text-sm border border-gray-300 rounded p-2 font-mono focus:ring-2 focus:ring-emerald-500 focus:border-transparent outline-none"
                placeholder="users"
                value={(params.tableName as string) || ''}
                onChange={(e) => handleChange('tableName', e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-gray-700">SQL Query</label>
              <textarea
                className="w-full text-sm border border-gray-300 rounded p-2 font-mono focus:ring-2 focus:ring-emerald-500 focus:border-transparent outline-none resize-y"
                placeholder="SELECT * FROM users WHERE id = :id"
                rows={4}
                value={(params.query as string) || ''}
                onChange={(e) => handleChange('query', e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-gray-700">Parameters (JSON)</label>
              <textarea
                className="w-full text-sm border border-gray-300 rounded p-2 font-mono focus:ring-2 focus:ring-emerald-500 focus:border-transparent outline-none resize-y"
                placeholder='{"id": 123}'
                rows={3}
                value={(params.dbParams as string) || ''}
                onChange={(e) => handleChange('dbParams', e.target.value)}
              />
            </div>
          </>
        )}
      </div>
    </div>
  );
}
