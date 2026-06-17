'use client';

import React from 'react';
import { BaseNode, type BaseNodeData } from './BaseNode';

interface ApprovalNodeProps {
  data: BaseNodeData;
}

export function ApprovalNode({ data }: ApprovalNodeProps) {
  const title = (data.params?.title as string) || 'Approval Required';
  const description = (data.params?.description as string) || '';
  const fallbackAction = (data.params?.fallbackAction as string) || '';

  return (
    <BaseNode data={data}>
      <div className="mt-2 space-y-1.5 border-t border-amber-200 pt-2">
        <div className="flex items-center gap-1.5">
          <span className="text-amber-600 text-[10px] font-bold uppercase tracking-wider flex items-center gap-1">
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
              <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
            </svg>
            <span className="bg-amber-100 text-amber-700 text-[8px] font-bold px-1 py-0.5 rounded ml-0.5">GATE</span>
          </span>
        </div>
        <div className="text-xs font-medium text-gray-800">{title}</div>
        {description && (
          <div className="text-[11px] text-gray-500 line-clamp-2 leading-relaxed">{description}</div>
        )}
        {fallbackAction && (
          <div className="text-[10px] text-amber-700 bg-amber-50 rounded px-1.5 py-0.5 border border-amber-100">
            Fallback: {fallbackAction}
          </div>
        )}
      </div>
    </BaseNode>
  );
}
