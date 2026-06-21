'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { TimelineEntry } from './ApprovalHistoryTimeline';
import { posthog } from '@/lib/posthog';
import type { ExportEventProps } from '@/lib/posthog';

interface ApprovalExportProps {
  entries: TimelineEntry[];
  runId?: string;
}

interface ExportRow {
  approval_id: string;
  event: string;
  run_id: string;
  node_title: string;
  actor: string;
  timestamp: string;
  note: string;
  fallback_action: string;
}

function buildRows(entries: TimelineEntry[], runId?: string): ExportRow[] {
  return entries.map((entry) => ({
    approval_id: entry.id.replace(/-approved$|-requested$/, ''),
    event: entry.type,
    run_id: runId || '',
    node_title: entry.description || '',
    actor: entry.actor || '',
    timestamp: entry.timestamp,
    note: entry.note || '',
    fallback_action: entry.fallbackAction || '',
  }));
}

function escapeCsv(val: string): string {
  if (val.includes(',') || val.includes('"') || val.includes('\n') || val.includes('\r')) {
    return `"${val.replace(/"/g, '""')}"`;
  }
  return val;
}

function toCsv(rows: ExportRow[]): string {
  const headers = [
    'approval_id', 'event', 'run_id', 'node_title',
    'actor', 'timestamp', 'note', 'fallback_action',
  ];
  const lines = rows.map((r) =>
    [
      r.approval_id, r.event, r.run_id, escapeCsv(r.node_title),
      r.actor, r.timestamp, escapeCsv(r.note), r.fallback_action,
    ].join(','),
  );
  return [headers.join(','), ...lines].join('\r\n');
}

function triggerDownload(content: string, filename: string, mime: string) {
  const blob = new Blob([content], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function ApprovalExport({ entries, runId }: ApprovalExportProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const handleExport = useCallback(
    (format: 'json' | 'csv') => {
      const rows = buildRows(entries, runId);
      const base = `approval-audit${runId ? `-run-${runId}` : ''}`;

      const exportProps: ExportEventProps = {
        format,
        run_id: runId || '',
        entry_count: entries.length,
      };
      posthog.capture('audit_exported', exportProps);

      if (format === 'json') {
        triggerDownload(
          JSON.stringify(rows, null, 2),
          `${base}.json`,
          'application/json',
        );
      } else {
        triggerDownload(toCsv(rows), `${base}.csv`, 'text/csv');
      }

      setOpen(false);
    },
    [entries, runId],
  );

  const hasEntries = entries.length > 0;

  return (
    <div ref={ref} className="relative inline-block">
      <button
        onClick={() => hasEntries && setOpen((o) => !o)}
        disabled={!hasEntries}
        className={`flex items-center gap-1 px-2 py-1 text-[10px] font-medium bg-white border border-gray-200 rounded transition-colors ${
          hasEntries
            ? 'text-gray-500 hover:text-gray-700 hover:border-gray-300'
            : 'text-gray-300 cursor-not-allowed'
        }`}
      >
        <svg
          width="10"
          height="10"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
          <polyline points="7 10 12 15 17 10" />
          <line x1="12" y1="15" x2="12" y2="3" />
        </svg>
        Export
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-1 z-20 bg-white border border-gray-200 rounded shadow-md min-w-[130px]">
          <button
            onClick={() => handleExport('json')}
            className="block w-full text-left px-3 py-1.5 text-[11px] text-gray-700 hover:bg-gray-50 transition-colors"
          >
            Export JSON
          </button>
          <button
            onClick={() => handleExport('csv')}
            className="block w-full text-left px-3 py-1.5 text-[11px] text-gray-700 hover:bg-gray-50 transition-colors"
          >
            Export CSV
          </button>
        </div>
      )}
    </div>
  );
}
