'use client';

import React from 'react';
import { allTemplates, WorkflowTemplate } from './templates';

interface TemplateSidebarProps {
  onLoad: (template: WorkflowTemplate) => void;
}

export function TemplateSidebar({ onLoad }: TemplateSidebarProps) {
  return (
    <aside className="w-56 bg-gray-50 border-r border-gray-200 flex flex-col shrink-0">
      <div className="p-3 border-b border-gray-200">
        <h2 className="text-xs font-bold text-gray-900 uppercase tracking-wider">Templates</h2>
      </div>
      <div className="flex-1 overflow-y-auto p-3 space-y-3">
        {allTemplates.map((tpl) => (
          <div
            key={tpl.id}
            className="bg-white rounded-lg border border-gray-200 p-3 hover:border-purple-300 hover:shadow-sm transition-all"
          >
            <h3 className="text-sm font-semibold text-gray-900 mb-0.5">{tpl.name}</h3>
            <p className="text-[11px] text-gray-500 leading-relaxed mb-2.5">{tpl.description}</p>
            <div className="flex items-center gap-1.5 mb-2.5">
              {tpl.nodes.map((n) => (
                <span
                  key={n.id}
                  className="inline-block px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider text-white"
                  style={{
                    backgroundColor:
                      n.type === 'input' ? '#22c55e' :
                      n.type === 'output' ? '#3b82f6' :
                      n.type === 'llm' ? '#a855f7' :
                      n.type === 'text' ? '#f97316' :
                      n.type === 'logic' ? '#ef4444' :
                      n.type === 'http' ? '#0891b2' :
                      n.type === 'database' ? '#059669' :
                      n.type === 'approval' ? '#f59e0b' :
                      '#6b7280',
                  }}
                >
                  {n.type === 'input' ? 'IN' :
                   n.type === 'output' ? 'OUT' :
                   n.type === 'llm' ? 'LLM' :
                   n.type === 'text' ? 'TXT' :
                   n.type === 'logic' ? 'LOG' :
                   n.type === 'http' ? 'HTTP' :
                   n.type === 'database' ? 'DB' :
                   n.type === 'approval' ? 'APR' :
                   '?'}
                </span>
              ))}
            </div>
            <button
              onClick={() => onLoad(tpl)}
              className="w-full text-xs font-semibold text-purple-700 bg-purple-50 border border-purple-200 rounded py-1.5 hover:bg-purple-100 transition-colors"
            >
              Load
            </button>
          </div>
        ))}
      </div>
    </aside>
  );
}
