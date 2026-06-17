'use client';

import React from 'react';

export interface TimelineEntry {
  id: string;
  type: 'requested' | 'approved' | 'rejected' | 'resumed' | 'completed';
  label: string;
  description: string;
  timestamp: string;
  actor?: string;
  note?: string;
  fallbackAction?: string;
}

interface ApprovalHistoryTimelineProps {
  entries: TimelineEntry[];
  title?: string;
}

const dotColors: Record<TimelineEntry['type'], string> = {
  requested: 'bg-amber-500',
  approved: 'bg-green-500',
  rejected: 'bg-red-500',
  resumed: 'bg-blue-500',
  completed: 'bg-gray-500',
};

const lineColors: Record<TimelineEntry['type'], string> = {
  requested: 'border-amber-300',
  approved: 'border-green-300',
  rejected: 'border-red-300',
  resumed: 'border-blue-300',
  completed: 'border-gray-300',
};

const iconPaths: Record<TimelineEntry['type'], React.ReactNode> = {
  requested: (
    <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
      <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
    </svg>
  ),
  approved: (
    <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="20 6 9 17 4 12"/>
    </svg>
  ),
  rejected: (
    <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
      <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
    </svg>
  ),
  resumed: (
    <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
      <polygon points="5 3 19 12 5 21 5 3"/>
    </svg>
  ),
  completed: (
    <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="20 6 9 17 4 12"/>
    </svg>
  ),
};

function formatTimestamp(ts: string): string {
  try {
    const d = new Date(ts);
    return d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  } catch {
    return ts;
  }
}

export function ApprovalHistoryTimeline({ entries, title }: ApprovalHistoryTimelineProps) {
  if (entries.length === 0) return null;

  return (
    <div className="bg-white rounded-lg border border-gray-200 p-3 space-y-2">
      {title && (
        <h3 className="text-[11px] font-bold text-gray-900 uppercase tracking-wider">{title}</h3>
      )}
      <div className="space-y-0">
        {entries.map((entry, idx) => {
          const isLast = idx === entries.length - 1;
          return (
            <div key={entry.id} className="flex gap-2.5">
              <div className="flex flex-col items-center shrink-0" style={{ width: 20 }}>
                <div className={`w-4 h-4 rounded-full ${dotColors[entry.type]} flex items-center justify-center ring-2 ring-white z-10`}>
                  {iconPaths[entry.type]}
                </div>
                {!isLast && (
                  <div className={`w-0 flex-1 border-l-2 ${lineColors[entry.type]} mt-0.5`} style={{ minHeight: 16 }} />
                )}
              </div>
              <div className={`pb-3 ${isLast ? '' : ''} min-w-0 flex-1`}>
                <div className="flex items-center gap-1.5 flex-wrap">
                  <span className="text-[11px] font-semibold text-gray-800">{entry.label}</span>
                  <span className="text-[10px] text-gray-400">{formatTimestamp(entry.timestamp)}</span>
                </div>
                <div className="text-[10px] text-gray-500 leading-relaxed">
                  {entry.description}
                  {entry.actor && (
                    <span> by <span className="font-medium text-gray-600">{entry.actor}</span></span>
                  )}
                </div>
                {entry.note && (
                  <div className="text-[10px] text-gray-500 italic mt-0.5">
                    &ldquo;{entry.note}&rdquo;
                  </div>
                )}
                {entry.fallbackAction && (
                  <div className="text-[10px] text-amber-700 mt-0.5">
                    Fallback: {entry.fallbackAction}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
