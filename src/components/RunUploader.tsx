'use client';

import { useState, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { Upload, FileJson, CheckCircle2, AlertCircle, Loader2 } from 'lucide-react';

interface RunUploaderProps {
  onUploadSuccess?: () => void;
}

export default function RunUploader({ onUploadSuccess }: RunUploaderProps = {}) {
  const router = useRouter();
  const [dragActive, setDragActive] = useState(false);
  const [status, setStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  const [message, setMessage] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleDrag = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === 'dragenter' || e.type === 'dragover') {
      setDragActive(true);
    } else if (e.type === 'dragleave') {
      setDragActive(false);
    }
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);

    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      await processFile(e.dataTransfer.files[0]);
    }
  };

  const handleChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    e.preventDefault();
    if (e.target.files && e.target.files[0]) {
      await processFile(e.target.files[0]);
    }
  };

  const triggerInputClick = () => {
    fileInputRef.current?.click();
  };

  const processFile = async (file: File) => {
    if (file.type !== 'application/json' && !file.name.endsWith('.json') && !file.name.endsWith('.jsonl')) {
      setStatus('error');
      setMessage('Invalid file type. Please upload a structured auto-harness run JSON file.');
      return;
    }

    setStatus('loading');
    setMessage('Reading trace logs and parsing benchmark entities...');

    try {
      const text = await file.text();
      const payload = JSON.parse(text);

      // Simple contract validation
      if (!payload.run_id || !payload.metadata || !payload.tasks) {
        throw new Error('JSON structure does not match the ingestion contract. Must contain run_id, metadata, and tasks array.');
      }

      const response = await fetch('/api/ingest', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Server ingestion endpoint returned an error.');
      }

      setStatus('success');
      setMessage(`Run "${payload.run_id}" successfully ingested! Refreshing dashboard...`);
      
      // Clear message after 3 seconds and refresh list
      setTimeout(() => {
        setStatus('idle');
        setMessage('');
        if (onUploadSuccess) {
          onUploadSuccess();
        } else {
          router.refresh();
        }
      }, 2500);

    } catch (err: any) {
      console.error(err);
      setStatus('error');
      setMessage(err.message || 'Failed to parse JSON file.');
    }
  };

  return (
    <div className="glass-panel p-6">
      <h3 className="text-sm font-bold text-white mb-2">Ingest Auto-Harness Run</h3>
      <p className="text-xs text-gray-500 mb-6">
        Upload an agent run artifact (JSON) to parse tasks, trajectories, failure modes and update dashboards.
      </p>

      <div
        onDragEnter={handleDrag}
        onDragOver={handleDrag}
        onDragLeave={handleDrag}
        onDrop={handleDrop}
        onClick={status === 'loading' ? undefined : triggerInputClick}
        className={`dropzone ${dragActive ? 'border-purple-500 bg-purple-500/5' : ''} ${
          status === 'loading' ? 'cursor-not-allowed opacity-80' : ''
        }`}
      >
        <input
          ref={fileInputRef}
          type="file"
          className="hidden"
          accept=".json,.jsonl"
          onChange={handleChange}
          disabled={status === 'loading'}
        />

        {status === 'idle' && (
          <div className="flex flex-col items-center justify-center space-y-2 text-gray-400">
            <Upload size={28} className="text-gray-500" />
            <p className="text-xs font-semibold text-white">Drag & drop your run log here, or browse</p>
            <p className="text-[10px]">Supports standard NeoSigma run JSON/JSONL outputs</p>
          </div>
        )}

        {status === 'loading' && (
          <div className="flex flex-col items-center justify-center space-y-2 text-purple-400">
            <Loader2 size={28} className="animate-spin" />
            <p className="text-xs font-semibold text-white">Ingesting run data...</p>
            <p className="text-[10px] text-gray-400">{message}</p>
          </div>
        )}

        {status === 'success' && (
          <div className="flex flex-col items-center justify-center space-y-2 text-emerald-400">
            <CheckCircle2 size={28} />
            <p className="text-xs font-semibold text-white">Ingestion complete</p>
            <p className="text-[10px] text-gray-400">{message}</p>
          </div>
        )}

        {status === 'error' && (
          <div className="flex flex-col items-center justify-center space-y-2 text-rose-400">
            <AlertCircle size={28} />
            <p className="text-xs font-semibold text-white">Ingestion failed</p>
            <p className="text-[10px] text-gray-400 max-w-[250px] leading-tight">{message}</p>
            <button
              onClick={(e) => {
                e.stopPropagation();
                setStatus('idle');
                setMessage('');
              }}
              className="text-[10px] text-purple-400 underline mt-1"
            >
              Try another file
            </button>
          </div>
        )}
      </div>

      <div className="mt-4 p-3 bg-white/[0.01] border border-white/[0.04] rounded-lg">
        <span className="text-[10px] text-gray-500 font-bold uppercase tracking-wider block mb-1">
          Demo Benchmark Files
        </span>
        <div className="flex justify-between items-center text-xs">
          <span className="text-gray-400 flex items-center gap-1.5">
            <FileJson size={12} />
            Baseline Run (50% score)
          </span>
          <a
            href="/demo/runs/baseline.json"
            download
            className="text-purple-400 hover:text-white underline font-semibold"
          >
            Download JSON
          </a>
        </div>
        <div className="flex justify-between items-center text-xs mt-2">
          <span className="text-gray-400 flex items-center gap-1.5">
            <FileJson size={12} />
            Improved Variant Run (80% score)
          </span>
          <a
            href="/demo/runs/improved.json"
            download
            className="text-purple-400 hover:text-white underline font-semibold"
          >
            Download JSON
          </a>
        </div>
      </div>
    </div>
  );
}
