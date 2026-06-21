'use client';

import React, { useRef, useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useReactFlow } from 'reactflow';
import {
  Save,
  FolderOpen,
  Download,
  Upload,
  CheckCircle2,
  AlertCircle,
  AlertTriangle,
  Loader2,
  Info
} from 'lucide-react';
import clsx from 'clsx';

interface Toast {
  id: string;
  type: 'success' | 'error' | 'warning' | 'info';
  message: string;
}

export function WorkflowControls() {
  const { getNodes, getEdges, setNodes, setEdges } = useReactFlow();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const addToast = (message: string, type: Toast['type'] = 'info') => {
    const id = Math.random().toString(36).substring(2, 9);
    setToasts((prev) => [...prev, { id, type, message }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 4000);
  };

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
    addToast('Workflow exported to JSON file successfully!', 'success');
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
        addToast('Workflow imported from JSON file successfully!', 'success');
      } catch (err) {
        console.error('Failed to parse JSON', err);
        addToast('Invalid workflow JSON file.', 'error');
      }
    };
    reader.readAsText(file);
    // reset input
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handleSave = async () => {
    setIsSaving(true);
    const nodes = getNodes();
    const edges = getEdges();
    const flow = { nodes, edges };

    try {
      const res = await fetch('/api/v1/workflows', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(flow),
      });

      const data = await res.json().catch(() => ({}));
      if (res.ok && data.ok) {
        // Sync backup to localStorage
        localStorage.setItem('autoharness_workflow', JSON.stringify(flow));
        addToast('Workflow successfully saved to server and synced locally!', 'success');
      } else {
        throw new Error(data.detail || 'Server responded with an error');
      }
    } catch (err: any) {
      console.warn('Failed to save to server, falling back to local storage:', err);
      // Backup to localStorage
      try {
        localStorage.setItem('autoharness_workflow', JSON.stringify(flow));
        addToast('Saved to Local Storage (Backend offline)', 'warning');
      } catch (lsErr) {
        addToast('Failed to save workflow locally or on server', 'error');
      }
    } finally {
      setIsSaving(false);
    }
  };

  const handleLoad = async () => {
    setIsLoading(true);
    let loaded = false;

    // 1. Try to load from server first
    try {
      const res = await fetch('/api/v1/workflows/default');
      const data = await res.json().catch(() => ({}));

      if (res.ok && data.ok && data.data) {
        const { nodes, edges } = data.data;
        if (nodes) setNodes(nodes);
        if (edges) setEdges(edges);
        addToast('Workflow loaded from server successfully!', 'success');
        loaded = true;
      }
    } catch (err) {
      console.warn('Failed to load from server, attempting local storage:', err);
    }

    // 2. Fallback to localStorage
    if (!loaded) {
      try {
        const saved = localStorage.getItem('autoharness_workflow');
        if (saved) {
          const flow = JSON.parse(saved);
          if (flow.nodes) setNodes(flow.nodes);
          if (flow.edges) setEdges(flow.edges);
          addToast('Workflow loaded from Local Storage fallback!', 'success');
          loaded = true;
        } else {
          addToast('No saved workflow found on server or locally.', 'error');
        }
      } catch (err) {
        console.error('Failed to parse local workflow', err);
        addToast('Failed to read workflow from local storage.', 'error');
      }
    }

    setIsLoading(false);
  };

  // Glassmorphic Toast Notifications overlay
  const toastsOverlay = (
    <div className="fixed bottom-6 right-6 z-[9999] flex flex-col gap-3 max-w-md w-full sm:w-96 pointer-events-none">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className={clsx(
            "pointer-events-auto p-4 rounded-xl shadow-xl border backdrop-blur-md transition-all duration-300 animate-toast-slide-up flex gap-3",
            {
              "bg-emerald-50/90 border-emerald-100/80 text-emerald-900 shadow-emerald-100/30": toast.type === 'success',
              "bg-rose-50/90 border-rose-100/80 text-rose-900 shadow-rose-100/30": toast.type === 'error',
              "bg-amber-50/90 border-amber-100/80 text-amber-900 shadow-amber-100/30": toast.type === 'warning',
              "bg-sky-50/90 border-sky-100/80 text-sky-900 shadow-sky-100/30": toast.type === 'info',
            }
          )}
        >
          {toast.type === 'success' && <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0 mt-0.5" />}
          {toast.type === 'error' && <AlertCircle className="w-5 h-5 text-rose-600 shrink-0 mt-0.5" />}
          {toast.type === 'warning' && <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />}
          {toast.type === 'info' && <Info className="w-5 h-5 text-sky-600 shrink-0 mt-0.5" />}
          <div className="flex-1 text-xs font-medium leading-relaxed">
            {toast.message}
          </div>
          <button
            onClick={() => setToasts((prev) => prev.filter((t) => t.id !== toast.id))}
            className="text-gray-400 hover:text-gray-600 font-semibold text-xs leading-none self-start shrink-0 ml-1 cursor-pointer pointer-events-auto"
          >
            &times;
          </button>
        </div>
      ))}
    </div>
  );

  return (
    <div className="flex items-center gap-2">
      <style>{`
        @keyframes toastSlideUp {
          from {
            opacity: 0;
            transform: translateY(1rem) scale(0.95);
          }
          to {
            opacity: 1;
            transform: translateY(0) scale(1);
          }
        }
        .animate-toast-slide-up {
          animation: toastSlideUp 0.3s cubic-bezier(0.16, 1, 0.3, 1) forwards;
        }
      `}</style>

      <input
        type="file"
        accept=".json"
        className="hidden"
        ref={fileInputRef}
        onChange={handleImport}
      />
      <button
        onClick={() => fileInputRef.current?.click()}
        className="px-2.5 py-1 text-xs font-semibold bg-white text-gray-700 border border-gray-200 rounded-md hover:bg-gray-50 transition-all shadow-sm whitespace-nowrap flex items-center gap-1.5 cursor-pointer"
      >
        <Upload className="w-3.5 h-3.5 text-gray-500" />
        Import JSON
      </button>
      <button
        onClick={handleExport}
        className="px-2.5 py-1 text-xs font-semibold bg-white text-gray-700 border border-gray-200 rounded-md hover:bg-gray-50 transition-all shadow-sm whitespace-nowrap flex items-center gap-1.5 cursor-pointer"
      >
        <Download className="w-3.5 h-3.5 text-gray-500" />
        Export JSON
      </button>
      
      <div className="w-px h-4 bg-gray-200 mx-1" />
      
      <button
        onClick={handleSave}
        disabled={isSaving}
        className={clsx(
          "px-2.5 py-1 text-xs font-semibold border rounded-md transition-all shadow-sm whitespace-nowrap flex items-center gap-1.5 cursor-pointer",
          isSaving
            ? "bg-purple-100 text-purple-400 border-purple-200 cursor-not-allowed"
            : "bg-purple-50 text-purple-700 border-purple-100 hover:bg-purple-100"
        )}
      >
        {isSaving ? (
          <Loader2 className="w-3.5 h-3.5 animate-spin" />
        ) : (
          <Save className="w-3.5 h-3.5" />
        )}
        {isSaving ? 'Saving...' : 'Save Workflow'}
      </button>
      
      <button
        onClick={handleLoad}
        disabled={isLoading}
        className={clsx(
          "px-2.5 py-1 text-xs font-semibold border rounded-md transition-all shadow-sm whitespace-nowrap flex items-center gap-1.5 cursor-pointer",
          isLoading
            ? "bg-purple-100 text-purple-400 border-purple-200 cursor-not-allowed"
            : "bg-purple-50 text-purple-700 border-purple-100 hover:bg-purple-100"
        )}
      >
        {isLoading ? (
          <Loader2 className="w-3.5 h-3.5 animate-spin" />
        ) : (
          <FolderOpen className="w-3.5 h-3.5" />
        )}
        {isLoading ? 'Loading...' : 'Load Workflow'}
      </button>

      {mounted && typeof document !== 'undefined' && createPortal(toastsOverlay, document.body)}
    </div>
  );
}
