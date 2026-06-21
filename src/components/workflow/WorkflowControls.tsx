'use client';

import React, { useRef } from 'react';
import { useReactFlow } from 'reactflow';

export function WorkflowControls() {
  const { getNodes, getEdges, setNodes, setEdges } = useReactFlow();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleExport = () => {
    const nodes = getNodes();
    const edges = getEdges();
    const flow = { nodes, edges };
    const blob = new Blob([JSON.stringify(flow, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'workflow.json';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleImport = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const flow = JSON.parse(e.target?.result as string);
        if (flow.nodes) setNodes(flow.nodes);
        if (flow.edges) setEdges(flow.edges);
      } catch (err) {
        console.error('Failed to parse JSON', err);
        alert('Invalid workflow JSON file.');
      }
    };
    reader.readAsText(file);
    // reset input
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  return (
    <div className="flex items-center gap-2">
      <input
        type="file"
        accept=".json"
        className="hidden"
        ref={fileInputRef}
        onChange={handleImport}
      />
      <button
        onClick={() => fileInputRef.current?.click()}
        className="px-2.5 py-1 text-xs font-semibold bg-white text-gray-700 border border-gray-200 rounded-md hover:bg-gray-50 transition-colors shadow-sm whitespace-nowrap"
      >
        Import JSON
      </button>
      <button
        onClick={handleExport}
        className="px-2.5 py-1 text-xs font-semibold bg-white text-gray-700 border border-gray-200 rounded-md hover:bg-gray-50 transition-colors shadow-sm whitespace-nowrap"
      >
        Export JSON
      </button>
      <div className="w-px h-4 bg-gray-200 mx-1" />
      {/* Save/Load placeholders that will hit the mocked backend API */}
      <button
        onClick={() => alert('Saved to server (Mock)')}
        className="px-2.5 py-1 text-xs font-semibold bg-purple-50 text-purple-700 border border-purple-100 rounded-md hover:bg-purple-100 transition-colors shadow-sm whitespace-nowrap"
      >
        Save Workflow
      </button>
      <button
        onClick={() => alert('Loaded from server (Mock)')}
        className="px-2.5 py-1 text-xs font-semibold bg-purple-50 text-purple-700 border border-purple-100 rounded-md hover:bg-purple-100 transition-colors shadow-sm whitespace-nowrap"
      >
        Load Workflow
      </button>
    </div>
  );
}
