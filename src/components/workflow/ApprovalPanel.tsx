'use client';

import React, { useState } from 'react';
import { ApprovalItem } from '@/hooks/usePipelineExecution';
import { posthog } from '@/lib/posthog';

interface ApprovalPanelProps {
  approval: ApprovalItem | null;
  isExecuting: boolean;
  onApprove: () => void;
  onReject: (note?: string) => void;
}

export function ApprovalPanel({ approval, isExecuting, onApprove, onReject }: ApprovalPanelProps) {
  const [rejectionNote, setRejectionNote] = useState('');

  const handleApprove = () => {
    posthog.capture('approval_approved');
    onApprove();
  };

  const handleReject = () => {
    posthog.capture('approval_rejected', {
      has_note: !!rejectionNote.trim(),
    });
    onReject(rejectionNote || undefined);
    setRejectionNote('');
  };

  if (!approval) return null;

  const isPending = approval.status === 'pending';

  return (
    <div className="bg-white rounded-lg border border-amber-200 p-4 space-y-3 shadow-sm">
      <div className="flex items-center gap-2">
        <div className="flex items-center justify-center w-7 h-7 rounded-full bg-amber-100 shrink-0">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="text-amber-600">
            <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
            <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
          </svg>
        </div>
        <div className="min-w-0">
          <h3 className="text-xs font-bold text-amber-800 uppercase tracking-wider">Approval Required</h3>
          <span className={`inline-block text-[10px] font-semibold rounded px-1.5 py-0.5 mt-0.5 ${
            isPending ? 'text-amber-600 bg-amber-50' :
            approval.status === 'approved' ? 'text-green-600 bg-green-50' :
            'text-red-600 bg-red-50'
          }`}>
            {isPending ? 'Pending' : approval.status === 'approved' ? 'Approved' : 'Rejected'}
          </span>
        </div>
      </div>

      <div>
        <p className="text-sm font-semibold text-gray-900">{approval.title}</p>
        {approval.description && (
          <p className="text-xs text-gray-600 mt-0.5">{approval.description}</p>
        )}
        {approval.fallbackAction && isPending && (
          <p className="text-[10px] text-amber-700 bg-amber-50 rounded px-1.5 py-0.5 mt-1.5 inline-block">
            Fallback: {approval.fallbackAction}
          </p>
        )}
      </div>

      {isPending && (
        <div className="space-y-2">
          <textarea
            value={rejectionNote}
            onChange={(e) => setRejectionNote(e.target.value)}
            placeholder="Optional rejection note..."
            rows={2}
            className="w-full text-xs border border-gray-200 rounded px-2 py-1.5 outline-none focus:ring-1 focus:ring-amber-500 resize-none"
          />
          <div className="flex gap-2">
            <button
              onClick={handleApprove}
              disabled={isExecuting}
              className="flex-1 text-xs font-semibold text-white bg-green-600 rounded py-2 hover:bg-green-700 disabled:opacity-50 transition-colors flex items-center justify-center gap-1.5"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="20 6 9 17 4 12"/>
              </svg>
              Approve
            </button>
            <button
              onClick={handleReject}
              disabled={isExecuting}
              className="flex-1 text-xs font-semibold text-white bg-red-500 rounded py-2 hover:bg-red-600 disabled:opacity-50 transition-colors flex items-center justify-center gap-1.5"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
              </svg>
              Reject
            </button>
          </div>
        </div>
      )}

      {!isPending && (
        <div className={`text-xs rounded p-2 ${
          approval.status === 'approved' ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'
        }`}>
          <div className="font-semibold mb-0.5">
            {approval.status === 'approved' ? 'Approved' : 'Rejected'}
            {approval.approvedBy && ` by ${approval.approvedBy}`}
          </div>
          {approval.approvedAt && (
            <div className="text-[10px] opacity-75">{new Date(approval.approvedAt).toLocaleString()}</div>
          )}
          {approval.rejectionNote && (
            <div className="mt-1">Note: {approval.rejectionNote}</div>
          )}
        </div>
      )}
    </div>
  );
}
